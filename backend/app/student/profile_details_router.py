from __future__ import annotations

from typing import Any, Iterable

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.student.profile_details_models import (
    StudentCertification,
    StudentEducation,
    StudentHonor,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
from app.student.profile_details_schemas import (
    CertificationItem,
    EducationItem,
    HonorItem,
    ProfileDetailsResponse,
    ProfileDetailsUpdateRequest,
    ProjectItem,
    SkillItem,
    WorkExperienceItem,
)

router = APIRouter(prefix="/student/profile/details", tags=["student-profile-details"])


def _serialize_work(item: StudentWorkExperience) -> dict[str, Any]:
    return {
        "id": item.id,
        "company": item.company,
        "position": item.position,
        "start_date": item.start_date,
        "end_date": item.end_date,
        "description": item.description,
    }


def _serialize_project(item: StudentProject) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": item.name,
        "role": item.role,
        "start_date": item.start_date,
        "end_date": item.end_date,
        "link": item.link,
        "link_label": item.link_label,
        "description": item.description,
    }


def _serialize_honor(item: StudentHonor) -> dict[str, Any]:
    return {
        "id": item.id,
        "title": item.title,
        "level": item.level,
        "award_date": item.award_date,
        "description": item.description,
    }


def _serialize_cert(item: StudentCertification) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": item.name,
        "issuer": item.issuer,
        "issue_date": item.issue_date,
        "expire_date": item.expire_date,
        "description": item.description,
    }


def _serialize_education(item: StudentEducation) -> dict[str, Any]:
    return {
        "id": item.id,
        "school": item.school,
        "major": item.major,
        "degree": item.degree,
        "duration": item.duration,
        "gpa": item.gpa,
        "description": item.description,
    }


def _replace_education(db: Session, student_id: int, tenant_id: int, items: Iterable[EducationItem]) -> None:
    db.query(StudentEducation).filter(StudentEducation.student_id == student_id).delete()
    for index, item in enumerate(items):
        db.add(
            StudentEducation(
                tenant_id=tenant_id,
                student_id=student_id,
                school=(item.school or None),
                major=(item.major or None),
                degree=(item.degree or None),
                duration=(item.duration or None),
                gpa=(item.gpa or None),
                description=(item.description or None),
                sort_order=index,
            )
        )


def _serialize_skill(item: StudentSkill) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": item.name,
        "level": item.level,
        "description": item.description,
    }


def _load_list(db: Session, model, student_id: int) -> list:
    return list(
        db.scalars(
            select(model)
            .where(model.student_id == student_id)
            .order_by(model.sort_order.asc(), model.id.asc())
        )
    )


def _replace_work(db: Session, student_id: int, tenant_id: int, items: Iterable[WorkExperienceItem]) -> None:
    db.query(StudentWorkExperience).filter(StudentWorkExperience.student_id == student_id).delete()
    for index, item in enumerate(items):
        db.add(
            StudentWorkExperience(
                tenant_id=tenant_id,
                student_id=student_id,
                company=(item.company or None),
                position=(item.position or None),
                start_date=(item.start_date or None),
                end_date=(item.end_date or None),
                description=(item.description or None),
                sort_order=index,
            )
        )


def _replace_project(db: Session, student_id: int, tenant_id: int, items: Iterable[ProjectItem]) -> None:
    db.query(StudentProject).filter(StudentProject.student_id == student_id).delete()
    for index, item in enumerate(items):
        db.add(
            StudentProject(
                tenant_id=tenant_id,
                student_id=student_id,
                name=(item.name or None),
                role=(item.role or None),
                start_date=(item.start_date or None),
                end_date=(item.end_date or None),
                link=(item.link or None),
                link_label=(item.link_label or None),
                description=(item.description or None),
                sort_order=index,
            )
        )


def _replace_honor(db: Session, student_id: int, tenant_id: int, items: Iterable[HonorItem]) -> None:
    db.query(StudentHonor).filter(StudentHonor.student_id == student_id).delete()
    for index, item in enumerate(items):
        db.add(
            StudentHonor(
                tenant_id=tenant_id,
                student_id=student_id,
                title=(item.title or None),
                level=(item.level or None),
                award_date=(item.award_date or None),
                description=(item.description or None),
                sort_order=index,
            )
        )


def _replace_cert(db: Session, student_id: int, tenant_id: int, items: Iterable[CertificationItem]) -> None:
    db.query(StudentCertification).filter(StudentCertification.student_id == student_id).delete()
    for index, item in enumerate(items):
        db.add(
            StudentCertification(
                tenant_id=tenant_id,
                student_id=student_id,
                name=(item.name or None),
                issuer=(item.issuer or None),
                issue_date=(item.issue_date or None),
                expire_date=(item.expire_date or None),
                description=(item.description or None),
                sort_order=index,
            )
        )


def _replace_skill(db: Session, student_id: int, tenant_id: int, items: Iterable[SkillItem]) -> None:
    db.query(StudentSkill).filter(StudentSkill.student_id == student_id).delete()
    for index, item in enumerate(items):
        db.add(
            StudentSkill(
                tenant_id=tenant_id,
                student_id=student_id,
                name=(item.name or None),
                level=item.level,
                description=(item.description or None),
                sort_order=index,
            )
        )


@router.get("")
def get_profile_details(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    student_id = identity.user_id

    work = [_serialize_work(item) for item in _load_list(db, StudentWorkExperience, student_id)]
    projects = [_serialize_project(item) for item in _load_list(db, StudentProject, student_id)]
    educations = [_serialize_education(item) for item in _load_list(db, StudentEducation, student_id)]
    honors = [_serialize_honor(item) for item in _load_list(db, StudentHonor, student_id)]
    certs = [_serialize_cert(item) for item in _load_list(db, StudentCertification, student_id)]
    skills = [_serialize_skill(item) for item in _load_list(db, StudentSkill, student_id)]

    return ok(
        ProfileDetailsResponse(
            work_experiences=[WorkExperienceItem(**item) for item in work],
            projects=[ProjectItem(**item) for item in projects],
            educations=[EducationItem(**item) for item in educations],
            honors=[HonorItem(**item) for item in honors],
            certifications=[CertificationItem(**item) for item in certs],
            skills=[SkillItem(**item) for item in skills],
        ).model_dump()
    )


@router.put("")
def update_profile_details(
    payload: ProfileDetailsUpdateRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    student_id = identity.user_id
    tenant_id = identity.tenant_id

    _replace_work(db, student_id, tenant_id, payload.work_experiences)
    _replace_project(db, student_id, tenant_id, payload.projects)
    _replace_education(db, student_id, tenant_id, payload.educations)
    _replace_honor(db, student_id, tenant_id, payload.honors)
    _replace_cert(db, student_id, tenant_id, payload.certifications)
    _replace_skill(db, student_id, tenant_id, payload.skills)
    db.commit()

    return ok({"updated": True})
