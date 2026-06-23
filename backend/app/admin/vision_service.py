from __future__ import annotations

import base64
import logging
from datetime import datetime
from typing import Any, Literal, Optional

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.vision_models import VisionModelConfig
from app.core.security import decrypt_api_key, encrypt_api_key

logger = logging.getLogger(__name__)


VisionProtocol = Literal["openai", "anthropic"]


# ── Pydantic Schemas ─────────────────────────────────────────────────


class VisionConfigResponse(BaseModel):
    """视觉配置响应。出于安全，API Key 只返回 has_api_key 布尔，绝不回明文。"""

    id: int
    tenant_id: int
    enabled: bool
    protocol: str
    base_url: Optional[str]
    model_name: Optional[str]
    has_api_key: bool
    max_tokens: int
    updated_at: datetime
    model_config = {"from_attributes": True}


class VisionConfigUpdate(BaseModel):
    """视觉配置更新。api_key 为明文：传非空=改密钥；不传该字段=保留原值。"""

    enabled: Optional[bool] = None
    protocol: Optional[VisionProtocol] = None
    base_url: Optional[str] = Field(default=None, max_length=512)
    model_name: Optional[str] = Field(default=None, max_length=256)
    # 明文 API Key；None（未传字段）=保留，空串=清空，非空=覆盖
    api_key: Optional[str] = Field(default=None, max_length=2048)
    max_tokens: Optional[int] = Field(default=None, ge=100, le=32000)


class VisionTestResult(BaseModel):
    success: bool
    latency_ms: Optional[int] = None
    error: Optional[str] = None
    preview: Optional[str] = None  # 模型对测试图的描述（截断）


# ── Service ──────────────────────────────────────────────────────────


def _select_config(db: Session, tenant_id: int) -> Optional[VisionModelConfig]:
    return db.scalar(
        select(VisionModelConfig).where(VisionModelConfig.tenant_id == tenant_id)
    )


def _to_response(row: VisionModelConfig) -> VisionConfigResponse:
    return VisionConfigResponse(
        id=row.id,
        tenant_id=row.tenant_id,
        enabled=row.enabled,
        protocol=row.protocol,
        base_url=row.base_url,
        model_name=row.model_name,
        has_api_key=bool(row.api_key_cipher),
        max_tokens=row.max_tokens,
        updated_at=row.updated_at,
    )


