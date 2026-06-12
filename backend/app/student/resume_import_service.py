# Auto-generated stub for resume import (PDF/DOCX/JSON via LLM).
# Created to fix /api/v1/student/resumes/import/file 500 error on master branch.
from __future__ import annotations

import io
import json
import logging
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.models import ModelConfig
from app.core.llm_client import chat_completion

logger = logging.getLogger(__name__)

_SCANNER_THRESHOLD = 50

_IMPORT_SYSTEM_PROMPT = (
    "You are a resume parsing assistant. You receive the raw text content of a candidate resume "
    "(extracted from a PDF or DOCX) and must return a single strict JSON object (no prose, no markdown). "
    "Output schema (all keys are required, arrays may be empty, strings may be empty): "
    "{ basic: {name, target_position, email, phone, location, birth_date}, "
    "education: [{school, major, degree, start_date, end_date, gpa, description}], "
    "experience: [{company, position, date, details}], "
    "projects: [{name, role, date, description}], "
    "skills: str, self_evaluation: str }. "
    "Rules: 1) Do not invent information. If a field is missing, return an empty string or empty array. "
    "2) Normalize date formats to YYYY-MM or YYYY-MM-DD when possible; otherwise keep what is in the source. "
    "3) Trim whitespace. Do not wrap the JSON in markdown fences. "
    "4) Keep at most 10 entries per list. "
    "5) Respond with JSON only."
)


def extract_resume_file(content, filename, hint_text=""):
    ext = Path(filename or "resume").suffix.lower()
    try:
        if ext == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            parts = []
            for page in reader.pages[:20]:
                try:
                    txt = page.extract_text() or ""
                except Exception:
                    txt = ""
                if txt.strip():
                    parts.append(txt)
            text = "\n".join(parts)
        elif ext == ".docx":
            from docx import Document
            doc = Document(io.BytesIO(content))
            text = "\n".join(p.text for p in doc.paragraphs if (p.text or "").strip())
        elif ext in (".txt", ".md"):
            text = content.decode("utf-8", errors="replace")
        else:
            raise ValueError("Unsupported file type: " + ext)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(ext + " parse failed: " + str(exc)[:200])

    if hint_text and hint_text.strip():
        text = (text + "\n\n" + hint_text).strip()
    return text.strip()[:60000]


def _list_text_models(db):
    stmt = (
        select(ModelConfig)
        .where(
            ModelConfig.is_deleted == False,
            ModelConfig.status == "active",
            ModelConfig.open_to_student == True,
            ModelConfig.capability.in_(["text", "multimodal"]),
        )
        .order_by(ModelConfig.id.desc())
    )
    return list(db.execute(stmt).scalars().all())


def _pick_text_model(db):
    models = _list_text_models(db)
    if not models:
        raise ValueError("No text model available for students. Please contact admin to enable one in the model plaza.")
    return models[0]


def _coerce_str(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _coerce_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def _normalize_parsed(raw):
    basic = raw.get("basic") or {}
    if not isinstance(basic, dict):
        basic = {}
    education = [
        {
            "school": _coerce_str(e.get("school")),
            "major": _coerce_str(e.get("major")),
            "degree": _coerce_str(e.get("degree")),
            "start_date": _coerce_str(e.get("start_date") or e.get("startDate")),
            "end_date": _coerce_str(e.get("end_date") or e.get("endDate")),
            "gpa": _coerce_str(e.get("gpa")),
            "description": _coerce_str(e.get("description")),
        }
        for e in _coerce_list(raw.get("education"))[:10]
    ]
    experience = [
        {
            "company": _coerce_str(e.get("company")),
            "position": _coerce_str(e.get("position")),
            "date": _coerce_str(e.get("date")),
            "details": _coerce_str(e.get("details") or e.get("description")),
        }
        for e in _coerce_list(raw.get("experience"))[:10]
    ]
    projects = [
        {
            "name": _coerce_str(p.get("name")),
            "role": _coerce_str(p.get("role")),
            "date": _coerce_str(p.get("date")),
            "description": _coerce_str(p.get("description")),
        }
        for p in _coerce_list(raw.get("projects"))[:10]
    ]
    return {
        "basic": {
            "name": _coerce_str(basic.get("name")),
            "target_position": _coerce_str(basic.get("target_position") or basic.get("title")),
            "email": _coerce_str(basic.get("email")),
            "phone": _coerce_str(basic.get("phone")),
            "location": _coerce_str(basic.get("location")),
            "birth_date": _coerce_str(basic.get("birth_date") or basic.get("birthDate")),
        },
        "education": education,
        "experience": experience,
        "projects": projects,
        "skills": _coerce_str(raw.get("skills") or raw.get("skillContent"))[:2000],
        "self_evaluation": _coerce_str(raw.get("self_evaluation") or raw.get("selfEvaluationContent"))[:2000],
    }


def _extract_json_object(text):
    if not text:
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = cleaned[start:end + 1]
        try:
            return json.loads(snippet)
        except Exception:
            return None
    return None


def parse_resume_text_to_data(db, identity, text):
    if not text or len(text.strip()) < _SCANNER_THRESHOLD:
        raise ValueError("resume text too short to parse")
    models = _list_text_models(db)
    if not models:
        raise ValueError("No text model available for students. Please contact admin to enable one in the model plaza.")
    user_message = "Below is the full text of a candidate resume. Output strict JSON per the system schema:\n\n" + text
    last_error = ""
    for model in models:
        for retry in range(2):
            try:
                result = chat_completion(
                    model,
                    system_prompt=_IMPORT_SYSTEM_PROMPT,
                    variables={},
                    memory=[],
                    user_message=user_message,
                    temperature=0.2,
                    max_tokens=min(int(getattr(model, "max_output", 4096) or 4096), 4096),
                    top_p=0.9,
                )
                reply = (result or {}).get("reply") or ""
                parsed = _extract_json_object(reply)
                if parsed:
                    return _normalize_parsed(parsed)
                last_error = "model #%s (%s) returned invalid JSON" % (model.id, model.display_name)
                logger.warning("resume import retry %s: %s", retry, last_error)
            except Exception as exc:
                last_error = "model #%s (%s) failed: %s" % (model.id, model.display_name, str(exc)[:160])
                logger.exception("resume import LLM call failed (retry %s)", retry)
        logger.info("resume import falling back to next model after %s", last_error)
    raise ValueError("LLM call failed: " + last_error[:240])