from __future__ import annotations

import json
from html import escape
import logging

import httpx
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from reportlab.graphics.shapes import Drawing, Rect, String, Line
from reportlab.graphics import renderPM
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.models import StudentUser
from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.student.resume_models import StudentResume
from app.student.revision_models import StudentResumeRevision
from app.student.profile_details_models import (
    StudentEducation,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
from app.student.resume_schemas import (
    ResumeCreateRequest,
    ResumeDetailResponse,
    ResumeImportRequest,
    ResumeSummaryResponse,
    ResumeUpdateRequest,
)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/student/resumes", tags=["student-resume"])

MAX_RESUMES_PER_STUDENT = 6
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


JOB_STATUS_LABELS = {
    "unemployed": "求职中",
    "employed": "已就业，看新机会",
    "considering": "观望中",
    "not_looking": "暂不求职",
}

DEFAULT_BASIC_ICONS = {
    "birthDate": "calendar",
    "employementStatus": "briefcase",
    "email": "mail",
    "phone": "phone",
    "location": "location",
}

DEFAULT_BASIC_FIELD_ORDER = [
    {"id": "name", "key": "name", "label": "姓名", "type": "text", "visible": True},
    {"id": "title", "key": "title", "label": "职位", "type": "text", "visible": True},
    {"id": "birthDate", "key": "birthDate", "label": "生日", "type": "date", "visible": True},
    {
        "id": "employementStatus",
        "key": "employementStatus",
        "label": "状态",
        "type": "text",
        "visible": True,
    },
    {"id": "email", "key": "email", "label": "邮箱", "type": "text", "visible": True},
    {"id": "phone", "key": "phone", "label": "电话", "type": "text", "visible": True},
    {"id": "location", "key": "location", "label": "地址", "type": "text", "visible": True},
]

DEFAULT_PHOTO_CONFIG = {
    "width": 90,
    "height": 120,
    "aspectRatio": "1:1",
    "borderRadius": "none",
    "customBorderRadius": 0,
    "visible": True,
}


def _split_profile_duration(value: str | None) -> tuple[str, str]:
    text = (value or "").strip()
    if not text:
        return "", ""
    for separator in (" ~ ", " - ", " 至 ", "~", "～"):
        if separator in text:
            start, end = text.split(separator, 1)
            return start.strip(), end.strip()
    return text, ""


def _profile_date_range(start: str | None, end: str | None) -> str:
    start_text = (start or "").strip()
    end_text = (end or "").strip()
    if start_text and end_text:
        return f"{start_text} - {end_text}"
    return start_text or end_text


def _plain_text_to_list_html(value: str | None) -> str:
    lines = [line.strip() for line in (value or "").splitlines() if line.strip()]
    if not lines:
        return ""
    return "<ul>" + "".join(f"<li>{escape(line)}</li>" for line in lines) + "</ul>"


def _plain_text_to_paragraph_html(value: str | None) -> str:
    lines = [line.strip() for line in (value or "").splitlines() if line.strip()]
    if not lines:
        return ""
    return "".join(f"<p>{escape(line)}</p>" for line in lines)


def _load_profile_rows(db: Session, model, student_id: int, tenant_id: int) -> list[Any]:
    return list(
        db.scalars(
            select(model)
            .where(
                model.student_id == student_id,
                model.tenant_id == tenant_id,
            )
            .order_by(model.sort_order.asc(), model.id.asc())
        ).all()
    )


def _default_resume_data(
    db: Session,
    student: StudentUser,
    student_id: int,
    tenant_id: int,
    title: str,
    template_id: str,
    visibility: bool,
) -> dict[str, Any]:
    education_rows = _load_profile_rows(db, StudentEducation, student_id, tenant_id)
    work_rows = _load_profile_rows(db, StudentWorkExperience, student_id, tenant_id)
    project_rows = _load_profile_rows(db, StudentProject, student_id, tenant_id)
    skill_rows = _load_profile_rows(db, StudentSkill, student_id, tenant_id)
    education = []
    for index, row in enumerate(education_rows):
        start_date, end_date = _split_profile_duration(row.duration)
        education.append(
            {
                "id": f"edu-{row.id or index + 1}",
                "school": row.school or "",
                "major": row.major or "",
                "degree": row.degree or "",
                "startDate": start_date,
                "endDate": end_date,
                "gpa": row.gpa or "",
                "description": _plain_text_to_list_html(row.description),
                "visible": True,
            }
        )
    if not education and (student.college or student.major):
        education.append(
            {
                "id": "edu-legacy",
                "school": student.college or "",
                "major": student.major or "",
                "degree": "",
                "startDate": "",
                "endDate": "",
                "gpa": "",
                "description": "",
                "visible": True,
            }
        )
    experience = [
        {
            "id": f"exp-{row.id or index + 1}",
            "company": row.company or "",
            "position": row.position or "",
            "date": _profile_date_range(row.start_date, row.end_date),
            "details": _plain_text_to_list_html(row.description),
            "visible": True,
        }
        for index, row in enumerate(work_rows)
    ]
    projects = [
        {
            "id": f"proj-{row.id or index + 1}",
            "name": row.name or "",
            "role": row.role or "",
            "date": _profile_date_range(row.start_date, row.end_date),
            "description": _plain_text_to_list_html(row.description),
            "visible": True,
            "link": row.link or "",
            "linkLabel": row.link_label or "",
        }
        for index, row in enumerate(project_rows)
    ]
    skill_lines = []
    for row in skill_rows:
        name = (row.name or "").strip()
        description = (row.description or "").strip()
        if name:
            skill_lines.append(f"{name}：{description}" if description else name)
    return {
        "title": title,
        "templateId": template_id,
        "visibility": visibility,
        "basic": {
            "name": student.name or "",
            "title": student.expected_position or "",
            "employementStatus": JOB_STATUS_LABELS.get(student.job_search_status or "", ""),
            "email": student.email or "",
            "phone": student.phone or "",
            "location": student.expected_location or "",
            "birthDate": student.birth_date or "",
            "photo": student.resume_avatar_url or "",
            "icons": dict(DEFAULT_BASIC_ICONS),
            "photoConfig": dict(DEFAULT_PHOTO_CONFIG),
            "fieldOrder": [dict(item) for item in DEFAULT_BASIC_FIELD_ORDER],
            "customFields": [],
            "githubKey": "",
            "githubUseName": "",
            "githubContributionsVisible": False,
        },
        "education": education,
        "experience": experience,
        "projects": projects,
        "certificates": [],
        "customData": {},
        "skillContent": _plain_text_to_list_html("\n".join(skill_lines)),
        "selfEvaluationContent": _plain_text_to_paragraph_html(student.personal_advantages),
        "activeSection": "basic",
        "draggingProjectId": None,
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
        raise HTTPException(
            status_code=400,
            detail=f"简历数量已达上限（{MAX_RESUMES_PER_STUDENT} 份），请先删除一份简历后再继续生成",
        )




def _ensure_single_visibility(db: Session, student_id: int, tenant_id: int, *, exclude_id: int | None = None) -> None:
    """当一份简历设为 visibility=True 时，自动取消该学生其他所有简历的 visibility。
    这样同一时间只有一份简历对 AI 可读（单选语义）。
    """
    stmt = (
        update(StudentResume)
        .where(
            StudentResume.student_id == student_id,
            StudentResume.tenant_id == tenant_id,
            StudentResume.visibility.is_(True),
        )
        .values(visibility=False)
    )
    if exclude_id is not None:
        stmt = stmt.where(StudentResume.id != exclude_id)
    db.execute(stmt)
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
    document = (
        payload.data
        if payload and payload.data is not None
        else _default_resume_data(
            db,
            student,
            identity.user_id,
            identity.tenant_id,
            title,
            template_id,
            visibility,
        )
    )
    document = _clean_resume_document(document, title=title, template_id=template_id, visibility=visibility)

    if visibility:
        _ensure_single_visibility(db, identity.user_id, identity.tenant_id)

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

    if payload.visibility:
        _ensure_single_visibility(db, identity.user_id, identity.tenant_id)

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


@router.post("/import/file", status_code=201)
async def import_resume_file(
    file: UploadFile,
    title: Optional[str] = None,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """导入简历文件（PDF/DOCX/JSON）。PDF/DOCX 通过 LLM 结构化解析，JSON 直接校验。"""
    from fastapi.concurrency import run_in_threadpool
    from app.student.resume_import_service import extract_resume_file, parse_resume_text_to_data, _SCANNER_THRESHOLD

    identity, student = current
    _ensure_resume_limit(db, identity.user_id, identity.tenant_id)

    original_name = file.filename or "resume"
    ext = Path(original_name).suffix.lower()
    if ext not in {".pdf", ".docx", ".json"}:
        raise HTTPException(status_code=400, detail="仅支持 PDF、DOCX、JSON 格式")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文件不能超过 10MB")

    parsed_data: dict[str, Any] = {}

    if ext == ".json":
        # JSON 分支：直接解析校验
        try:
            raw = json.loads(content.decode("utf-8-sig"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise HTTPException(status_code=400, detail="JSON 文件格式错误，请检查后重试")
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="JSON 文件应为对象格式")
        parsed_data = _normalize_import_json(raw)
    else:
        # PDF/DOCX 分支：抽取文本 → LLM 结构化
        text = extract_resume_file(content, original_name, "")
        if len(text) < _SCANNER_THRESHOLD:
            raise HTTPException(
                status_code=400,
                detail="PDF 似乎是扫描件或图片型 PDF，无法提取文字。请上传文字版 PDF，或下载 JSON 模板填写后导入。",
            )
        try:
            parsed_data = await run_in_threadpool(parse_resume_text_to_data, db, identity, text)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)[:300])
        except httpx.HTTPStatusError as exc:
            # Upstream LLM provider rejected the request (4xx/5xx).
            # Surface the actual provider message so the user can see whether
            # the configured model / API key / base URL is wrong.
            logger.warning("resume import upstream LLM error: %s", exc)
            raise HTTPException(
                status_code=502,
                detail=f"LLM 解析失败: {str(exc)[:500]}",
            )
        except httpx.HTTPError as exc:
            # Network-level failures: connect refused, DNS failure, timeout,
            # protocol error, etc. These are not model-config issues but
            # connectivity / latency issues; surface as 502 with a clean hint
            # instead of leaking a raw 500 to the user.
            logger.warning("resume import LLM transport error: %s", exc)
            raise HTTPException(
                status_code=502,
                detail=(
                    "LLM 解析服务端无法联通或超时，请稍后重试"
                    f"（类型：{type(exc).__name__}）"
                ),
            )
        except Exception as exc:
            # Last-resort safety net: never leak a raw 500 plain-text response
            # from this endpoint. The client (apiRequest) expects the standard
            # {code, msg, data} envelope and a non-JSON body breaks the flow.
            logger.exception("resume import unexpected error")
            raise HTTPException(
                status_code=500,
                detail=f"简历导入失败：{type(exc).__name__}",
            )

    # 标题：传入 > 解析出的姓名+岗位 > 文件名
    resolved_title = (
        _normalize_title(title)
        if title
        else _infer_title(parsed_data, original_name)
    )
    template_id = DEFAULT_TEMPLATE_ID

    # 转为完整编辑器 data_json
    document = _build_import_document(parsed_data, resolved_title, template_id, student)

    row = StudentResume(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=resolved_title,
        template_id=template_id,
        visibility=False,
        data_json=json.dumps(document, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # 返回简历摘要
    sections = _compute_sections_summary(parsed_data)
    return ok({"resume_id": row.id, "title": resolved_title, "sections_summary": sections}, msg="imported")


def _normalize_import_json(raw: dict[str, Any]) -> dict[str, Any]:
    """规范化导入的 JSON 数据，提取 LLM 解析同构的子集。"""
    basic = raw.get("basic") or {}
    return {
        "basic": {
            "name": str(basic.get("name") or raw.get("name") or "").strip(),
            "target_position": str(basic.get("target_position") or basic.get("title") or "").strip(),
            "email": str(basic.get("email") or "").strip(),
            "phone": str(basic.get("phone") or "").strip(),
            "location": str(basic.get("location") or "").strip(),
            "birth_date": str(basic.get("birth_date") or basic.get("birthDate") or "").strip(),
        },
        "education": [
            {
                "school": str(e.get("school") or "").strip(),
                "major": str(e.get("major") or "").strip(),
                "degree": str(e.get("degree") or "").strip(),
                "start_date": str(e.get("start_date") or e.get("startDate") or "").strip(),
                "end_date": str(e.get("end_date") or e.get("endDate") or "").strip(),
                "gpa": str(e.get("gpa") or "").strip(),
                "description": str(e.get("description") or "").strip(),
            }
            for e in (raw.get("education") or [])
            if isinstance(e, dict)
        ][:10],
        "experience": [
            {
                "company": str(e.get("company") or "").strip(),
                "position": str(e.get("position") or "").strip(),
                "date": str(e.get("date") or "").strip(),
                "details": str(e.get("details") or e.get("description") or "").strip(),
            }
            for e in (raw.get("experience") or [])
            if isinstance(e, dict)
        ][:10],
        "projects": [
            {
                "name": str(p.get("name") or "").strip(),
                "role": str(p.get("role") or "").strip(),
                "date": str(p.get("date") or "").strip(),
                "description": str(p.get("description") or "").strip(),
            }
            for p in (raw.get("projects") or [])
            if isinstance(p, dict)
        ][:10],
        "skills": str(raw.get("skills") or raw.get("skillContent") or "").strip()[:2000],
        "self_evaluation": str(raw.get("self_evaluation") or raw.get("selfEvaluationContent") or "").strip()[:2000],
    }


def _infer_title(data: dict[str, Any], filename: str) -> str:
    """从解析数据推断简历标题。"""
    basic = data.get("basic") or {}
    name = (basic.get("name") or "").strip()
    position = (basic.get("target_position") or "").strip()
    if name and position:
        return _normalize_title(f"{name}-{position}简历")
    if name:
        return _normalize_title(f"{name}的简历")
    return _normalize_title(Path(filename).stem)


def _build_import_document(
    parsed: dict[str, Any],
    title: str,
    template_id: str,
    student: Any,
) -> dict[str, Any]:
    """将 LLM 解析的结构化数据转为完整编辑器 data_json。"""
    import uuid

    basic = parsed.get("basic") or {}
    education = [
        {
            "id": f"edu-{uuid.uuid4().hex[:8]}",
            "school": e.get("school", ""),
            "major": e.get("major", ""),
            "degree": e.get("degree", ""),
            "startDate": e.get("start_date", ""),
            "endDate": e.get("end_date", ""),
            "gpa": e.get("gpa", ""),
            "description": e.get("description", ""),
            "visible": True,
        }
        for e in (parsed.get("education") or [])
    ]
    experience = [
        {
            "id": f"exp-{uuid.uuid4().hex[:8]}",
            "company": e.get("company", ""),
            "position": e.get("position", ""),
            "date": e.get("date", ""),
            "details": e.get("details", ""),
            "visible": True,
        }
        for e in (parsed.get("experience") or [])
    ]
    projects = [
        {
            "id": f"proj-{uuid.uuid4().hex[:8]}",
            "name": p.get("name", ""),
            "role": p.get("role", ""),
            "date": p.get("date", ""),
            "description": p.get("description", ""),
            "visible": True,
            "link": "",
            "linkLabel": "",
        }
        for p in (parsed.get("projects") or [])
    ]
    return {
        "title": title,
        "templateId": template_id,
        "visibility": False,
        "basic": {
            "name": basic.get("name") or student.name or "",
            "title": basic.get("target_position") or "",
            "employementStatus": "",
            "email": basic.get("email") or student.email or "",
            "phone": basic.get("phone") or student.phone or "",
            "location": basic.get("location") or "",
            "birthDate": basic.get("birth_date") or "",
            "photo": student.resume_avatar_url or "",
            "icons": dict(DEFAULT_BASIC_ICONS),
            "photoConfig": dict(DEFAULT_PHOTO_CONFIG),
            "fieldOrder": [dict(item) for item in DEFAULT_BASIC_FIELD_ORDER],
            "customFields": [],
            "githubKey": "",
            "githubUseName": "",
            "githubContributionsVisible": False,
        },
        "education": education,
        "experience": experience,
        "projects": projects,
        "certificates": [],
        "customData": {},
        "skillContent": parsed.get("skills") or "",
        "selfEvaluationContent": parsed.get("self_evaluation") or "",
        "activeSection": "basic",
        "draggingProjectId": None,
        "globalSettings": {
            "themeColor": "#0f172a",
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


def _compute_sections_summary(data: dict[str, Any]) -> dict[str, Any]:
    """计算各板块摘要（条数/是否非空）。"""
    return {
        "education": len(data.get("education") or []),
        "experience": len(data.get("experience") or []),
        "projects": len(data.get("projects") or []),
        "skills": bool((data.get("skills") or "").strip()),
        "self_evaluation": bool((data.get("self_evaluation") or "").strip()),
    }
async def upload_resume_file(
    file: UploadFile,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """上传 PDF/DOCX/TXT/MD 简历文件，提取文本后创建一条新的简历记录。"""
    import tempfile

    identity, _ = current
    _ensure_resume_limit(db, identity.user_id, identity.tenant_id)

    original_name = file.filename or "resume"
    ext = Path(original_name).suffix.lower()
    if ext not in {".pdf", ".docx", ".txt", ".md"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 PDF、DOCX、TXT、Markdown 格式")

    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="简历文件不能超过 8MB")

    text = ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        if ext == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(str(tmp_path))
            for page in reader.pages[:20]:
                page_text = (page.extract_text() or "").strip()
                if page_text:
                    text += page_text + "\n"
        elif ext == ".docx":
            from docx import Document

            doc = Document(str(tmp_path))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        else:
            text = content.decode("utf-8", errors="replace")
    finally:
        tmp_path.unlink(missing_ok=True)

    text = text.strip()[:30000]
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未能从文件中提取到文本内容")

    # 从学生档案自动填充基本信息
    student = db.get(StudentUser, identity.user_id)
    title = Path(original_name).stem[:60] or "上传的简历"

    document = _default_resume_data(student, title, "blank", False)
    document["selfEvaluation"] = text

    if identity.tenant_id:
        pass  # tenant 隔离由 _ensure_resume_limit 保证

    row = StudentResume(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=title,
        template_id="blank",
        visibility=False,
        data_json=json.dumps(document, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok({"id": row.id, "title": title, "chars": len(text)}, msg="uploaded")


@router.get("/{resume_id}")
def get_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    row = _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    return ok(_serialize_detail(row).model_dump(mode="json"))


class RevertRequest(BaseModel):
    revision_id: int


@router.post("/{resume_id}/revert")
def revert_resume(
    resume_id: int,
    payload: RevertRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    row = _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    revision = db.scalar(
        select(StudentResumeRevision).where(
            StudentResumeRevision.id == payload.revision_id,
            StudentResumeRevision.resume_id == resume_id,
            StudentResumeRevision.tenant_id == identity.tenant_id,
            StudentResumeRevision.student_id == identity.user_id,
        )
    )
    if not revision:
        raise HTTPException(status_code=404, detail="快照不存在或无权限")
    row.data_json = revision.data_json
    row.title = revision.title
    row.template_id = revision.template_id
    db.commit()
    return ok(_serialize_detail(row).model_dump(mode="json"), msg="已撤销")


@router.get("/{resume_id}/revisions")
def list_revisions(
    resume_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    # 校验简历归属
    _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    revisions = list(
        db.scalars(
            select(StudentResumeRevision)
            .where(
                StudentResumeRevision.resume_id == resume_id,
                StudentResumeRevision.tenant_id == identity.tenant_id,
                StudentResumeRevision.student_id == identity.user_id,
            )
            .order_by(StudentResumeRevision.id.desc())
            .limit(20)
        ).all()
    )
    return ok([
        {
            "id": r.id,
            "title": r.title,
            "source": r.source,
            "session_id": r.session_id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in revisions
    ])


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
    if payload.visibility:
        _ensure_single_visibility(db, identity.user_id, identity.tenant_id, exclude_id=resume_id)
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




@router.post("/{resume_id}/duplicate", status_code=201)
def duplicate_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    _ensure_resume_limit(db, identity.user_id, identity.tenant_id)
    source = _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    try:
        source_doc = json.loads(source.data_json or "{}")
    except Exception:
        source_doc = {}
    new_title = ((source.title or "简历").strip()[:120] + " - 副本")
    new_doc = _clean_resume_document(
        dict(source_doc),
        title=new_title,
        template_id=source.template_id,
        visibility=False,
    )
    new_doc["title"] = new_title
    new_doc["visibility"] = False
    row = StudentResume(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=new_title,
        template_id=source.template_id,
        visibility=False,
        data_json=json.dumps(new_doc, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(_serialize_detail(row).model_dump(mode="json"), msg="duplicated")
# NOTE: synchronous export-pdf removed in favor of the async flow in app.jobs_router.
# Frontend now calls:
#   POST /api/v1/student/resumes/{id}/export-pdf  ->  { job_id }
#   GET  /api/v1/jobs/{job_id}                   ->  { status, progress, download_url }
#   GET  /api/v1/jobs/{job_id}/download          ->  application/pdf


_THUMB_W = 360
_THUMB_H = 510

def _safe_short(text, limit=36):
    value = _escape_text(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: limit - 1] + "…"

def _render_resume_thumbnail_png(row):
    data = _merge_resume_payload(row)
    basic = data.get("basic") or {}
    theme = TEMPLATE_COLORS.get(row.template_id, TEMPLATE_COLORS[DEFAULT_TEMPLATE_ID])
    text_dark = colors.HexColor("#0f172a")
    text_muted = colors.HexColor("#64748b")
    rule = colors.HexColor("#e2e8f0")
    surface = colors.HexColor("#ffffff")
    d = Drawing(_THUMB_W, _THUMB_H)
    d.add(Rect(0, 0, _THUMB_W, _THUMB_H, fillColor=surface, strokeColor=None))
    d.add(Rect(0, _THUMB_H - 70, _THUMB_W, 70, fillColor=theme, strokeColor=None))
    name = _safe_short(basic.get("name") or row.title, 18)
    d.add(String(20, _THUMB_H - 35, name, fontName="Helvetica-Bold", fontSize=18, fillColor=surface))
    title_text = _safe_short(basic.get("title"), 30)
    if title_text:
        d.add(String(20, _THUMB_H - 55, title_text, fontName="Helvetica", fontSize=9, fillColor=surface))
    contact_parts = [v for v in [basic.get("phone"), basic.get("email"), basic.get("location")] if v]
    contact_line = "  ".join(_safe_short(p, 22) for p in contact_parts[:3])
    y = _THUMB_H - 88
    if contact_line:
        d.add(String(20, y, contact_line, fontName="Helvetica", fontSize=7, fillColor=text_muted))
    body_top = _THUMB_H - 110
    line_height = 11
    max_y = 40
    def draw_section(title, lines):
        nonlocal y
        if y < max_y + 30:
            return
        d.add(Rect(14, y - 2, 4, 11, fillColor=theme, strokeColor=None))
        d.add(String(24, y, _safe_short(title, 16), fontName="Helvetica-Bold", fontSize=9, fillColor=theme))
        y -= 14
        if not lines:
            d.add(String(24, y, _safe_short("（暂无内容）", 32), fontName="Helvetica-Oblique", fontSize=7, fillColor=text_muted))
            y -= line_height
            return
        for line in lines[:5]:
            if y < max_y:
                break
            d.add(String(24, y, _safe_short(line, 56), fontName="Helvetica", fontSize=7, fillColor=text_dark))
            y -= line_height
        y -= 4
    skill_lines = []
    for item in (data.get("skills") or []):
        if not item.get("name"):
            continue
        level = item.get("level") or 3
        skill_lines.append(f"{item.get('name')}  Lv.{level}")
    draw_section("专业技能", skill_lines)
    exp_lines = []
    for item in (data.get("experience") or []):
        if item.get("visible") is False:
            continue
        header = " / ".join(part for part in [item.get("company"), item.get("position"), item.get("date")] if part)
        if header:
            exp_lines.append(header)
        for line in _split_lines(item.get("details"))[:2]:
            exp_lines.append("• " + line)
    draw_section("工作经历", exp_lines)
    proj_lines = []
    for item in (data.get("projects") or []):
        if item.get("visible") is False:
            continue
        header = " / ".join(part for part in [item.get("name"), item.get("role"), item.get("date")] if part)
        if header:
            proj_lines.append(header)
        for line in _split_lines(item.get("description"))[:2]:
            proj_lines.append("• " + line)
    draw_section("项目经历", proj_lines)
    edu_lines = []
    for item in (data.get("education") or []):
        if item.get("visible") is False:
            continue
        header = " / ".join(part for part in [item.get("school"), item.get("major"), item.get("degree"), item.get("endDate") or item.get("startDate")] if part)
        if header:
            edu_lines.append(header)
    draw_section("教育经历", edu_lines)
    eval_lines = _split_lines(data.get("selfEvaluation"))[:3]
    draw_section("自我评价", eval_lines)
    d.add(Line(14, 22, _THUMB_W - 14, 22, strokeColor=rule, strokeWidth=0.6))
    d.add(String(20, 10, _safe_short(row.title, 36), fontName="Helvetica-Oblique", fontSize=6.5, fillColor=text_muted))
    buf = BytesIO()
    renderPM.drawToFile(d, buf, fmt="PNG", bg=0xffffff, dpi=120)
    return buf.getvalue()

def _resolve_thumbnail_identity(request, db):
    from app.auth.models import StudentUser
    from app.core.security import decode_token
    auth_header = (request.headers.get("authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    else:
        token = request.query_params.get("access") or ""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少认证信息")
    payload = decode_token(token, expected_type="access")
    if payload.get("role") != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该资源")
    user = db.get(StudentUser, int(payload["sub"]))
    if not user or user.is_deleted:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="当前用户不存在")
    return int(payload["sub"]), int(payload["tenant_id"])

@router.get("/{resume_id}/thumbnail")
def get_resume_thumbnail(
    resume_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id, tenant_id = _resolve_thumbnail_identity(request, db)
    row = _get_student_resume(db, user_id, tenant_id, resume_id)
    png_bytes = _render_resume_thumbnail_png(row)
    headers = {"Cache-Control": "private, max-age=60"}
    return StreamingResponse(BytesIO(png_bytes), media_type="image/png", headers=headers)
