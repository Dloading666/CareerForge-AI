"""模型广场 + 系统设置 — 业务逻辑层"""
from __future__ import annotations

import base64
import time
from typing import Optional

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.admin.models import ModelConfig, ModelTestLog, SystemConfig
from app.admin.schemas import ModelCreate, ModelUpdate, ModelListQuery, ModelResponse, ModelTestResponse


# ── API Key 加解密（base64，后续可升级 AES） ─────

def encrypt_api_key(plain: str) -> str:
    return base64.urlsafe_b64encode(plain.encode("utf-8")).decode("utf-8")


def decrypt_api_key(cipher: str) -> str:
    return base64.urlsafe_b64decode(cipher.encode("utf-8")).decode("utf-8")


# ── 模型 CRUD ────────────────────────────────────

def list_models(db: Session, query: ModelListQuery) -> dict:
    stmt = select(ModelConfig).where(ModelConfig.is_deleted == False)
    if query.capability:
        stmt = stmt.where(ModelConfig.capability == query.capability)
    if query.status:
        stmt = stmt.where(ModelConfig.status == query.status)
    if query.open_to_student is not None:
        stmt = stmt.where(ModelConfig.open_to_student == query.open_to_student)
    if query.keyword:
        kw = f"%{query.keyword}%"
        stmt = stmt.where(
            (ModelConfig.display_name.ilike(kw))
            | (ModelConfig.model_identifier.ilike(kw))
            | (ModelConfig.provider.ilike(kw))
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(ModelConfig.created_at.desc()).offset((query.page - 1) * query.size).limit(query.size)).all()
    return {"list": [ModelResponse.model_validate(r) for r in rows], "total": total or 0, "page": query.page, "size": query.size}


def create_model(db: Session, payload: ModelCreate) -> ModelResponse:
    model = ModelConfig(
        display_name=payload.display_name, provider=payload.provider, deploy_type=payload.deploy_type,
        capability=payload.capability, protocols=payload.protocols, base_url=payload.base_url,
        api_key_cipher=encrypt_api_key(payload.api_key) if payload.api_key else None,
        model_identifier=payload.model_identifier, dify_model_ref=payload.dify_model_ref,
        context_length=payload.context_length, default_temp=payload.default_temp,
        max_output=payload.max_output, timeout_sec=payload.timeout_sec,
        open_to_student=payload.open_to_student,
    )
    db.add(model); db.commit(); db.refresh(model)
    return ModelResponse.model_validate(model)


def _get_model(db: Session, model_id: int) -> ModelConfig:
    model = db.scalar(select(ModelConfig).where(ModelConfig.id == model_id, ModelConfig.is_deleted == False))
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模型不存在")
    return model


def get_model_detail(db: Session, model_id: int) -> ModelResponse:
    return ModelResponse.model_validate(_get_model(db, model_id))


