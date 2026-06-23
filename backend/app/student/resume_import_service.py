"""简历文件导入：文本抽取 + LLM 结构化解析。

技术决策（E0）：不写规则解析器，不默认走多模态。
复用 file_text 抽取纯文本，用管理端配置的普通模型做 JSON 结构化。
扫描件（抽取文本 < 200 字）直接报错。解析只提取不创作。
"""
from __future__ import annotations

import json
import logging
import httpx
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.model_service import decrypt_api_key
from app.auth.service import AuthIdentity
from app.core.llm_client import is_anthropic_model
from app.student.file_text import extract_file_text, render_pdf_pages_to_png

logger = logging.getLogger(__name__)

# 扫描件阈值：抽取文本少于此值认为是扫描件
_SCANNER_THRESHOLD = 30  # 几乎为空时才走 OCR 兜底，避免误杀短简历
# 解析超时
_PARSE_TIMEOUT = 60


def extract_resume_file(file_bytes: bytes, filename: str, content_type: str) -> str:
    """从文件字节流抽取纯文本。返回空字符串表示扫描件或无法解析。"""
    import tempfile

    ext = Path(filename).suffix.lower()
    if ext not in {".pdf", ".docx", ".txt", ".md"}:
        return ""

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)
    try:
        return extract_file_text(tmp_path, content_type, ext, max_chars=30000)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def parse_resume_text_to_data(
    db: Session,
    identity: AuthIdentity,
    text: str,
    *,
    preferred_model_id: Optional[int] = None,
) -> dict[str, Any]:
    """用 LLM 将简历纯文本结构化为编辑器 data_json 子集。

    返回 generate_resume_data 的 input_schema 结构：basic / education / experience / projects / skills / self_evaluation。
    调用方负责将其转换为完整的编辑器 data_json。
    """
    from app.admin.models import ModelConfig

    # 选模型：优先指定 > 对学生开放的第一个 chat 模型
    model = None
    if preferred_model_id:
        model = db.get(ModelConfig, preferred_model_id)
    if not model:
        model = db.scalar(
            select(ModelConfig).where(
                ModelConfig.tenant_id == identity.tenant_id,
                ModelConfig.is_deleted.is_(False),
                ModelConfig.open_to_student.is_(True),
                ModelConfig.capability.in_(("text", "multimodal", "chat")),
                ModelConfig.status == "active",
            ).order_by(ModelConfig.id.asc())
        )
    if not model:
        raise ValueError("没有可用的模型，请管理员在模型广场开启「对学生开放」的模型")

    system_prompt = (
        "你是一个简历信息提取助手。你的任务是从用户提供的简历文本中提取结构化信息。\n\n"
        "## 铁律\n"
        "- **只提取原文中明确存在的信息，禁止补全、润色、编造任何内容**\n"
        "- 缺失的字段必须留空字符串或空数组，不要猜测\n"
        "- 时间格式统一为 YYYY-MM（如原文是「2022年6月」或「2022-06-01」，都转为 2022-06）\n"
        "- 时间段统一到年月（如「2022-06 - 2024-12」或「2022-06 - 至今」），不要保留具体日期\n"
        "- 经历的 details 每行一个要点，用换行分隔（保留原文的 bullet 符号或去掉都行）\n"
        "- 技能原文是什么就提取什么，不要添加你认为应该有的技能\n"
        "- 自我评价原文是什么就提取什么，不要改写\n"
    )

    user_prompt = f"请从以下简历文本中提取结构化信息：\n\n{text}"

    # 使用 function calling 保证输出是合法 JSON
    tools = [{
        "type": "function",
        "function": {
            "name": "save_resume_data",
            "description": "保存从简历中提取的结构化信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "basic": {
                        "type": "object",
                        "description": "基本信息",
                        "properties": {
                            "name": {"type": "string", "description": "姓名"},
                            "target_position": {"type": "string", "description": "目标职位/期望岗位"},
                            "email": {"type": "string"},
                            "phone": {"type": "string"},
                            "location": {"type": "string", "description": "所在城市"},
                            "birth_date": {"type": "string", "description": "出生日期 YYYY-MM"},
                        },
                    },
                    "education": {
                        "type": "array",
                        "description": "教育经历列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "school": {"type": "string"},
                                "major": {"type": "string"},
                                "degree": {"type": "string"},
                                "start_date": {"type": "string", "description": "YYYY-MM"},
                                "end_date": {"type": "string", "description": "YYYY-MM 或 至今"},
                                "gpa": {"type": "string"},
                                "description": {"type": "string", "description": "每行一个亮点，换行分隔"},
                            },
                        },
                    },
                    "experience": {
                        "type": "array",
                        "description": "工作/实习经历列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "company": {"type": "string"},
                                "position": {"type": "string"},
                                "date": {"type": "string", "description": "时间段"},
                                "details": {"type": "string", "description": "每行一个要点，换行分隔"},
                            },
                        },
                    },
                    "projects": {
                        "type": "array",
                        "description": "项目经历列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "role": {"type": "string"},
                                "date": {"type": "string", "description": "时间段"},
                                "description": {"type": "string", "description": "每行一个要点，换行分隔"},
                            },
                        },
                    },
                    "skills": {"type": "string", "description": "技能描述，原文提取，换行分隔"},
                    "self_evaluation": {"type": "string", "description": "自我评价，原文提取"},
                },
                "required": [],
            },
        },
    }]

    api_key = decrypt_api_key(model.api_key_cipher)
    base_url = (model.base_url or "https://api.openai.com/v1").rstrip("/")
    is_anthropic = is_anthropic_model(model.model_identifier)

    import httpx

    # 重试 1 次
    for attempt in range(2):
        try:
            result = _call_llm_for_parse(
                base_url, api_key, model.model_identifier, is_anthropic,
                system_prompt, user_prompt, tools,
            )
            if result is not None:
                return _normalize_parsed_data(result)
        except Exception as exc:
            logger.warning("简历解析 LLM 调用失败 attempt=%d: %s", attempt, exc)
            if attempt == 1:
                raise

    raise ValueError("模型未能返回有效的结构化数据，请重试")



