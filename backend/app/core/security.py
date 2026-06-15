from __future__ import annotations

from datetime import datetime, timedelta
from hashlib import sha256
from uuid import uuid4

import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"


def utcnow() -> datetime:
    return datetime.utcnow()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def hash_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def create_access_token(*, sub: str, role: str, tenant_id: int) -> str:
    settings = get_settings()
    expires_at = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": sub,
        "role": role,
        "tenant_id": tenant_id,
        "typ": "access",
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def create_refresh_token(*, sub: str, role: str, tenant_id: int) -> tuple[str, datetime]:
    settings = get_settings()
    expires_at = utcnow() + timedelta(days=settings.refresh_token_expire_days)
    payload = {
        "sub": sub,
        "role": role,
        "tenant_id": tenant_id,
        "typ": "refresh",
        "jti": uuid4().hex,
        "exp": expires_at,
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)
    return token, expires_at


def decode_token(token: str, expected_type: str) -> dict:
    settings = get_settings()
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="\u8ba4\u8bc1\u4fe1\u606f\u65e0\u6548\u6216\u5df2\u8fc7\u671f",
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise credentials_error from exc

    token_type = payload.get("typ")
    if token_type != expected_type:
        raise credentials_error
    return payload


# --- API key encryption (Fernet) -----------------------------------------------
# Replaces the base64 placeholder previously in admin/model_service.py.
# Backed by API_KEY_ENCRYPTION_KEY (Fernet 32-byte url-safe base64).

_fernet_instance: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        key = get_settings().api_key_encryption_key.encode("utf-8")
        _fernet_instance = Fernet(key)
    return _fernet_instance


def encrypt_api_key(plain: str) -> str:
    """Encrypt an AI provider API key with Fernet (AES-128-CBC + HMAC-SHA256)."""
    return _get_fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_api_key(cipher: str | None) -> str | None:
    """Decrypt a Fernet token. Returns None for empty input or invalid token."""
    if not cipher:
        return None
    try:
        return _get_fernet().decrypt(cipher.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        # Old base64 payloads or corrupted data; caller decides how to react.
        return None