def get_or_create_vision_config(db: Session, tenant_id: int = 0) -> VisionConfigResponse:
    """读取当前租户的视觉配置；不存在则建一行默认空配置。"""
    row = _select_config(db, tenant_id)
    if row is None:
        row = VisionModelConfig(tenant_id=tenant_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return _to_response(row)


def update_vision_config(
    db: Session, payload: VisionConfigUpdate, tenant_id: int = 0
) -> VisionConfigResponse:
    """upsert 视觉配置。

    api_key 语义：
    - 字段未出现在请求里（exclude_unset 不含）→ 保留原密钥
    - 传了空串 → 清空密钥
    - 传了非空 → 加密后覆盖
    """
    data = payload.model_dump(exclude_unset=True)
    row = _select_config(db, tenant_id)
    if row is None:
        row = VisionModelConfig(tenant_id=tenant_id)
        db.add(row)

    # api_key 单独处理（需要加密，且要区分「未传」和「传空」）
    if "api_key" in data:
        plain = data.pop("api_key")
        if plain:
            row.api_key_cipher = encrypt_api_key(plain)
        else:
            row.api_key_cipher = None

    for field, value in data.items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
    return _to_response(row)


def get_vision_runtime_config(
    db: Session, tenant_id: int
) -> Optional[dict[str, Any]]:
    """供 agent_runtime 调用：返回视觉配置的运行时形态（含明文 api_key）。

    多租户隔离：按 tenant_id 过滤。任一关键字段缺失或总开关关闭则返回 None，
    调用方据此判定「视觉模型未配置」。
    """
    row = _select_config(db, tenant_id)
    if row is None or not row.enabled:
        return None
    if not (row.base_url and row.model_name and row.api_key_cipher):
        return None
    api_key = decrypt_api_key(row.api_key_cipher)
    if not api_key:
        return None
    return {
        "protocol": row.protocol,
        "base_url": row.base_url,
        "model_name": row.model_name,
        "api_key": api_key,
        "max_tokens": row.max_tokens,
    }


# ── 连接测试 ─────────────────────────────────────────────────────────


def _build_test_image_b64() -> str:
    """生成一张用于连接测试的 PNG（base64）。

    用 480x300 的渐变图（含可见内容），而不是 1x1 透明像素——很多视觉模型
    （如智谱 GLM-4V）会拒绝「太小/无内容」的图并返回「图片输入格式/解析错误」。
    依赖 PIL；若 PIL 不可用则回退到预生成的固定图。
    """
    try:
        import io
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (480, 300), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        # 渐变色块：让图有足够内容供视觉模型解析
        for x in range(480):
            r = int(30 + (x / 480) * 200)
            g = int(100 + (x / 480) * 100)
            b = int(200 - (x / 480) * 100)
            draw.line([(x, 0), (x, 300)], fill=(r, g, b))
        # 中心画一个白色方块 + 文字（若无字体则跳过文字）
        draw.rectangle([180, 120, 300, 180], fill=(255, 255, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        logger.debug("PIL unavailable for test image; using fallback PNG")
        # 回退：预生成的 480x300 蓝白渐变 PNG
        return (
            "iVBORw0KGgoAAAANSUhEUgAAAbAAAAEsCAYAAAAkS8YOAAAB60lEQVR4nO3BMQEA"
            "AAjDMMC/52ZAlSlxwwYNGjRowIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIAB"
            "AwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYM"
            "GDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBg"
            "wIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIAB"
            "AwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYM"
            "GDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBg"
            "wIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIAB"
            "AwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwAA"
            "AAD/Z5tY6wUPvR8AAAAASUVORK5CYII="
        )


def test_vision_config(db: Session, tenant_id: int = 0) -> VisionTestResult:
    """用当前配置实际发一次最小视觉请求，验证 base_url/key/model_name 是否可用。"""
    cfg = get_vision_runtime_config(db, tenant_id)
    if cfg is None:
        return VisionTestResult(
            success=False,
            error="视觉模型未配置完整（需填写协议、Base URL、模型名、API Key 并启用）。",
        )

    import time

    protocol = cfg["protocol"]
    base = (cfg["base_url"] or "").rstrip("/")
    model_name = cfg["model_name"]
    api_key = cfg["api_key"]
    max_tokens = min(300, cfg["max_tokens"])

    user_message = "请用一句话描述这张图片。"
    test_img_b64 = _build_test_image_b64()
    start = time.perf_counter()
    try:
        if protocol == "anthropic":
            # ── Anthropic 协议：/v1/messages，图片用 source.base64 ──
            api_base = base
            if api_base.endswith("/anthropic"):
                api_base = f"{api_base}/v1"
            elif not api_base.endswith("/v1"):
                api_base = f"{api_base}/v1"
            body = {
                "model": model_name,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_message},
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": test_img_b64,
                                },
                            },
                        ],
                    }
                ],
                "max_tokens": max_tokens,
                "stream": False,
            }
            headers = {
                "x-api-key": api_key,
                "api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            }
            with httpx.Client(timeout=httpx.Timeout(30)) as client:
                resp = client.post(f"{api_base}/messages", json=body, headers=headers)
        else:
            # ── OpenAI 协议：/chat/completions，图片用 image_url ──
            data_url = f"data:image/png;base64,{test_img_b64}"
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_message},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ]
            body = {
                "model": model_name,
                "messages": messages,
                "max_tokens": max_tokens,
                "stream": False,
            }
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            with httpx.Client(timeout=httpx.Timeout(30)) as client:
                resp = client.post(f"{base}/chat/completions", json=body, headers=headers)

        latency_ms = int((time.perf_counter() - start) * 1000)
        if resp.status_code != 200:
            logger.warning(
                "vision test failed: %s %s", resp.status_code, resp.text[:300]
            )
            return VisionTestResult(
                success=False,
                latency_ms=latency_ms,
                error=f"视觉模型返回 HTTP {resp.status_code}：{resp.text[:200]}",
            )

        # 解析响应，提取描述文本（响应体可能非 JSON，如网关返回的 HTML 错误页）
        try:
            body = resp.json()
        except (ValueError, TypeError):
            return VisionTestResult(
                success=False,
                latency_ms=latency_ms,
                error=f"响应不是合法 JSON（可能是网关错误页）：{resp.text[:200]}",
            )
        description = _extract_description(body, protocol)
        if not description:
            return VisionTestResult(
                success=True,
                latency_ms=latency_ms,
                error="连接成功，但模型未返回文字描述（响应结构异常）。",
            )
        return VisionTestResult(
            success=True,
            latency_ms=latency_ms,
            preview=(description[:120] if description else None),
        )
    except httpx.HTTPError as exc:
        return VisionTestResult(success=False, error=f"网络连接失败：{str(exc)[:200]}")
    except Exception as exc:  # noqa: BLE001 — 测试接口要把任何异常都回报给管理员
        logger.exception("vision test unexpected error")
        return VisionTestResult(success=False, error=f"测试异常：{str(exc)[:200]}")


def _extract_description(data: dict[str, Any], protocol: str) -> str:
    """从视觉模型响应里提取描述文本。"""
    if protocol == "anthropic":
        parts: list[str] = []
        for block in (data.get("content") or []):
            if block.get("type") == "text":
                parts.append(block.get("text") or "")
        return "".join(parts)
    choices = data.get("choices") or []
    if not choices:
        return ""
    return choices[0].get("message", {}).get("content", "") or ""