def _raise_for_status_with_body(resp, endpoint_label: str, model_identifier: str) -> None:
    """Wrap resp.raise_for_status() so 4xx/5xx errors include the upstream body.

    Without this, httpx discards the response body and we only see a bare "400 Bad Request",
    which is useless for diagnosing upstream LLM errors (e.g. unknown model, invalid key,
    malformed request, balance exhausted, etc.)."""
    if resp.is_success:
        return
    body = resp.text
    if len(body) > 1000:
        body = body[:1000] + "..."
    logger.error(
        "LLM upstream error endpoint=%s model=%s status=%s body=%s",
        endpoint_label, model_identifier, resp.status_code, body,
    )
    detail = f"{resp.status_code} {resp.reason_phrase} from {endpoint_label} (model={model_identifier}): {body}"
    raise httpx.HTTPStatusError(detail, request=resp.request, response=resp)

def _call_llm_for_parse(
    base_url: str,
    api_key: str,
    model_identifier: str,
    is_anthropic: bool,
    system_prompt: str,
    user_prompt: str,
    tools: list[dict],
) -> Optional[dict[str, Any]]:
    """调用 LLM 解析简历文本，返回结构化数据。"""
    import httpx

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    with httpx.Client(timeout=_PARSE_TIMEOUT) as client:
        if is_anthropic:
            resp = client.post(
                f"{base_url}/v1/messages",
                headers={**headers, "x-api-key": api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": model_identifier,
                    "max_tokens": 4000,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}],
                    "tools": tools,
                },
            )
            _raise_for_status_with_body(resp, "chat/completions", model_identifier)
            data = resp.json()
            # Anthropic: 找 tool_use block
            for block in data.get("content", []):
                if block.get("type") == "tool_use" and block.get("name") == "save_resume_data":
                    return block.get("input", {})
            # 兜底：尝试从文本中提取 JSON
            for block in data.get("content", []):
                if block.get("type") == "text":
                    return _extract_json_from_text(block.get("text", ""))
        else:
            # Some reasoning/thinking models (e.g. deepseek with thinking enabled)
            # reject `tool_choice=function` outright. Try the function-calling form first
            # to keep the structured-output guarantee for normal models; on 400 that
            # complains about tool_choice, fall back to a plain prompt and let the
            # downstream _extract_json_from_text fallback handle the response.
            request_body = {
                "model": model_identifier,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "tools": tools,
                "tool_choice": {"type": "function", "function": {"name": "save_resume_data"}},
                "max_tokens": 4000,
            }
            resp = client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=request_body,
            )
            if resp.status_code == 400 and (b"tool_choice" in resp.content or b"thinking" in resp.content):
                logger.warning(
                    "upstream rejected tool_choice; retrying without forced tool_choice (model=%s)",
                    model_identifier,
                )
                fallback_body = {
                    "model": model_identifier,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": 4000,
                }
                resp = client.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json=fallback_body,
                )
            _raise_for_status_with_body(resp, "chat/completions", model_identifier)
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                message = choices[0].get("message", {})
                tool_calls = message.get("tool_calls", [])
                for tc in tool_calls:
                    if tc.get("function", {}).get("name") == "save_resume_data":
                        args_str = tc["function"].get("arguments", "{}")
                        return json.loads(args_str)
                # 兜底
                content = message.get("content", "")
                if content:
                    return _extract_json_from_text(content)
    return None


