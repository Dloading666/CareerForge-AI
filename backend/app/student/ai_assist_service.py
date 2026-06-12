# AI assist for resume fields: optimize / quantify / rewrite suggestions.
# Reuses the same text-model fallback chain as resume_import_service.
from __future__ import annotations

import json
import logging
import re
from typing import Any, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.models import ModelConfig
from app.core.llm_client import chat_completion

logger = logging.getLogger(__name__)

_SECTION_LABELS = {
    "experience": "工作经历条目 (岗位职责 / 工作内容与成果)",
    "project": "项目经历条目 (项目亮点 / 关键职责)",
    "education": "教育经历条目 (亮点 / 课程 / 校园经历)",
    "skill": "专业技能列表",
    "selfEvaluation": "自我评价段落",
    "summary": "个人简介 / 期望岗位概述",
}

# Each instruction maps to a different rewrite intent. The system prompt
# is rebuilt per call so we can swap in the user custom text when they
# pick the 'custom' instruction.
_INSTRUCTION_PROMPTS = {
    "polish": "请润色并提升表述质量, 使其更适合中文简历场景; 保留事实, 不要新增虚假信息.",
    "quantify": "请在保留原意的基础上加入可量化的数据占位 (如“提升 X%”、“服务 X 万用户”), 如果原文中没有可量化信息请保持原文.",
    "concise": "请在不丢失关键信息的前提下精简表述, 单行不超过 30 个汉字.",
    "expand": "请适度展开表述, 补足同类工作场景中常见的关键动作或结果 (不要编造公司/项目专有名词).",
    "translate_en": "请把内容翻译为简洁的英文简历表述, 保留专有名词 (如公司名、产品名).",
}

_DEFAULT_INSTRUCTION = "请按用户给定的指令改写; 保留事实, 不得编造公司/学校/产品名称/数据; 输出使用中文 (除非指定翻译)."


def _list_text_models(db: Session):
    stmt = (
        select(ModelConfig)
        .where(
            ModelConfig.is_deleted == False,
            ModelConfig.status == 'active',
            ModelConfig.open_to_student == True,
            ModelConfig.capability.in_(['text', 'multimodal']),
        )
        .order_by(ModelConfig.id.desc())
    )
    return list(db.execute(stmt).scalars().all())


def list_available_models(db: Session) -> List[dict]:
    """Return the student-visible text/multimodal models.

    Returned shape is a plain list of dicts so the API layer doesn't leak
    ORM objects. Includes id / displayName / provider / capability /
    modelIdentifier so the frontend can render a model picker.
    """
    out: List[dict] = []
    for m in _list_text_models(db):
        out.append({
            "id": m.id,
            "displayName": m.display_name,
            "provider": m.provider,
            "capability": m.capability,
            "modelIdentifier": m.model_identifier,
        })
    return out


def _build_system_prompt(
    section: str,
    instruction_key: str,
    has_jd: bool,
    custom_instruction: Optional[str] = None,
) -> str:
    label = _SECTION_LABELS.get(section, "简历文本")
    if instruction_key == 'custom' and custom_instruction and custom_instruction.strip():
        specific = "用户自定义改写指令: " + custom_instruction.strip()
    else:
        specific = _INSTRUCTION_PROMPTS.get(instruction_key, _DEFAULT_INSTRUCTION)
    jd_clause = (
        "请同时参考用户提供的目标岗位描述 (JD), 尽量贴近该 JD 的关键词与能力要求."
        if has_jd
        else "用户没有提供 JD, 请按通用简历标准改写."
    )
    return (
        'You are a resume writing assistant. '
        'You receive the candidate text and must return a single strict JSON object (no prose, no markdown fences). '
        '{"suggested": "<the rewritten text>"}. '
        f'Target section: {label}. '
        f'Task: {specific} {jd_clause} '
        'Rules: 1) Never invent company names, school names, product names, or numeric metrics. '
        '2) Keep the same language as the original (Chinese stays Chinese, English stays English). '
        '3) Preserve bullet/list structure if the original uses <ul>/<ol>. '
        '4) Output JSON only.'
    )


def _extract_json_object(text):
    # type: (str) -> dict | None
    if not text:
        return None
    text = text.strip()
    if text.startswith('`' * 3):
        text = re.sub(r'^`{3}(?:json)?', '', text, flags=re.IGNORECASE).strip()
        if text.endswith('`' * 3):
            text = text[:-3].strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except Exception:
            return None
    return None


def ai_assist_field(
    db: Session,
    *,
    section: str,
    instruction_key: str,
    current_text: str,
    jd_text=None,
    model_id=None,
    custom_instruction=None,
):
    # type: (...) -> dict[str, Any]
    """Call the LLM to rewrite a single resume field.

    Returns: {"suggested": str, "model": str, "modelId": int, "instruction": str}
    Raises ValueError on failure.

    When ``model_id`` is provided we honour the student pick and only
    try that model. Otherwise we fall back through every active model
    the admin has opened to students.
    """
    available = _list_text_models(db)
    if not available:
        raise ValueError("暂无对学生开放的文本模型, 请联系管理员在模型广场开启.")
    if model_id is not None:
        pinned = next((m for m in available if m.id == int(model_id)), None)
        if pinned is None:
            raise ValueError("选择的模型不可用, 请重新选择.")
        candidates = [pinned]
    else:
        candidates = available

    system_prompt = _build_system_prompt(
        section,
        instruction_key,
        bool(jd_text and jd_text.strip()),
        custom_instruction=custom_instruction,
    )
    user_parts = ['Original text:\n' + (current_text or '')]
    if jd_text and jd_text.strip():
        user_parts.append('\nTarget JD (for keyword alignment):\n' + jd_text.strip()[:3000])
    user_parts.append('\nReturn JSON: {"suggested": "<rewritten text>"}')
    user_message = '\n'.join(user_parts)

    last_error = ''
    for model in candidates:
        for retry in range(2):
            try:
                result = chat_completion(
                    model,
                    system_prompt=system_prompt,
                    variables={},
                    memory=[],
                    user_message=user_message,
                    temperature=0.4,
                    max_tokens=min(int(getattr(model, 'max_output', 2048) or 2048), 2048),
                    top_p=0.9,
                )
                reply = (result or {}).get('reply') or ''
                parsed = _extract_json_object(reply)
                if parsed and isinstance(parsed.get('suggested'), str):
                    return {
                        'suggested': parsed['suggested'].strip(),
                        'model': model.display_name or model.model_identifier or ('model#' + str(model.id)),
                        'modelId': model.id,
                        'instruction': instruction_key,
                    }
                last_error = 'model #%s (%s) returned invalid JSON' % (model.id, model.display_name)
                logger.warning('ai-assist retry %s: %s', retry, last_error)
            except Exception as exc:
                last_error = 'model #%s (%s) failed: %s' % (model.id, model.display_name, str(exc)[:160])
                logger.exception('ai-assist LLM call failed (retry %s)', retry)
        if len(candidates) > 1:
            logger.info('ai-assist falling back to next model after %s', last_error)
    raise ValueError('LLM call failed: ' + last_error[:240])
