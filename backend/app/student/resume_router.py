from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.models import StudentUser
from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.student.resume_models import StudentResume
from app.student.resume_schemas import (
    ResumeCreateRequest,
    ResumeDetailResponse,
    ResumeImportRequest,
    ResumeSummaryResponse,
    ResumeUpdateRequest,
)

router = APIRouter(prefix="/student/resumes", tags=["student-resume"])

MAX_RESUMES_PER_STUDENT = 5
DEFAULT_TEMPLATE_ID = "classic"
DEFAULT_SECTION_ORDER = [
    ("basic", "基本信息", "👤"),
    ("skills", "专业技能", "⚡"),
    ("experience", "工作经历", "💼"),
    ("projects", "项目经历", "🚀"),
    ("education", "教育经历", "🎓"),
    ("selfEvaluation", "自我评价", "📝"),
]

TEMPLATE_COLORS = {
    "classic": colors.HexColor("#0f172a"),
    "modern": colors.HexColor("#165dff"),
    "elegant": colors.HexColor("#7c3aed"),
}


def _iso(value):
    return value.isoformat() if value else None


def _normalize_title(title: str | None) -> str:
    text = (title or "").strip()
    return text[:128] or "新建简历"


def _normalize_template_id(template_id: str | None) -> str:
    text = (template_id or "").strip()
    return text[:64] or DEFAULT_TEMPLATE_ID


def _default_resume_data(student: StudentUser, title: str, template_id: str, visibility: bool) -> dict[str, Any]:
    return {
        "title": title,
        "templateId": template_id,
        "visibility": visibility,
        "basic": {
            "name": student.name or "",
            "title": "",
            "email": student.email or "",
            "phone": student.phone or "",
            "location": student.college or "",
            "birthDate": "",
            "gender": student.gender or "",
            "photo": student.avatar_url or "",
        },
        "education": [
            {
                "id": "edu-1",
                "school": student.college or "",
                "major": student.major or "",
                "degree": "",
                "startDate": "",
                "endDate": "",
                "gpa": "",
                "description": "",
                "visible": True,
            }
        ],
        "experience": [],
        "projects": [],
        "skills": [],
        "selfEvaluation": "",
        "globalSettings": {
            "themeColor": "#165dff" if template_id == "modern" else "#0f172a",
            "baseFontSize": 14,
            "pagePadding": 32,
            "lineHeight": 1.65,
            "sectionSpacing": 24,
        },
        "menuSections": [
            {"id": section_id, "title": section_title, "icon": icon, "enabled": True, "order": index}
            for index, (section_id, section_title, icon) in enumerate(DEFAULT_SECTION_ORDER)
        ],
    }


def _merge_resume_payload(row: StudentResume) -> dict[str, Any]:
    data = json.loads(row.data_json or "{}")
    if not isinstance(data, dict):
        data = {}
    data.update(
        {
            "id": row.id,
            "title": row.title,
            "templateId": row.template_id,
            "visibility": row.visibility,
            "createdAt": _iso(row.created_at),
            "updatedAt": _iso(row.updated_at),
        }
    )
    return data


def _serialize_summary(row: StudentResume) -> ResumeSummaryResponse:
    return ResumeSummaryResponse(
        id=row.id,
        title=row.title,
        templateId=row.template_id,
        visibility=row.visibility,
        updatedAt=row.updated_at,
        createdAt=row.created_at,
    )


def _serialize_detail(row: StudentResume) -> ResumeDetailResponse:
    return ResumeDetailResponse(
        id=row.id,
        title=row.title,
        templateId=row.template_id,
        visibility=row.visibility,
        data=_merge_resume_payload(row),
        updatedAt=row.updated_at,
        createdAt=row.created_at,
    )