def _extract_json_from_text(text: str) -> Optional[dict[str, Any]]:
    """从文本中提取 JSON 对象。"""
    import re
    # 找 ```json ... ``` 块
    m = re.search(r"```json\s*\n?(.*?)\n?```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 找第一个 { ... } 块
    start = text.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    return None


def _normalize_parsed_data(data: dict[str, Any]) -> dict[str, Any]:
    """规范化 LLM 返回的结构化数据，确保字段完整。"""
    basic = data.get("basic") or {}
    return {
        "basic": {
            "name": str(basic.get("name") or "").strip(),
            "target_position": str(basic.get("target_position") or "").strip(),
            "email": str(basic.get("email") or "").strip(),
            "phone": str(basic.get("phone") or "").strip(),
            "location": str(basic.get("location") or "").strip(),
            "birth_date": str(basic.get("birth_date") or "").strip(),
        },
        "education": [
            {
                "school": str(e.get("school") or "").strip(),
                "major": str(e.get("major") or "").strip(),
                "degree": str(e.get("degree") or "").strip(),
                "start_date": str(e.get("start_date") or "").strip(),
                "end_date": str(e.get("end_date") or "").strip(),
                "gpa": str(e.get("gpa") or "").strip(),
                "description": str(e.get("description") or "").strip(),
            }
            for e in (data.get("education") or [])
            if isinstance(e, dict)
        ],
        "experience": [
            {
                "company": str(e.get("company") or "").strip(),
                "position": str(e.get("position") or "").strip(),
                "date": str(e.get("date") or "").strip(),
                "details": str(e.get("details") or "").strip(),
            }
            for e in (data.get("experience") or [])
            if isinstance(e, dict)
        ],
        "projects": [
            {
                "name": str(p.get("name") or "").strip(),
                "role": str(p.get("role") or "").strip(),
                "date": str(p.get("date") or "").strip(),
                "description": str(p.get("description") or "").strip(),
            }
            for p in (data.get("projects") or [])
            if isinstance(p, dict)
        ],
        "skills": str(data.get("skills") or "").strip(),
        "self_evaluation": str(data.get("self_evaluation") or "").strip(),
    }


# ================================================================
# Multi-modal OCR fallback
# ================================================================


class NoMultimodalModelError(ValueError):
    """Raised when no usable multimodal model is configured."""


def _find_open_multimodal_model(db, identity):
    """Find the first open_to_student multimodal model for the tenant."""
    from app.admin.models import ModelConfig
    return db.scalar(
        select(ModelConfig).where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.open_to_student.is_(True),
            ModelConfig.status == "active",
            ModelConfig.capability == "multimodal",
        ).order_by(ModelConfig.id.asc())
    )


def _resume_json_schema():
    return {
        "type": "object",
        "properties": {
            "basic": {"type": "object", "properties": {
                "name": {"type": "string"},
                "target_position": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "location": {"type": "string"},
                "birth_date": {"type": "string"},
            }},
            "education": {"type": "array", "items": {"type": "object"}},
            "experience": {"type": "array", "items": {"type": "object"}},
            "projects": {"type": "array", "items": {"type": "object"}},
            "skills": {"type": "string"},
            "self_evaluation": {"type": "string"},
        },
        "required": [],
    }


def _list_open_multimodal_models(db, identity):
    """List all active multimodal models configured for students, ordered by id."""
    from app.admin.models import ModelConfig
    return list(db.scalars(
        select(ModelConfig).where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.open_to_student.is_(True),
            ModelConfig.status == "active",
            ModelConfig.capability == "multimodal",
        ).order_by(ModelConfig.id.asc())
    ).all())


