import os
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth.models import StudentUser
from app.core.security import create_access_token
from app.infra.db import Base, get_db
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
        for index in range(5):
            response = self._create_resume(self.token_a, f"简历{index + 1}")
            self.assertEqual(response.status_code, 201)

        sixth = self._create_resume(self.token_a, "第六份")
        self.assertEqual(sixth.status_code, 400)
        self.assertIn("最多保留 5 份简历", sixth.json()["detail"])

        listing = self.client.get("/api/v1/student/resumes", headers=self._headers(self.token_a))
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.json()["data"]), 5)

        resume_id = listing.json()["data"][0]["id"]
        deleted = self.client.delete(f"/api/v1/student/resumes/{resume_id}", headers=self._headers(self.token_a))
        self.assertEqual(deleted.status_code, 200)

        listing_after = self.client.get("/api/v1/student/resumes", headers=self._headers(self.token_a))
        self.assertEqual(len(listing_after.json()["data"]), 4)

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


if __name__ == "__main__":
    unittest.main()
