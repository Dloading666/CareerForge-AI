import os
import tempfile
import unittest
from typing import Any
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import sso as sso_module
from app.auth.models import StudentUser
from app.auth.router import router as auth_router
from app.infra.db import Base, get_db


def _build_result(**overrides: Any) -> dict[str, Any]:
    base = {
        "id": "1001",
        "username": "zhangsan",
        "realname": "张三",
        "email": "zhangsan@example.com",
        "phone": "13800138000",
        "avatar": "https://example.com/avatar.png",
    }
    base.update(overrides)
    return base


def _ok_envelope(result: dict[str, Any]) -> dict[str, Any]:
    return {"success": True, "message": "ok", "result": result}


def _fail_envelope(message: str = "token 已失效") -> dict[str, Any]:
    return {"success": False, "message": message, "result": None}


class SSOLoginTests(unittest.TestCase):
    def setUp(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = path
        self.engine = create_engine(
            f"sqlite:///{path}",
            connect_args={"check_same_thread": False},
            future=True,
        )
        self.SessionLocal = sessionmaker(
            bind=self.engine, autocommit=False, autoflush=False, future=True
        )
        Base.metadata.create_all(self.engine)

        self.app = FastAPI()
        self.app.include_router(auth_router, prefix="/api/v1")

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        self.app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(self.app)

    def tearDown(self):
        self.engine.dispose()
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    # ---------- 1. 全新 SSO 用户登录 ----------
    def test_new_sso_user_is_created_with_sso_auth_source(self):
        with patch.object(sso_module, "fetch_zhongtai_user", return_value=_build_result()) as mock:
            resp = self.client.post(
                "/api/v1/auth/sso/login",
                json={"token": "fake-token"},
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["code"], 0)
        self.assertEqual(body["data"]["role"], "student")
        self.assertTrue(body["data"]["access"])
        self.assertTrue(body["data"]["refresh"])
        self.assertEqual(body["data"]["profile"]["email"], "zhangsan@example.com")
        mock.assert_called_once()

        with self.SessionLocal() as db:
            user = db.query(StudentUser).filter_by(external_username="zhangsan").one()
            self.assertEqual(user.auth_source, "sso")
            self.assertIsNone(user.password_hash)
            self.assertEqual(user.external_source, "qingzhu")
            self.assertEqual(user.external_id, "1001")
            self.assertEqual(user.name, "张三")
            self.assertEqual(user.avatar_url, "https://example.com/avatar.png")
            self.assertEqual(user.phone, "13800138000")

    # ---------- 2. 已有 external_username 命中 ----------
    def test_existing_user_by_external_username_reused(self):
        with self.SessionLocal() as db:
            db.add(
                StudentUser(
                    tenant_id=0,
                    account="existing@example.com",
                    email="existing@example.com",
                    password_hash="$2b$12$dummy",
                    name="老用户",
                    external_username="zhangsan",
                    external_source="qingzhu",
                    auth_source="sso",
                    is_deleted=False,
                )
            )
            db.commit()

        with patch.object(
            sso_module,
            "fetch_zhongtai_user",
            return_value=_build_result(email="different@example.com"),
        ):
            resp = self.client.post(
                "/api/v1/auth/sso/login",
                json={"token": "fake-token"},
            )

        self.assertEqual(resp.status_code, 200)
        with self.SessionLocal() as db:
            users = db.query(StudentUser).filter_by(external_username="zhangsan").all()
            self.assertEqual(len(users), 1)
            self.assertEqual(users[0].email, "existing@example.com")
            self.assertEqual(users[0].name, "老用户")
            self.assertEqual(users[0].auth_source, "sso")

    # ---------- 3. email 相同但 username 不匹配 → 不关联，新建账号 ----------
    def test_email_match_but_username_differs_creates_new_account(self):
        with self.SessionLocal() as db:
            db.add(
                StudentUser(
                    tenant_id=0,
                    account="zhangsan@example.com",
                    email="zhangsan@example.com",
                    password_hash="$2b$12$dummy",
                    name="邮箱注册用户",
                    auth_source="email",
                    is_deleted=False,
                )
            )
            db.commit()

        # 中台返回的 username 跟本地已有记录不同
        with patch.object(
            sso_module,
            "fetch_zhongtai_user",
            return_value=_build_result(username="otheruser"),
        ):
            resp = self.client.post(
                "/api/v1/auth/sso/login",
                json={"token": "fake-token"},
            )

        self.assertEqual(resp.status_code, 200)
        with self.SessionLocal() as db:
            # 原账号不动
            original = (
                db.query(StudentUser)
                .filter_by(email="zhangsan@example.com")
                .one()
            )
            self.assertIsNone(original.external_username)
            self.assertEqual(original.auth_source, "email")
            # 新建一条 external_username="otheruser"
            new_user = (
                db.query(StudentUser).filter_by(external_username="otheruser").one()
            )
            self.assertEqual(new_user.auth_source, "sso")
            self.assertNotEqual(new_user.id, original.id)

    # ---------- 4. 重复登录沿用同一条记录 ----------
    def test_repeat_login_uses_same_record(self):
        with patch.object(sso_module, "fetch_zhongtai_user", return_value=_build_result()):
            self.client.post("/api/v1/auth/sso/login", json={"token": "t1"})
            self.client.post("/api/v1/auth/sso/login", json={"token": "t2"})

        with self.SessionLocal() as db:
            self.assertEqual(
                db.query(StudentUser).filter_by(external_username="zhangsan").count(),
                1,
            )

    # ---------- 5. result.password 不入库不返回 ----------
    def test_password_field_is_ignored(self):
        with patch.object(
            sso_module,
            "fetch_zhongtai_user",
            return_value=_build_result(password="topsecret"),
        ):
            resp = self.client.post(
                "/api/v1/auth/sso/login",
                json={"token": "fake-token"},
            )
        self.assertEqual(resp.status_code, 200)
        body_text = resp.text
        self.assertNotIn("topsecret", body_text)
        self.assertNotIn("password", body_text)
        with self.SessionLocal() as db:
            user = db.query(StudentUser).filter_by(external_username="zhangsan").one()
            self.assertIsNone(user.password_hash)

    # ---------- 6. 中台 success=false ----------
    def test_zhongtai_success_false_returns_401(self):
        with patch.object(
            sso_module,
            "fetch_zhongtai_user",
            side_effect=sso_module.InvalidSSOTokenError("token 已失效"),
        ):
            resp = self.client.post(
                "/api/v1/auth/sso/login",
                json={"token": "bad"},
            )
        self.assertEqual(resp.status_code, 401)

    # ---------- 7. 中台不可达 ----------
    def test_zhongtai_unavailable_returns_503(self):
        with patch.object(
            sso_module,
            "fetch_zhongtai_user",
            side_effect=sso_module.SSOUnavailableError("timeout"),
        ):
            resp = self.client.post(
                "/api/v1/auth/sso/login",
                json={"token": "any"},
            )
        self.assertEqual(resp.status_code, 503)

    # ---------- 8. result 缺少 username ----------
    def test_missing_username_returns_401(self):
        with patch.object(
            sso_module,
            "fetch_zhongtai_user",
            return_value={"id": "1", "email": "x@y.com"},
        ):
            resp = self.client.post(
                "/api/v1/auth/sso/login",
                json={"token": "any"},
            )
        self.assertEqual(resp.status_code, 401)

    # ---------- 9. 关联后本地邮箱密码 hash 保留（username 命中） ----------
    def test_association_preserves_existing_password_hash(self):
        with self.SessionLocal() as db:
            db.add(
                StudentUser(
                    tenant_id=0,
                    account="linked@example.com",
                    email="linked@example.com",
                    password_hash="$2b$12$fixed",
                    name="已注册用户",
                    external_username="zhangsan",  # 已有 SSO 关联键
                    auth_source="email",
                    is_deleted=False,
                )
            )
            db.commit()

        with patch.object(sso_module, "fetch_zhongtai_user", return_value=_build_result()):
            resp = self.client.post("/api/v1/auth/sso/login", json={"token": "t"})

        self.assertEqual(resp.status_code, 200)
        with self.SessionLocal() as db:
            user = (
                db.query(StudentUser)
                .filter_by(external_username="zhangsan")
                .one()
            )
            # 关联后 password_hash 保留（方案 B：两边都能登录）
            self.assertEqual(user.password_hash, "$2b$12$fixed")

    # ---------- 10. 全新 SSO 用户不能用邮箱密码登录（password_hash 为 None） ----------
    def test_new_sso_user_cannot_login_with_email_password(self):
        with patch.object(sso_module, "fetch_zhongtai_user", return_value=_build_result()):
            self.client.post("/api/v1/auth/sso/login", json={"token": "t"})

        resp = self.client.post(
            "/api/v1/auth/student/login",
            json={
                "email": "zhangsan@example.com",
                "password": "Abcd1234",
            },
        )
        self.assertEqual(resp.status_code, 401)

    # ---------- 11. 关联后本地邮箱密码登录仍可用（方案 B） ----------
    def test_associated_user_can_still_login_with_email_password(self):
        # venv 中 passlib + bcrypt 4.x 不兼容（已知环境问题），mock 掉 verify_password
        from app.auth import service as service_module

        with self.SessionLocal() as db:
            db.add(
                StudentUser(
                    tenant_id=0,
                    account="linked@example.com",
                    email="linked@example.com",
                    password_hash="any-hash",
                    name="已注册用户",
                    external_username="zhangsan",
                    auth_source="email",
                    is_deleted=False,
                )
            )
            db.commit()

        with patch.object(sso_module, "fetch_zhongtai_user", return_value=_build_result()):
            sso_resp = self.client.post("/api/v1/auth/sso/login", json={"token": "t"})
        self.assertEqual(sso_resp.status_code, 200)

        # 关联后 auth_source 仍为 email，password_hash 仍在 → 邮箱密码登录路径可用
        with patch.object(service_module, "verify_password", return_value=True), patch(
            "app.auth.service.get_redis"
        ):
            email_resp = self.client.post(
                "/api/v1/auth/student/login",
                json={"email": "linked@example.com", "password": "Abcd1234"},
            )
        self.assertEqual(email_resp.status_code, 200, email_resp.text)
        self.assertEqual(email_resp.json()["data"]["role"], "student")


class FetchZhongtaiUserTests(unittest.TestCase):
    """验证 fetch_zhongtai_user 走的是 URL query 串，不是 JSON body。"""

    def test_token_passed_as_query_param(self):
        captured = {}

        class _FakeResp:
            status_code = 200

            def json(self):
                return _ok_envelope(_build_result())

        class _FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, url, params=None, json=None, **kwargs):
                captured["url"] = url
                captured["params"] = params
                captured["json"] = json
                return _FakeResp()

        with patch.object(sso_module.httpx, "AsyncClient", _FakeClient):
            import asyncio
            result = asyncio.run(sso_module.fetch_zhongtai_user("my-token"))

        self.assertIn("params", captured, "中台 call 必须传 params（query 串）")
        self.assertIsNone(captured["json"], "不应再传 JSON body")
        self.assertEqual(captured["params"], {"token": "my-token"})
        self.assertIn("/sys/checkToken", captured["url"])
        self.assertEqual(result["username"], "zhangsan")


if __name__ == "__main__":
    unittest.main()