def _get_student_resume(db: Session, student_id: int, tenant_id: int, resume_id: int) -> StudentResume:
    row = db.scalar(
        select(StudentResume).where(
            StudentResume.id == resume_id,
            StudentResume.student_id == student_id,
            StudentResume.tenant_id == tenant_id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="简历不存在")
    return row


def _ensure_resume_limit(db: Session, student_id: int, tenant_id: int) -> None:
    total = db.scalar(
        select(func.count(StudentResume.id)).where(
            StudentResume.student_id == student_id,
            StudentResume.tenant_id == tenant_id,
        )
    )
    if (total or 0) >= MAX_RESUMES_PER_STUDENT:
        raise HTTPException(status_code=400, detail=f"每位学生最多保留 {MAX_RESUMES_PER_STUDENT} 份简历")


def _clean_resume_document(data: dict[str, Any], *, title: str, template_id: str, visibility: bool) -> dict[str, Any]:
    document = dict(data)
    document["title"] = title
    document["templateId"] = template_id
    document["visibility"] = visibility
    document.pop("id", None)
    document.pop("createdAt", None)
    document.pop("updatedAt", None)
    return document


def _split_lines(text: Any) -> list[str]:
    if not text:
        return []
    return [line.strip() for line in str(text).splitlines() if line.strip()]


def _escape_text(value: Any) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def _render_resume_pdf(row: StudentResume) -> bytes:
    data = _merge_resume_payload(row)
    basic = data.get("basic") or {}
    theme_color = TEMPLATE_COLORS.get(row.template_id, TEMPLATE_COLORS[DEFAULT_TEMPLATE_ID])

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ResumeTitle",
        parent=styles["Title"],
        alignment=TA_CENTER,
        fontSize=22,
        leading=28,
        textColor=theme_color,
        spaceAfter=8,
    )
    subtitle_style = ParagraphStyle(
        "ResumeSubtitle",
        parent=styles["BodyText"],
        alignment=TA_CENTER,
        fontSize=10.5,
        leading=15,
        textColor=colors.HexColor("#475569"),
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "ResumeSection",
        parent=styles["Heading2"],
        fontSize=12.5,
        leading=18,
        textColor=theme_color,
        borderPadding=0,
        spaceBefore=6,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "ResumeBody",
        parent=styles["BodyText"],
        fontSize=10.5,
        leading=16,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=5,
    )
    item_title_style = ParagraphStyle(
        "ResumeItemTitle",
        parent=styles["BodyText"],
        fontSize=10.8,
        leading=16,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=2,
    )

    story = [
        Paragraph(_escape_text(basic.get("name") or row.title), title_style),
        Paragraph(
            _escape_text(
                " · ".join(
                    value
                    for value in [
                        basic.get("title"),
                        basic.get("phone"),
                        basic.get("email"),
                        basic.get("location"),
                    ]
                    if value
                )
            ),
            subtitle_style,
        ),
    ]

    def add_section(title: str, paragraphs: list[Paragraph]) -> None:
        if not paragraphs:
            return
        story.append(Paragraph(_escape_text(title), section_style))
        story.extend(paragraphs)
        story.append(Spacer(1, 4))

    skills = data.get("skills") or []
    skill_lines = [
        Paragraph(_escape_text(f"{item.get('name')}  Lv.{item.get('level') or 3}"), body_style)
        for item in skills
        if item.get("name")
    ]
    add_section("专业技能", skill_lines)

    experience_items: list[Paragraph] = []
    for item in data.get("experience") or []:
        if item.get("visible") is False:
            continue
        header = " / ".join(part for part in [item.get("company"), item.get("position"), item.get("date")] if part)
        if header:
            experience_items.append(Paragraph(f"<b>{_escape_text(header)}</b>", item_title_style))
        for line in _split_lines(item.get("details")):
            experience_items.append(Paragraph(f"• {_escape_text(line)}", body_style))
    add_section("工作经历", experience_items)

    project_items: list[Paragraph] = []
    for item in data.get("projects") or []:
        if item.get("visible") is False:
            continue
        header = " / ".join(part for part in [item.get("name"), item.get("role"), item.get("date")] if part)
        if header:
            project_items.append(Paragraph(f"<b>{_escape_text(header)}</b>", item_title_style))
        for line in _split_lines(item.get("description")):
            project_items.append(Paragraph(f"• {_escape_text(line)}", body_style))
    add_section("项目经历", project_items)

    education_items: list[Paragraph] = []
    for item in data.get("education") or []:
        if item.get("visible") is False:
            continue
        header = " / ".join(
            part for part in [item.get("school"), item.get("major"), item.get("degree"), item.get("startDate"), item.get("endDate")] if part
        )
        if header:
            education_items.append(Paragraph(f"<b>{_escape_text(header)}</b>", item_title_style))
        for line in _split_lines(item.get("description")):
            education_items.append(Paragraph(f"• {_escape_text(line)}", body_style))
    add_section("教育经历", education_items)

    evaluation = [Paragraph(_escape_text(line), body_style) for line in _split_lines(data.get("selfEvaluation"))]
    add_section("自我评价", evaluation)

    if len(story) <= 2:
        story.append(Paragraph("这份简历还没有填写内容，请先在编辑器中补充后再导出。", body_style))

    doc.build(story)
    return buffer.getvalue()


