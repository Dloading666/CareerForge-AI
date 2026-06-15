"""IP-based global rate-limit middleware.

Counts requests per client IP in a fixed window using Redis. If Redis is
unavailable the middleware fails OPEN (logs and lets the request through) so
a Redis outage never blocks business traffic.

Configured via env (see Settings):
  API_RATE_LIMIT_RPS        default 200
  API_RATE_LIMIT_WINDOW     default 60 (seconds)

Exempt paths (always allowed): /healthz, /docs, /openapi.json, /redoc, static mounts.
"""
from __future__ import annotations

import logging
from typing import Iterable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.infra.redis_client import get_redis

logger = logging.getLogger(__name__)


_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/healthz",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/data/",
    "/static/",
    "/uploads/",
)


def _client_ip(request: Request) -> str:
    # Honor X-Forwarded-For when behind Nginx / load balancer; fall back to socket peer.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _is_exempt(path: str) -> bool:
    if path in _EXEMPT_PREFIXES:
        return True
    return any(path.startswith(p) for p in _EXEMPT_PREFIXES)


class IPRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, rps: int | None = None, window: int | None = None) -> None:
        super().__init__(app)
        settings = get_settings()
        self.rps = rps if rps is not None else settings.api_rate_limit_rps
        self.window = window if window is not None else settings.api_rate_limit_window_seconds

    async def dispatch(self, request: Request, call_next):
        if self.rps <= 0 or _is_exempt(request.url.path):
            return await call_next(request)

        ip = _client_ip(request)
        key = f"ratelimit:{ip}:{request.url.path}"
        try:
            redis = get_redis()
            count = redis.incr(key)
            if count == 1:
                redis.expire(key, self.window)
            if count > self.rps:
                logger.warning("rate limit hit: ip=%s path=%s count=%s", ip, request.url.path, count)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "rate limit exceeded"},
                )
        except Exception as exc:  # noqa: BLE001 - intentional fail-open
            logger.warning("rate limit redis error (fail-open): %s", exc)

        return await call_next(request)