def _is_ocr_result_useful(result):
    """检查 OCR 返回是否包含任何真实信息（用于在多模型间自动 fallback）。

    真实 OCR 至少应该读出姓名 / 邮箱 / 电话之一，或能识别出教育 / 工作 / 项目中的一项。
    如果全部为空，说明模型没读出图，应尝试下一个模型。
    """
    if not isinstance(result, dict):
        return False
    basic = result.get("basic") or {}
    if isinstance(basic, dict):
        for key in ("name", "email", "phone", "target_position"):
            if str(basic.get(key) or "").strip():
                return True
    for section in ("education", "experience", "projects"):
        if result.get(section):
            return True
    if str(result.get("skills") or "").strip():
        return True
    if str(result.get("self_evaluation") or "").strip():
        return True
    return False


def parse_resume_images_to_data(db, identity, page_images):
    """Use a multimodal model to extract structured resume data from page images.

    Tries each configured multimodal model in order. A model is considered failed if it:
    - raises an exception during the call,
    - returns hallucinated placeholder content (e.g. John Doe),
    - returns an empty / useless result (model cannot actually see the image).
    In any of those cases we move to the next model automatically.
    """
    import base64
    if not page_images:
        raise NoMultimodalModelError("no page images to recognize")
    models = _list_open_multimodal_models(db, identity)
    if not models:
        raise NoMultimodalModelError("no multimodal model configured for students")
    system_prompt = (
        "You are a resume information extraction assistant. You will be given photos/scans of a resume and you must extract the visible information.\n"
        "## Rules\n"
        "- ONLY extract information that is CLEARLY VISIBLE in the images. NEVER fill in, guess, or invent any content.\n"
        "- The resume may be written in Chinese, English, or any other language. Preserve the original language and wording exactly as they appear in the image.\n"
        "- NEVER use placeholder strings such as “John Doe”, “Jane Doe”, “Software Developer”, “example@email.com”, “(123) 456-7890”, “New York, NY”, “Tech Innovations”, “CodeMasters”, etc. These are sample-data hallucinations and are strictly forbidden.\n"
        "- If a field cannot be read clearly, return an empty string (or empty array). An empty result is always preferable to a wrong result.\n"
        "- Date format: unify to YYYY-MM (for example, “June 2022” becomes 2022-06; “2023.9” becomes 2023-09; remove exact days).\n"
        "- For experience/project details, keep one bullet per line, separated by newlines. Preserve the original wording.\n"
        "- Extract skills exactly as written, do not add skills you think should be there.\n"
        "- If the images do not look like a resume at all (or you cannot read them), still return a best-effort empty structure rather than fabricating a sample resume.\n"
    )
    user_text = (
        "Read the following resume page images and extract the visible information.\n"
        "Strict reminders:\n"
        "1. Output ONLY what is actually written in the images.\n"
        "2. NEVER substitute placeholder names like John Doe / example@email.com / Software Developer.\n"
        "3. If a field is unreadable or absent, leave it empty.\n"
        "4. Preserve the original language (Chinese/English/etc.) exactly as shown.\n"
        "5. Return empty structures rather than fabricating content.\n"
    )
    tools = [{"type": "function", "function": {"name": "save_resume_data", "description": "Save the extracted structured resume data", "parameters": _resume_json_schema()}}]
    failures = []
    for model_index, model in enumerate(models):
        base_url = (model.base_url or "https://api.openai.com/v1").rstrip("/")
        api_key = decrypt_api_key(model.api_key_cipher)
        is_anthropic = is_anthropic_model(model.model_identifier)
        def _build_messages(text):
            parts = [{"type": "text", "text": text}]
            for png in page_images:
                if is_anthropic:
                    parts.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(png).decode("ascii")}})
                else:
                    parts.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode("ascii")}})
            return [{"role": "user", "content": parts}]
        messages_payload = _build_messages(user_text)
        last_error = "empty result"
        for attempt in range(2):
            try:
                result = _call_llm_for_parse_multimodal(
                    base_url, api_key, model.model_identifier, is_anthropic,
                    system_prompt, messages_payload, tools,
                )
                if result is not None:
                    if _looks_like_hallucinated_resume(result):
                        logger.warning(
                            "resume OCR model=%s returned hallucinated template content (attempt=%d); %s",
                            model.model_identifier, attempt,
                            "retrying with stricter guidance" if attempt == 0 else "moving to next model",
                        )
                        last_error = "hallucinated"
                        if attempt == 0:
                            messages_payload = _build_messages(
                                user_text + "\n\nPrevious attempt returned placeholder sample data (e.g. John Doe). You MUST re-read the image and output only what is actually visible. Empty fields are acceptable.",
                            )
                            continue
                        break  # move to next model
                    if not _is_ocr_result_useful(result):
                        logger.warning(
                            "resume OCR model=%s returned empty/useless result (attempt=%d); moving to next model",
                            model.model_identifier, attempt,
                        )
                        last_error = "empty result (model may not be truly multimodal or cannot read this image)"
                        break  # move to next model
                    return _normalize_parsed_data(result)
            except Exception as exc:
                logger.warning("resume OCR LLM call failed model=%s attempt=%d: %s", model.model_identifier, attempt, exc)
                last_error = "exception: " + str(exc)[:120]
                if attempt == 1:
                    break  # move to next model
        failures.append(model.model_identifier + " (" + last_error + ")")
    # 所有多模态模型都失败 / 返回空 / 幻觉时
    raise ValueError(
        "OCR 模型未能正确识别简历内容。已尝试 %d 个多模态模型：%s。\n"
        "可能原因：1) 配置的多模态模型实际是纯文本模型，看不见图片；2) 模型对中文 / 设计型 PDF 识别能力不足；3) 简历图片分辨率太低。\n"
        "建议：请管理员在「模型广场」换用真正的视觉模型（如 qwen-vl-max / gpt-4o / claude-3.5-sonnet），或让学生换用文字版 PDF。"
        % (len(models), "; ".join(failures))
    )


