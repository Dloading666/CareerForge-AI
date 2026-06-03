from __future__ import annotations

import logging

import redis as _redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_client: _redis.Redis | None = None


def get_redis() -> _redis.Redis:
    global _client
    if _client is None:
        settings = get_settings()
        _client = _redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def ping_redis() -> bool:
    try:
        get_redis().ping()
        return True
    except Exception as exc:
        logger.warning("Redis not reachable: %s", exc)
        return False
