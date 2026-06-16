from __future__ import annotations

import base64
import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.models import ModelConfig
from app.auth.service import AuthIdentity
from app.core.llm_client import voice_chat_completion
from app.interview.exceptions import InterviewError

VOICE_TRANSCRIPT_SYSTEM_PROMPT = """你是一个音频转写模块。你会收到一段候选人的语音音频。

你的唯一任务是：将音频内容准确转写为文字。

只输出 JSON：
{
  "text": "音频转写的完整文字内容",
  "language": "zh-CN",
  "confidence": 0.9
}

不要评价、补写、改写或生成面试问题。无法识别时 text 返回空字符串。
"""

VOICE_ALLOWED_MIME_PREFIXES = ("audio/", "video/webm", "application/octet-stream")
VOICE_MAX_AUDIO_BYTES = 10 * 1024 * 1024


def infer_audio_format(content_type: str | None, filename: str | None = None) -> str:
    normalized_type = (content_type or "").lower()
    normalized_name = (filename or "").lower()
    source = f"{normalized_type} {normalized_name}"
    if "wav" in source or normalized_name.endswith(".wave"):
        return "wav"
    if "mp3" in source or "mpeg" in source or normalized_name.endswith(".mpga"):
        return "mp3"
    if "ogg" in source or "oga" in source:
        return "ogg"
    if "mp4" in source or "m4a" in source or normalized_name.endswith((".mp4", ".m4a")):
        return "mp4"
    if "webm" in source or normalized_name.endswith(".webm"):
        return "webm"
    return "webm"


def validate_voice_audio(audio_bytes: bytes, content_type: str | None, filename: str | None = None) -> str:
    content_type = content_type or ""
    lower_name = (filename or "").lower()
    has_known_extension = lower_name.endswith((".webm", ".wav", ".mp3", ".mpeg", ".mpga", ".ogg", ".oga", ".mp4", ".m4a"))
    if not any(content_type.startswith(prefix) for prefix in VOICE_ALLOWED_MIME_PREFIXES) and not has_known_extension:
        raise InterviewError(
            status_code=400,
            detail=f"不支持的文件类型：{content_type or filename or 'unknown'}，请上传 webm/wav/mp3/ogg/m4a 音频。",
        )
    if len(audio_bytes) > VOICE_MAX_AUDIO_BYTES:
        raise InterviewError(status_code=400, detail=f"音频文件过大（{len(audio_bytes) // (1024 * 1024)}MB），最大支持 10MB")
    if len(audio_bytes) < 100:
        raise InterviewError(status_code=400, detail="音频数据过短，请重新录音")
    return infer_audio_format(content_type, filename)


def candidate_voice_models(
    db: Session,
    identity: AuthIdentity,
    preferred_model_id: int | None = None,
) -> list[ModelConfig]:
    base_filter = (
        ModelConfig.tenant_id == identity.tenant_id,
        ModelConfig.is_deleted.is_(False),
        ModelConfig.status == "active",
        ModelConfig.open_to_student.is_(True),
        ModelConfig.api_key_cipher.is_not(None),
    )
    models: list[ModelConfig] = []
    for capability in ("voice_multimodal", "multimodal", "chat"):
        models.extend(list(db.scalars(
            select(ModelConfig).where(*base_filter, ModelConfig.capability == capability).order_by(ModelConfig.id.asc())
        ).all()))
    if preferred_model_id:
        models.sort(key=lambda item: 0 if item.id == preferred_model_id else 1)
    return models


def extract_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        return None


def transcribe_voice_audio_sync(
    db: Session,
    identity: AuthIdentity,
    *,
    audio_bytes: bytes,
    content_type: str,
    filename: str | None = None,
) -> dict:
    audio_format = validate_voice_audio(audio_bytes, content_type, filename)
    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
    models = candidate_voice_models(db, identity, None)
    if not models:
        raise InterviewError(status_code=503, detail="暂无支持语音转写的模型，请联系管理员配置。")

    model_errors: list[str] = []
    for model in models:
        model_name = getattr(model, "display_name", None) or getattr(model, "model_name", None) or "voice_model"
        try:
            result = voice_chat_completion(
                model,
                system_prompt=VOICE_TRANSCRIPT_SYSTEM_PROMPT,
                audio_base64=audio_base64,
                audio_format=audio_format,
                temperature=0.1,
                max_tokens=1000,
            )
            parsed = extract_json(result["reply"])
            if parsed and parsed.get("text"):
                return {
                    "text": str(parsed["text"]).strip(),
                    "language": str(parsed.get("language", "zh-CN")),
                    "confidence": float(parsed.get("confidence", 0.8)),
                    "audio_format": audio_format,
                    "audio_size_bytes": len(audio_bytes),
                }
            model_errors.append(f"{model_name}: empty transcript")
        except Exception as exc:  # noqa: BLE001 - provider errors are user-actionable here.
            model_errors.append(f"{model_name}: {str(exc)[:240]}")

    detail = "音频转写失败，未识别到有效内容。请重新录音或切换为文字模式。"
    if model_errors:
        detail = f"{detail} 模型返回：{'; '.join(model_errors[:3])}"
    raise InterviewError(status_code=422, detail=detail)
