"""可信客户端 IP 提取。

直接信任 X-Forwarded-For 可被伪造，绕过按 IP 的限流。
默认只信任 socket 真实对端；仅当配置了前置可信代理跳数
（TRUSTED_PROXY_COUNT）时，才从 XFF 提取真实客户端。
"""
from __future__ import annotations

from typing import Optional

from fastapi import Request

from app.core.config import get_settings


def trusted_client_ip(
    request: Request,
    x_forwarded_for: Optional[str] = None,
) -> Optional[str]:
    """返回用于限流的客户端 IP。

    本函数被 auth/router 各端点和 rate_limit 中间件直接调用（非 FastAPI 依赖注入），
    XFF 由调用方从 request 头取出后传入。

    - 无 XFF：返回 socket 对端 IP（最可信）。
    - 有 XFF 但 TRUSTED_PROXY_COUNT=0：忽略 XFF，返回 socket 对端（默认，最安全）。
    - 有 XFF 且 TRUSTED_PROXY_COUNT=N>0：取 XFF 倒数第 N 段
      （跳过 N 跳可信代理后，其左边一位是真实客户端）。
    """
    settings = get_settings()
    socket_ip = request.client.host if request.client else None
    xff = (x_forwarded_for or "").strip()
    if not xff:
        return socket_ip
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    n = max(0, getattr(settings, "trusted_proxy_count", 0))
    if n == 0:
        return socket_ip  # 不信任任何 XFF
    # 从右往左数 N 跳可信代理，其左边一位是真实客户端
    idx = len(parts) - n - 1
    return parts[idx] if idx >= 0 else socket_ip
