from __future__ import annotations

from typing import Literal
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, model_validator


class StudentEmailCodeSendRequest(BaseModel):
    email: EmailStr
    scene: Literal["register", "login", "reset", "change_email"]
    # 重置密码场景需先通过图形验证码
    captcha_id: Optional[str] = None
    captcha_code: Optional[str] = None


class StudentRegisterRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_passwords(self):
        if self.password != self.confirm_password:
            raise ValueError("两次输入的密码不一致")
        if (
            not any(char.islower() for char in self.password)
            or not any(char.isupper() for char in self.password)
            or not any(char.isdigit() for char in self.password)
        ):
            raise ValueError("密码至少 8 位，且需包含大写字母、小写字母和数字")
        return self


class StudentResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_passwords(self):
        if self.password != self.confirm_password:
            raise ValueError("两次输入的密码不一致")
        if (
            not any(char.islower() for char in self.password)
            or not any(char.isupper() for char in self.password)
            or not any(char.isdigit() for char in self.password)
        ):
            raise ValueError("密码至少 8 位，且需包含大写字母、小写字母和数字")
        return self


class StudentLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class AdminLoginRequest(BaseModel):
    account: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class UnifiedLoginRequest(BaseModel):
    account: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class RefreshRequest(BaseModel):
    refresh: str


class LogoutRequest(BaseModel):
    refresh: str


class SSOLoginRequest(BaseModel):
    token: str = Field(min_length=1, max_length=2048)


class StudentChangeEmailRequest(BaseModel):
    new_email: EmailStr
    code: str = Field(min_length=4, max_length=8)
