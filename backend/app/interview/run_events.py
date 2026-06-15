"""Interview Run 事件缓存。

优先使用 Redis 存储事件、owner 和 done 标记，支持多 worker 读取。
Redis 不可用时短时熔断并降级到进程内内存，保证本地开发和轻量部署不中断。
详见 docs/20260614-ai-interviewer-run-events-risk.md。
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.infra.redis_client import get_redis

logger = logging.getLogger(__name__)

_EVENTS: dict[str, deque[dict[str, Any]]] = defaultdict(deque)
_DONE: dict[str, bool] = {}
_TTL = timedelta(minutes=30)
_TTL_SECONDS = int(_TTL.total_seconds())
_CREATED_AT: dict[str, datetime] = {}
_RUN_OWNERS: dict[str, dict[str, int]] = {}
_REDIS_PREFIX = "careerforge:interview_runs"
_REDIS_UNAVAILABLE_UNTIL: datetime | None = None
_REDIS_RETRY_DELAY = timedelta(seconds=15)


def _run_key(run_id: str, suffix: str) -> str:
    return f"{_REDIS_PREFIX}:{run_id}:{suffix}"


def _redis_client():
    global _REDIS_UNAVAILABLE_UNTIL
    now = datetime.now(timezone.utc)
    if _REDIS_UNAVAILABLE_UNTIL and now < _REDIS_UNAVAILABLE_UNTIL:
        return None
    try:
        client = get_redis()
        if hasattr(client, "ping"):
            client.ping()
        _REDIS_UNAVAILABLE_UNTIL = None
        return client
    except Exception as exc:  # noqa: BLE001 - run events must degrade to memory.
        _REDIS_UNAVAILABLE_UNTIL = now + _REDIS_RETRY_DELAY
        logger.warning("interview run_events redis unavailable, using memory fallback: %s", exc)
        return None


def _redis_expire_run(client: Any, run_id: str) -> None:
    for suffix in ("events", "owner", "done", "created_at", "seq"):
        client.expire(_run_key(run_id, suffix), _TTL_SECONDS)


def create_interview_run(*, tenant_id: int, student_id: int) -> str:
    run_id = str(uuid4())
    created_at = datetime.now(timezone.utc)
    _CREATED_AT[run_id] = created_at
    _DONE[run_id] = False
    _RUN_OWNERS[run_id] = {"tenant_id": tenant_id, "student_id": student_id}
    client = _redis_client()
    if client is not None:
        try:
            client.hset(_run_key(run_id, "owner"), mapping={"tenant_id": tenant_id, "student_id": student_id})
            client.set(_run_key(run_id, "done"), "0", ex=_TTL_SECONDS)
            client.set(_run_key(run_id, "created_at"), created_at.isoformat(), ex=_TTL_SECONDS)
            _redis_expire_run(client, run_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to persist interview run owner to redis: %s", exc)
    return run_id


def assert_interview_run_owner(run_id: str, *, tenant_id: int, student_id: int) -> None:
    """校验 run 是否属于当前用户。不属于则抛出 KeyError（由调用方转为 404）。"""
    owner = _RUN_OWNERS.get(run_id)
    if not owner:
        client = _redis_client()
        if client is not None:
            try:
                redis_owner = client.hgetall(_run_key(run_id, "owner"))
                if redis_owner:
                    owner = {
                        "tenant_id": int(redis_owner.get("tenant_id", -1)),
                        "student_id": int(redis_owner.get("student_id", -1)),
                    }
            except Exception as exc:  # noqa: BLE001
                logger.warning("failed to read interview run owner from redis: %s", exc)
    if not owner:
        raise KeyError(f"interview run {run_id} not found")
    if owner["tenant_id"] != tenant_id or owner["student_id"] != student_id:
        raise KeyError(f"interview run {run_id} not found")


def emit_interview_event(run_id: str | None, event: str, data: dict[str, Any]) -> None:
    if not run_id:
        return
    client = _redis_client()
    seq = len(_EVENTS[run_id]) + 1
    if client is not None:
        try:
            seq = int(client.incr(_run_key(run_id, "seq")))
        except Exception:
            seq = len(_EVENTS[run_id]) + 1
    payload = {
        "seq": seq,
        "event": event,
        "data": data,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _EVENTS[run_id].append(payload)
    while len(_EVENTS[run_id]) > 500:
        _EVENTS[run_id].popleft()
    if client is not None:
        try:
            events_key = _run_key(run_id, "events")
            client.xadd(
                events_key,
                {
                    "seq": str(seq),
                    "event": event,
                    "data": json.dumps(data, ensure_ascii=False),
                    "created_at": payload["created_at"],
                },
                maxlen=500,
                approximate=True,
            )
            _redis_expire_run(client, run_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to persist interview event to redis: %s", exc)


def mark_interview_run_done(run_id: str | None) -> None:
    if run_id:
        _DONE[run_id] = True
        client = _redis_client()
        if client is not None:
            try:
                client.set(_run_key(run_id, "done"), "1", ex=_TTL_SECONDS)
                _redis_expire_run(client, run_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("failed to mark interview run done in redis: %s", exc)


def get_interview_events(run_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
    cleanup_interview_runs()
    client = _redis_client()
    if client is not None:
        try:
            raw_items = client.xrange(_run_key(run_id, "events"), min="-", max="+")
            events = [_decode_stream_event(fields) for _stream_id, fields in raw_items]
            return [item for item in events if int(item.get("seq", 0)) > after_seq]
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to read interview events from redis: %s", exc)
    return [item for item in _EVENTS.get(run_id, []) if int(item.get("seq", 0)) > after_seq]


def _decode_stream_field(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return value


def _decode_stream_event(fields: dict[Any, Any]) -> dict[str, Any]:
    decoded = {str(_decode_stream_field(key)): _decode_stream_field(value) for key, value in fields.items()}
    data = decoded.get("data", {})
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            data = {}
    return {
        "seq": int(decoded.get("seq", 0)),
        "event": str(decoded.get("event", "")),
        "data": data if isinstance(data, dict) else {},
        "created_at": str(decoded.get("created_at", "")),
    }


def is_interview_run_done(run_id: str) -> bool:
    client = _redis_client()
    if client is not None:
        try:
            return client.get(_run_key(run_id, "done")) == "1"
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to read interview run done flag from redis: %s", exc)
    return bool(_DONE.get(run_id))


def cleanup_interview_runs() -> None:
    now = datetime.now(timezone.utc)
    expired = [run_id for run_id, created in _CREATED_AT.items() if now - created > _TTL]
    for run_id in expired:
        _EVENTS.pop(run_id, None)
        _DONE.pop(run_id, None)
        _CREATED_AT.pop(run_id, None)
        _RUN_OWNERS.pop(run_id, None)
        client = _redis_client()
        if client is not None:
            try:
                client.delete(
                    _run_key(run_id, "events"),
                    _run_key(run_id, "owner"),
                    _run_key(run_id, "done"),
                    _run_key(run_id, "created_at"),
                    _run_key(run_id, "seq"),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("failed to cleanup interview run redis keys: %s", exc)
