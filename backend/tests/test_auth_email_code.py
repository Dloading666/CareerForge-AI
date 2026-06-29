import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth.schemas import StudentEmailCodeSendRequest
from app.auth.service import send_student_email_code
from app.infra.db import Base


class StudentEmailCodeSecurityTests(unittest.TestCase):
    def setUp(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = path
        self.engine = create_engine(f"sqlite:///{path}", future=True)
        self.SessionLocal = sessionmaker(bind=self.engine, future=True)
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()
        os.remove(self.db_path)

    def test_email_code_is_never_returned_in_response(self):
        settings = SimpleNamespace(
            email_code_cooldown_seconds=60,
            email_code_ttl_minutes=10,
        )
        provider = Mock()
        payload = StudentEmailCodeSendRequest(
            email="student@example.com",
            scene="register",
            captcha_id="captcha-id",
            captcha_code="ABCD",
        )

        with self.SessionLocal() as db:
            with patch("app.auth.service.get_settings", return_value=settings), \
                    patch("app.auth.service.get_mail_provider", return_value=provider), \
                    patch("app.auth.service.verify_captcha", return_value=True), \
                    patch("app.auth.service.generate_email_code", return_value="123456"), \
                    patch("app.infra.redis_client.get_redis", side_effect=ConnectionError):
                result = send_student_email_code(db, payload)

        self.assertEqual(result, {"cooldown_sec": 60})
        provider.send_code.assert_called_once_with(
            email="student@example.com",
            scene="register",
            code="123456",
        )


if __name__ == "__main__":
    unittest.main()
