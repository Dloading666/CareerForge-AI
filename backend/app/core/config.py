from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    app_env: str = Field(default="development", alias="APP_ENV")
    app_name: str = Field(default="智培职联 AI 智能体平台", alias="APP_NAME")
    api_v1_prefix: str = Field(default="/api/v1", alias="API_V1_PREFIX")
    frontend_origin: str = Field(default="http://localhost:5173", alias="FRONTEND_ORIGIN")
    database_url: str = Field(default="sqlite:///./zhipei_auth.db", alias="DATABASE_URL")
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    jwt_secret_key: str = Field(default="change-me-in-production", alias="JWT_SECRET_KEY")
    access_token_expire_minutes: int = Field(default=30, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=7, alias="REFRESH_TOKEN_EXPIRE_DAYS")
    login_fail_limit: int = Field(default=5, alias="LOGIN_FAIL_LIMIT")
    login_fail_window_seconds: int = Field(default=600, alias="LOGIN_FAIL_WINDOW_SECONDS")
    login_lock_seconds: int = Field(default=900, alias="LOGIN_LOCK_SECONDS")

    admin_bootstrap_username: str = Field(default="admin", alias="ADMIN_BOOTSTRAP_USERNAME")
    admin_bootstrap_email: str = Field(default="admin@example.com", alias="ADMIN_BOOTSTRAP_EMAIL")
    admin_bootstrap_password: str = Field(default="123456", alias="ADMIN_BOOTSTRAP_PASSWORD")
    admin_bootstrap_name: str = Field(default="平台管理员", alias="ADMIN_BOOTSTRAP_NAME")

    smtp_host: Optional[str] = Field(default=None, alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_username: Optional[str] = Field(default=None, alias="SMTP_USERNAME")
    smtp_password: Optional[str] = Field(default=None, alias="SMTP_PASSWORD")
    smtp_from_email: str = Field(default="no-reply@example.com", alias="SMTP_FROM_EMAIL")
    smtp_use_ssl: bool = Field(default=False, alias="SMTP_USE_SSL")
    smtp_use_tls: bool = Field(default=True, alias="SMTP_USE_TLS")

    email_code_length: int = Field(default=6, alias="EMAIL_CODE_LENGTH")
    email_code_ttl_minutes: int = Field(default=10, alias="EMAIL_CODE_TTL_MINUTES")
    email_code_cooldown_seconds: int = Field(default=60, alias="EMAIL_CODE_COOLDOWN_SECONDS")
    email_code_max_attempts: int = Field(default=5, alias="EMAIL_CODE_MAX_ATTEMPTS")

    skill_storage_dir: str = Field(default="./data/skills", alias="SKILL_STORAGE_DIR")
    skill_max_content_bytes: int = Field(default=200_000, alias="SKILL_MAX_CONTENT_BYTES")
    agent_upload_storage_dir: str = Field(default="./data/agent_uploads", alias="AGENT_UPLOAD_STORAGE_DIR")
    agent_upload_max_bytes: int = Field(default=20_000_000, alias="AGENT_UPLOAD_MAX_BYTES")

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() != "production"

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_username and self.smtp_password)


@lru_cache
def get_settings() -> Settings:
    return Settings()
