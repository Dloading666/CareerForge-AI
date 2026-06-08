from __future__ import annotations

import logging

import redis as _redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_client: _redis.Redis | None = None
_pool: _redis.ConnectionPool | None = None


def get_redis() -> _redis.Redis:
    global _client, _pool
    if _client is None:
        settings = get_settings()
        _pool = _redis.ConnectionPool.from_url(
            settings.redis_url,
            decode_responses=True,
            max_connections=50,
            socket_timeout=5,
            socket_connect_timeout=5,
            retry_on_timeout=True,
            health_check_interval=30,
        )
        _client = _redis.Redis(connection_pool=_pool)
    return _client


def ping_redis() -> bool:
    try:
        get_redis().ping()
        return True
    except Exception as exc:
        logger.warning("Redis not reachable: %s", exc)
        return False
