# AI assist endpoint for resume fields (per-field optimization).
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.models import StudentUser
from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.student.ai_assist_service import ai_assist_field, list_available_models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/student/resumes", tags=["student-resume-ai"])

VALID_SECTIONS = {"experience", "project", "education", "skill", "selfEvaluation", "summary"}
VALID_INSTRUCTIONS = {"polish", "quantify", "concise", "expand", "translate_en", "custom"}


class AiAssistRequest(BaseModel):
    section: str = Field(..., min_length=1, max_length=32)
    instruction: str = Field(default="polish", min_length=1, max_length=32)
    currentText: str = Field(default="", max_length=20_000)
    customInstruction: Optional[str] = Field(default=None, max_length=2000)
    jdText: Optional[str] = Field(default=None, max_length=8000)
    modelId: Optional[int] = Field(default=None, ge=1)


class AiAssistResponse(BaseModel):
    suggested: str
    model: str
    modelId: int
    instruction: str


class AvailableModel(BaseModel):
    id: int
    displayName: str
    provider: str
    capability: str
    modelIdentifier: str


@router.post("/{resume_id}/ai-assist")
def ai_assist(
    resume_id: int,
    payload: AiAssistRequest,
    db: Session = Depends(get_db),
    current: StudentUser = Depends(require_role("student")),
):
    if payload.section not in VALID_SECTIONS:
        raise HTTPException(status_code=400, detail="unsupported section: " + payload.section)
    instruction_key = payload.instruction if payload.instruction in VALID_INSTRUCTIONS else "polish"
    custom_instruction = None
    if instruction_key == "custom":
        custom_instruction = (payload.customInstruction or "").strip() or None
        # If no custom text was provided we degrade to "polish" so the user still gets output.
        if not custom_instruction:
            instruction_key = "polish"
    try:
        result = ai_assist_field(
            db,
            section=payload.section,
            instruction_key=instruction_key,
            current_text=payload.currentText,
            jd_text=payload.jdText,
            model_id=payload.modelId,
            custom_instruction=custom_instruction,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("ai assist failed")
        raise HTTPException(status_code=500, detail="ai assist failed: " + str(exc)[:200])
    return ok(AiAssistResponse(**result).model_dump())


@router.get("/ai-assist/models")
def list_models(
    db: Session = Depends(get_db),
    current: StudentUser = Depends(require_role("student")),
):
    """Return the text / multimodal models the admin has opened to students.

    Students pick one of these in the AI assist dialog; the chosen modelId
    is sent back to POST /ai-assist so the call uses exactly that model
    rather than the implicit-fallback chain.
    """
    return ok(list_available_models(db))
