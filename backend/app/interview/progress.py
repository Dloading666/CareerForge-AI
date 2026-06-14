from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

_PROGRESS: dict[str, dict[str, Any]] = {}
_TTL = timedelta(minutes=10)


def set_progress(request_id: str | None, *, stage: str, status: str, message: str, done: bool = False, error: str | None = None) -> None:
    if not request_id:
        return
    _PROGRESS[request_id] = {
        "stage": stage,
        "status": status,
        "message": message,
        "done": done,
        "error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    cleanup_progress()


def get_progress(request_id: str) -> dict[str, Any] | None:
    cleanup_progress()
    return _PROGRESS.get(request_id)


def cleanup_progress() -> None:
    now = datetime.now(timezone.utc)
    expired = []
    for key, value in _PROGRESS.items():
        try:
            updated = datetime.fromisoformat(value.get("updated_at", ""))
        except Exception:
            expired.append(key)
            continue
        if now - updated > _TTL:
            expired.append(key)
    for key in expired:
        _PROGRESS.pop(key, None)
