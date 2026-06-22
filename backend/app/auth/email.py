from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import Settings

logger = logging.getLogger(__name__)


class BaseMailProvider:
    def send_code(self, email: str, scene: str, code: str) -> None:
        raise NotImplementedError


class DevMailProvider(BaseMailProvider):
    def send_code(self, email: str, scene: str, code: str) -> None:
        logger.info("DEV email code sent: email=%s scene=%s code=%s", email, scene, code)


class SMTPMailProvider(BaseMailProvider):
    def __init__(self, settings: Settings):
        self.settings = settings

    def send_code(self, email: str, scene: str, code: str) -> None:
        scene_label = {
            "register": "注册",
            "login": "登录",
            "reset": "重置密码",
        }.get(scene, scene)
        message = EmailMessage()
        message["Subject"] = f"CareerForge {scene_label}验证码"
        message["From"] = self.settings.smtp_from_email
        message["To"] = email
        message.set_content(
            f"您的验证码是 {code}。\n"
            f"此验证码 {self.settings.email_code_ttl_minutes} 分钟内有效，"
            "请勿将验证码泄露给他人。"
        )

        smtp_client = smtplib.SMTP_SSL if self.settings.smtp_use_ssl else smtplib.SMTP
        with smtp_client(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as client:
            if self.settings.smtp_use_tls and not self.settings.smtp_use_ssl:
                client.starttls()
            client.login(self.settings.smtp_username, self.settings.smtp_password)
            client.send_message(message)


def get_mail_provider(settings: Settings) -> BaseMailProvider:
    if settings.smtp_enabled:
        return SMTPMailProvider(settings)
    return DevMailProvider()