@router.get("")
def list_resumes(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    rows = db.scalars(
        select(StudentResume)
        .where(
            StudentResume.student_id == identity.user_id,
            StudentResume.tenant_id == identity.tenant_id,
        )
        .order_by(StudentResume.updated_at.desc(), StudentResume.id.desc())
    ).all()
    return ok([item.model_dump(mode="json") for item in [_serialize_summary(row) for row in rows]])


@router.post("", status_code=201)
def create_resume(
    payload: ResumeCreateRequest | None = None,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, student = current
    _ensure_resume_limit(db, identity.user_id, identity.tenant_id)

    title = _normalize_title(payload.title if payload else None)
    template_id = _normalize_template_id(payload.templateId if payload else None)
    visibility = payload.visibility if payload else False
    document = payload.data if payload and payload.data is not None else _default_resume_data(student, title, template_id, visibility)
    document = _clean_resume_document(document, title=title, template_id=template_id, visibility=visibility)

    row = StudentResume(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=title,
        template_id=template_id,
        visibility=visibility,
        data_json=json.dumps(document, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(_serialize_detail(row).model_dump(mode="json"), msg="created")


@router.post("/import", status_code=201)
def import_resume(
    payload: ResumeImportRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    _ensure_resume_limit(db, identity.user_id, identity.tenant_id)

    title = _normalize_title(payload.title or payload.data.get("title"))
    template_id = _normalize_template_id(payload.templateId or payload.data.get("templateId"))
    document = _clean_resume_document(payload.data, title=title, template_id=template_id, visibility=payload.visibility)

    row = StudentResume(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=title,
        template_id=template_id,
        visibility=payload.visibility,
        data_json=json.dumps(document, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(_serialize_detail(row).model_dump(mode="json"), msg="created")


@router.get("/{resume_id}")
def get_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    row = _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    return ok(_serialize_detail(row).model_dump(mode="json"))


@router.put("/{resume_id}")
def update_resume(
    resume_id: int,
    payload: ResumeUpdateRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    row = _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    title = _normalize_title(payload.title)
    template_id = _normalize_template_id(payload.templateId)
    row.title = title
    row.template_id = template_id
    row.visibility = payload.visibility
    row.data_json = json.dumps(
        _clean_resume_document(payload.data, title=title, template_id=template_id, visibility=payload.visibility),
        ensure_ascii=False,
    )
    db.commit()
    db.refresh(row)
    return ok(_serialize_detail(row).model_dump(mode="json"))


@router.delete("/{resume_id}")
def delete_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    row = _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    db.delete(row)
    db.commit()
    return ok({"id": resume_id}, msg="deleted")


@router.get("/{resume_id}/export-pdf")
def export_resume_pdf(
    resume_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    row = _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    pdf_bytes = _render_resume_pdf(row)
    filename = Path(_normalize_title(row.title)).stem
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}.pdf"',
    }
    return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)