def update_model(db: Session, model_id: int, payload: ModelUpdate) -> ModelResponse:
    model = _get_model(db, model_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "api_key" in update_data:
        key = update_data.pop("api_key")
        update_data["api_key_cipher"] = encrypt_api_key(key) if key else None
    for field, value in update_data.items():
        setattr(model, field, value)
    db.commit(); db.refresh(model)
    return ModelResponse.model_validate(model)


def delete_model(db: Session, model_id: int) -> None:
    _get_model(db, model_id).is_deleted = True
    db.commit()


def toggle_open(db: Session, model_id: int, open_flag: bool) -> ModelResponse:
    model = _get_model(db, model_id)
    model.open_to_student = open_flag
    db.commit(); db.refresh(model)
    return ModelResponse.model_validate(model)


# ── 测试连接 ────────────────────────────────────

async def test_model_connection(db: Session, model_id: int) -> ModelTestResponse:
    model = _get_model(db, model_id)
    api_key = decrypt_api_key(model.api_key_cipher) if model.api_key_cipher else None
    success, latency_ms, error_message = False, None, None

    headers = {"User-Agent": "CareerForge-ModelTest/1.0"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=httpx.Timeout(model.timeout_sec or 30)) as client:
            resp = await client.get(model.base_url.rstrip("/"), headers=headers)
        latency_ms = int((time.perf_counter() - start) * 1000)
        success = resp.status_code < 500
        if not success:
            error_message = f"HTTP {resp.status_code}"
    except httpx.TimeoutException:
        error_message = f"连接超时 ({model.timeout_sec or 30}s)"
    except httpx.ConnectError:
        error_message = "无法连接到目标地址"
    except Exception as e:
        error_message = str(e)[:500]

    log_entry = ModelTestLog(model_id=model.id, success=success, latency_ms=latency_ms, error_message=error_message)
    db.add(log_entry); db.commit(); db.refresh(log_entry)
    return ModelTestResponse(success=log_entry.success, latency_ms=log_entry.latency_ms, error_message=log_entry.error_message, model_id=log_entry.model_id, tested_at=log_entry.tested_at)


async def test_batch(db: Session) -> list[ModelTestResponse]:
    models = db.scalars(select(ModelConfig).where(ModelConfig.is_deleted == False)).all()
    results = []
    for model in models:
        results.append(await test_model_connection(db, model.id))
    return results


# ── 种子数据 ────────────────────────────────────

DEFAULT_MODELS = [
    {
        "display_name": "DeepSeek V4 Pro",
        "provider": "DeepSeek",
        "deploy_type": "cloud",
        "capability": "chat",
        "protocols": "openai",
        "base_url": "https://api.deepseek.com/v1",
        "model_identifier": "deepseek-v4-pro",
        "context_length": 131072,
        "default_temp": 0.7,
        "max_output": 32768,
        "timeout_sec": 120,
        "open_to_student": False,
    },
    {
        "display_name": "DeepSeek V4 Flash",
        "provider": "DeepSeek",
        "deploy_type": "cloud",
        "capability": "chat",
        "protocols": "openai",
        "base_url": "https://api.deepseek.com/v1",
        "model_identifier": "deepseek-v4-flash",
        "context_length": 131072,
        "default_temp": 0.7,
        "max_output": 32768,
        "timeout_sec": 120,
        "open_to_student": False,
    },
    {
        "display_name": "DeepSeek Chat (V3)",
        "provider": "DeepSeek",
        "deploy_type": "cloud",
        "capability": "chat",
        "protocols": "openai",
        "base_url": "https://api.deepseek.com/v1",
        "model_identifier": "deepseek-chat",
        "context_length": 65536,
        "default_temp": 0.7,
        "max_output": 8192,
        "timeout_sec": 120,
        "open_to_student": True,
    },
]


def seed_default_models(db: Session) -> None:
    """首次启动时预置模型广场默认模型（仅当 model_config 表为空时执行）"""
    existing = db.scalar(select(func.count()).select_from(ModelConfig).where(ModelConfig.is_deleted == False))
    if existing and existing > 0:
        return

    for item in DEFAULT_MODELS:
        model = ModelConfig(
            display_name=item["display_name"],
            provider=item["provider"],
            deploy_type=item["deploy_type"],
            capability=item["capability"],
            protocols=item["protocols"],
            base_url=item["base_url"],
            api_key_cipher=None,  # API Key 需管理员手动配置
            model_identifier=item["model_identifier"],
            context_length=item["context_length"],
            default_temp=item["default_temp"],
            max_output=item["max_output"],
            timeout_sec=item["timeout_sec"],
            open_to_student=item["open_to_student"],
            status="active",
        )
        db.add(model)
    db.commit()


# ── 系统配置 ────────────────────────────────────

DEFAULT_CONFIG: dict[str, str] = {
    "platform_name": "智培职联",
    "maintenance_mode": "false",
    "maintenance_message": "系统维护中，请稍后再试",
    "announcement": "",
    "announcement_enabled": "false",
}



# ── 公告管理 ─────────────────────────────────────

from app.admin.models import Announcement
from app.admin.schemas import AnnouncementCreate, AnnouncementUpdate, AnnouncementResponse, AnnouncementListResponse


def list_announcements(db: Session, page: int = 1, size: int = 20, active_only: bool = False) -> AnnouncementListResponse:
    stmt = select(Announcement)
    if active_only:
        stmt = stmt.where(Announcement.is_active == True)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Announcement.priority.desc(), Announcement.created_at.desc()).offset((page - 1) * size).limit(size)).all()
    return AnnouncementListResponse(
        list=[AnnouncementResponse.model_validate(r) for r in rows],
        total=total or 0,
    )


def create_announcement(db: Session, payload: AnnouncementCreate, user_id: int | None = None) -> AnnouncementResponse:
    ann = Announcement(
        title=payload.title,
        content=payload.content,
        announcement_type=payload.announcement_type,
        priority=payload.priority,
        is_active=payload.is_active,
        start_time=payload.start_time,
        end_time=payload.end_time,
        created_by=user_id,
    )
    db.add(ann); db.commit(); db.refresh(ann)
    return AnnouncementResponse.model_validate(ann)


def get_announcement(db: Session, ann_id: int) -> AnnouncementResponse:
    ann = db.scalar(select(Announcement).where(Announcement.id == ann_id))
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    return AnnouncementResponse.model_validate(ann)


def update_announcement(db: Session, ann_id: int, payload: AnnouncementUpdate) -> AnnouncementResponse:
    ann = db.scalar(select(Announcement).where(Announcement.id == ann_id))
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(ann, field, value)
    db.commit(); db.refresh(ann)
    return AnnouncementResponse.model_validate(ann)


def delete_announcement(db: Session, ann_id: int) -> None:
    ann = db.scalar(select(Announcement).where(Announcement.id == ann_id))
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    db.delete(ann)
    db.commit()

def get_all_config(db: Session) -> dict[str, str | None]:
    rows = db.scalars(select(SystemConfig)).all()
    config = {r.config_key: r.config_value for r in rows}
    for key, value in DEFAULT_CONFIG.items():
        if key not in config:
            config[key] = value
    return config


def update_config(db: Session, items: list[dict]) -> dict[str, str | None]:
    for item in items:
        key = item["config_key"]
        value = item.get("config_value")
        row = db.scalar(select(SystemConfig).where(SystemConfig.config_key == key))
        if row:
            row.config_value = value
        else:
            db.add(SystemConfig(config_key=key, config_value=value))
    db.commit()
    return get_all_config(db)