# ============================================================
# Hallucination detection for OCR results
# ============================================================

_HALLUCINATION_MARKERS = (
    # 训练数据里典型的英文简历模板字串
    "john doe",
    "jane doe",
    "john smith",
    "software developer",
    "example@email.com",
    "your.email@example.com",
    "(123) 456-7890",
    "(555) 123-4567",
    "new york, ny",
    "san francisco, ca",
    "tech innovations",
    "codemasters",
    "codeconnect",
    "learntocode",
    "acme corp",
    "acme corporation",
    "bachelor of science in computer science",
    "javascript, python, java",
    "agile methodologies",
)

def _looks_like_hallucinated_resume(result: dict[str, Any]) -> bool:
    """检查模型是否吐出了训练数据里典型的占位符示例简历。

    真实简历不会用 John Doe / example@email.com / (123) 456-7890 这种占位符。
    如果基础信息、工作/项目里出现这些明显是模板的字符串，几乎可以肯定是模型幻觉。
    """
    if not isinstance(result, dict):
        return False
    # 收集所有可能包含占位符的字段
    blob_parts: list[str] = []
    basic = result.get("basic") or {}
    if isinstance(basic, dict):
        for key in ("name", "target_position", "email", "phone", "location", "birth_date"):
            blob_parts.append(str(basic.get(key) or ""))
    for section in ("experience", "projects"):
        for item in (result.get(section) or []):
            if isinstance(item, dict):
                blob_parts.append(str(item.get("company") or ""))
                blob_parts.append(str(item.get("name") or ""))
                blob_parts.append(str(item.get("position") or ""))
    blob = " | ".join(blob_parts).lower()
    if not blob.strip():
        return False
    for marker in _HALLUCINATION_MARKERS:
        if marker in blob:
            return True
    return False
def _call_llm_for_parse_multimodal(base_url, api_key, model_identifier, is_anthropic, system_prompt, messages_payload, tools):
    import httpx
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=_PARSE_TIMEOUT) as client:
        if is_anthropic:
            resp = client.post(
                f"{base_url}/v1/messages",
                headers={**headers, "x-api-key": api_key, "anthropic-version": "2023-06-01"},
                json={"model": model_identifier, "max_tokens": 4000, "system": system_prompt, "messages": messages_payload, "tools": tools},
            )
            _raise_for_status_with_body(resp, "messages-multimodal", model_identifier)
            data = resp.json()
            for block in data.get("content", []):
                if block.get("type") == "tool_use" and block.get("name") == "save_resume_data":
                    return block.get("input", {})
                if block.get("type") == "text":
                    return _extract_json_from_text(block.get("text", ""))
        else:
            resp = client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={"model": model_identifier, "messages": [{"role": "system", "content": system_prompt}] + messages_payload, "tools": tools, "tool_choice": {"type": "function", "function": {"name": "save_resume_data"}}, "max_tokens": 4000},
            )
            _raise_for_status_with_body(resp, "chat/completions-multimodal", model_identifier)
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                message = choices[0].get("message", {})
                tool_calls = message.get("tool_calls", [])
                for tc in tool_calls:
                    if tc.get("function", {}).get("name") == "save_resume_data":
                        args_str = tc["function"].get("arguments", "{}")
                        return json.loads(args_str)
                content = message.get("content", "")
                if content:
                    return _extract_json_from_text(content)
    return None
