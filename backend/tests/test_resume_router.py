import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth.models import StudentUser
from app.core.security import create_access_token
from app.infra.db import Base, get_db
from app.student.profile_details_models import (
    StudentEducation,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
from app.student.profile_details_router import router as profile_details_router
from app.student.resume_models import StudentResume  # noqa: F401
from app.student.resume_router import router as resume_router


class ResumeRouterTests(unittest.TestCase):
    def setUp(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = path
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False}, future=True)
        self.SessionLocal = sessionmaker(bind=self.engine, autocommit=False, autoflush=False, future=True)
        Base.metadata.create_all(self.engine)

        with self.SessionLocal() as db:
            db.add(
                StudentUser(
                    id=1,
                    tenant_id=0,
                    account="student-a",
                    email="student-a@example.com",
                    password_hash="x",
                    name="A同学",
                    is_deleted=False,
                )
            )
            db.add(
                StudentUser(
                    id=2,
                    tenant_id=0,
                    account="student-b",
                    email="student-b@example.com",
                    password_hash="x",
                    name="B同学",
                    is_deleted=False,
                )
            )
            db.commit()

        app = FastAPI()
        app.include_router(resume_router, prefix="/api/v1")
        app.include_router(profile_details_router, prefix="/api/v1")

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        self.token_a = create_access_token(sub="1", role="student", tenant_id=0)
        self.token_b = create_access_token(sub="2", role="student", tenant_id=0)

    def tearDown(self):
        self.engine.dispose()
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def _headers(self, token: str):
        return {"Authorization": f"Bearer {token}"}

    def _create_resume(self, token: str, title: str):
        return self.client.post(
            "/api/v1/student/resumes",
            headers=self._headers(token),
            json={"title": title, "templateId": "classic", "visibility": False, "data": {"title": title}},
        )

    def test_create_limit_and_delete_flow(self):
        for index in range(6):
            response = self._create_resume(self.token_a, f"简历{index + 1}")
            self.assertEqual(response.status_code, 201)

        seventh = self._create_resume(self.token_a, "第七份")
        self.assertEqual(seventh.status_code, 400)
        self.assertIn("简历数量已达上限（6 份）", seventh.json()["detail"])

        listing = self.client.get("/api/v1/student/resumes", headers=self._headers(self.token_a))
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.json()["data"]), 6)

        resume_id = listing.json()["data"][0]["id"]
        deleted = self.client.delete(f"/api/v1/student/resumes/{resume_id}", headers=self._headers(self.token_a))
        self.assertEqual(deleted.status_code, 200)

        listing_after = self.client.get("/api/v1/student/resumes", headers=self._headers(self.token_a))
        self.assertEqual(len(listing_after.json()["data"]), 5)

    def test_update_overwrites_document(self):
        created = self._create_resume(self.token_a, "初始简历")
        resume_id = created.json()["data"]["id"]

        update_response = self.client.put(
            f"/api/v1/student/resumes/{resume_id}",
            headers=self._headers(self.token_a),
            json={
                "title": "更新后的简历",
                "templateId": "modern",
                "visibility": True,
                "data": {
                    "title": "更新后的简历",
                    "templateId": "modern",
                    "visibility": True,
                    "basic": {"name": "张三", "title": "后端开发", "email": "a@example.com", "phone": "", "location": "", "birthDate": "", "gender": "", "photo": ""},
                    "education": [],
                    "experience": [],
                    "projects": [],
                    "skills": [{"id": "skill-1", "name": "Python", "level": 5}],
                    "selfEvaluation": "执行力强",
                    "globalSettings": {"themeColor": "#165dff", "baseFontSize": 14, "pagePadding": 30, "lineHeight": 1.7, "sectionSpacing": 24},
                    "menuSections": [],
                },
            },
        )
        self.assertEqual(update_response.status_code, 200)
        detail = update_response.json()["data"]
        self.assertEqual(detail["title"], "更新后的简历")
        self.assertEqual(detail["templateId"], "modern")
        self.assertTrue(detail["visibility"])
        self.assertEqual(detail["data"]["skills"][0]["name"], "Python")

    def test_user_cannot_access_other_students_resume(self):
        created = self._create_resume(self.token_a, "A的简历")
        resume_id = created.json()["data"]["id"]

        get_response = self.client.get(f"/api/v1/student/resumes/{resume_id}", headers=self._headers(self.token_b))
        self.assertEqual(get_response.status_code, 404)

        delete_response = self.client.delete(f"/api/v1/student/resumes/{resume_id}", headers=self._headers(self.token_b))
        self.assertEqual(delete_response.status_code, 404)

    def test_default_resume_uses_structured_profile_details(self):
        with self.SessionLocal() as db:
            student = db.get(StudentUser, 1)
            student.phone = "13800000000"
            student.birth_date = "2003-08-15"
            student.expected_position = "前端开发工程师"
            student.expected_location = "重庆"
            student.job_search_status = "unemployed"
            student.resume_avatar_url = "/static/avatars/resume-test.png"
            student.personal_advantages = "学习能力强\n善于跨团队协作"
            db.add(
                StudentEducation(
                    tenant_id=0,
                    student_id=1,
                    school="重庆工程学院",
                    major="软件工程",
                    degree="本科",
                    duration="2021-09 ~ 2025-06",
                    gpa="3.8/4.0",
                    description="专业前 5%",
                    sort_order=0,
                )
            )
            db.add(
                StudentWorkExperience(
                    tenant_id=0,
                    student_id=1,
                    company="示例科技",
                    position="前端开发实习生",
                    start_date="2024-07-01",
                    end_date="2024-10-01",
                    description="负责管理后台开发",
                    sort_order=0,
                )
            )
            db.add(
                StudentProject(
                    tenant_id=0,
                    student_id=1,
                    name="校园智能问答助手",
                    role="前端负责人",
                    start_date="2024-03-01",
                    end_date="至今",
                    link="https://project.example.com",
                    link_label="在线访问",
                    description="完成对话工作台与流式响应",
                    sort_order=0,
                )
            )
            db.add(
                StudentSkill(
                    tenant_id=0,
                    student_id=1,
                    name="React",
                    level=4,
                    description="熟悉 Hooks 与状态管理",
                    sort_order=0,
                )
            )
            db.commit()

        response = self.client.post(
            "/api/v1/student/resumes",
            headers=self._headers(self.token_a),
            json={"templateId": "classic"},
        )

        self.assertEqual(response.status_code, 201)
        document = response.json()["data"]["data"]
        self.assertEqual(document["basic"]["title"], "前端开发工程师")
        self.assertEqual(document["basic"]["location"], "重庆")
        self.assertEqual(document["basic"]["birthDate"], "2003-08-15")
        self.assertEqual(document["basic"]["photo"], "/static/avatars/resume-test.png")
        self.assertEqual(document["education"][0]["school"], "重庆工程学院")
        self.assertEqual(document["education"][0]["gpa"], "3.8/4.0")
        self.assertEqual(document["experience"][0]["company"], "示例科技")
        self.assertEqual(document["projects"][0]["linkLabel"], "在线访问")
        self.assertIn("React", document["skillContent"])
        self.assertIn("学习能力强", document["selfEvaluationContent"])

    def test_profile_detail_extended_fields_round_trip(self):
        updated = self.client.put(
            "/api/v1/student/profile/details",
            headers=self._headers(self.token_a),
            json={
                "educations": [
                    {
                        "school": "重庆工程学院",
                        "major": "软件工程",
                        "degree": "本科",
                        "duration": "2021-09 ~ 2025-06",
                        "gpa": "3.8/4.0",
                        "description": "专业前 5%",
                    }
                ],
                "work_experiences": [],
                "projects": [
                    {
                        "name": "校园智能问答助手",
                        "role": "前端负责人",
                        "start_date": "2024-03-01",
                        "end_date": "至今",
                        "link": "https://project.example.com",
                        "link_label": "在线访问",
                        "description": "完成流式对话工作台",
                    }
                ],
                "honors": [],
                "certifications": [],
                "skills": [],
            },
        )
        self.assertEqual(updated.status_code, 200)

        fetched = self.client.get(
            "/api/v1/student/profile/details",
            headers=self._headers(self.token_a),
        )
        self.assertEqual(fetched.status_code, 200)
        details = fetched.json()["data"]
        self.assertEqual(details["educations"][0]["gpa"], "3.8/4.0")
        self.assertEqual(details["projects"][0]["link"], "https://project.example.com")
        self.assertEqual(details["projects"][0]["link_label"], "在线访问")

    def test_import_file_surfaces_llm_provider_error(self):
        request = httpx.Request("POST", "https://llm.example.test/chat/completions")
        upstream_response = httpx.Response(
            400,
            request=request,
            text='{"error":{"message":"model not found"}}',
        )
        provider_error = httpx.HTTPStatusError(
            "400 Bad Request from chat/completions: model not found",
            request=request,
            response=upstream_response,
        )

        with (
            patch("app.student.resume_import_service.extract_resume_file", return_value="x" * 300),
            patch("app.student.resume_import_service.parse_resume_text_to_data", side_effect=provider_error),
        ):
            response = self.client.post(
                "/api/v1/student/resumes/import/file",
                headers=self._headers(self.token_a),
                files={"file": ("resume.pdf", b"%PDF-1.4 text", "application/pdf")},
            )

        self.assertEqual(response.status_code, 502)
        self.assertIn("LLM", response.json()["detail"])
        self.assertIn("model not found", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
