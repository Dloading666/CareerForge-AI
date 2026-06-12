from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class WorkExperienceItem(BaseModel):
    id: Optional[int] = None
    company: Optional[str] = None
    position: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    description: Optional[str] = None


class ProjectItem(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    role: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    link: Optional[str] = Field(default=None, max_length=512)
    link_label: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = None


class HonorItem(BaseModel):
    id: Optional[int] = None
    title: Optional[str] = None
    level: Optional[str] = None
    award_date: Optional[str] = None
    description: Optional[str] = None


class CertificationItem(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    issuer: Optional[str] = None
    issue_date: Optional[str] = None
    expire_date: Optional[str] = None
    description: Optional[str] = None


class EducationItem(BaseModel):
    id: Optional[int] = None
    school: Optional[str] = None
    major: Optional[str] = None
    degree: Optional[str] = None
    duration: Optional[str] = None
    gpa: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = None


class SkillItem(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    level: Optional[int] = Field(default=None, ge=1, le=5)
    description: Optional[str] = None


class ProfileDetailsResponse(BaseModel):
    work_experiences: List[WorkExperienceItem] = []
    projects: List[ProjectItem] = []
    educations: List[EducationItem] = []
    honors: List[HonorItem] = []
    certifications: List[CertificationItem] = []
    skills: List[SkillItem] = []


class ProfileDetailsUpdateRequest(BaseModel):
    work_experiences: List[WorkExperienceItem] = Field(default_factory=list)
    projects: List[ProjectItem] = Field(default_factory=list)
    educations: List[EducationItem] = Field(default_factory=list)
    honors: List[HonorItem] = Field(default_factory=list)
    certifications: List[CertificationItem] = Field(default_factory=list)
    skills: List[SkillItem] = Field(default_factory=list)
