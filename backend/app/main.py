from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.admin.agent_router import router as agent_router
from app.admin.agent_service import seed_default_agents
from app.admin.model_service import seed_default_models
from app.admin.router import router as admin_router
from app.admin import models as admin_models  # noqa: F401
from app.agent.router import router as public_agent_router
from app.admin import master_models as master_models  # noqa: F401
from app.auth import models  # noqa: F401
from app.auth.router import router as auth_router
from app.auth.service import ensure_admin_bootstrap
from app.core.config import get_settings
from app.infra.db import Base, SessionLocal, engine
from app.infra.redis_client import ping_redis
from app.mcp import models as mcp_models  # noqa: F401
from app.mcp.router import router as mcp_router
from app.skills import models as skill_models  # noqa: F401
from app.skills.router import router as skills_router
from app.student import agent_models as student_agent_models  # noqa: F401
from app.student.router import router as student_router
from app.student.event_router import router as event_router
from app.student.announcement_router import router as announcement_router
from app.student.feedback_router import router as feedback_router
from app.admin.feedback_router import router as admin_feedback_router
from app.student.attachment_router import router as attachment_router

AVATAR_DIR = Path("/app/data/avatars")
BANNER_DIR = Path("/app/data/banners")
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
BANNER_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Ensure user_feedback table exists
    from sqlalchemy import text as _text
    with engine.connect() as _conn:
        _conn.execute(_text(
            "CREATE TABLE IF NOT EXISTS user_feedback ("
            "  id INT AUTO_INCREMENT PRIMARY KEY,"
            "  student_id INT NOT NULL,"
            "  student_name VARCHAR(100),"
            "  student_email VARCHAR(200),"
            "  description TEXT NOT NULL,"
            "  category VARCHAR(50) DEFAULT 'bug',"
            "  screenshot_path VARCHAR(500),"
            "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
            "  status VARCHAR(20) DEFAULT 'open'"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        ))
        _conn.commit()
    db = SessionLocal()
    try:
        ensure_admin_bootstrap(db)
        seed_default_models(db)   # 鍏堢瀛愭ā鍨嬶紙鏅鸿兘浣撲緷璧栨ā鍨嬶級
        seed_default_agents(db)
    finally:
        db.close()
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)

# Mount static files
app.mount("/static/banners", StaticFiles(directory=str(BANNER_DIR)), name="banners")
app.mount("/static/avatars", StaticFiles(directory=str(AVATAR_DIR)), name="avatars")

allowed_frontend_origins = list(dict.fromkeys([
    settings.frontend_origin, "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
]))
allowed_origin_regex = r"^http://(localhost|127\.0\.0\.1):\d+$" if settings.is_development else None

app.add_middleware(CORSMiddleware, allow_origins=allowed_frontend_origins,
    allow_origin_regex=allowed_origin_regex, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"])

os.makedirs("data/avatars", exist_ok=True)
os.makedirs("/app/data/feedbacks", exist_ok=True)
app.mount("/feedback-images", StaticFiles(directory="/app/data/feedbacks"), name="feedback-images")
app.mount("/data", StaticFiles(directory="data"), name="data")

app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(admin_router, prefix=settings.api_v1_prefix)
app.include_router(agent_router, prefix=settings.api_v1_prefix)
app.include_router(public_agent_router, prefix=settings.api_v1_prefix)
app.include_router(mcp_router, prefix=settings.api_v1_prefix)
app.include_router(skills_router, prefix=settings.api_v1_prefix)
app.include_router(event_router, prefix=settings.api_v1_prefix)
app.include_router(announcement_router, prefix=settings.api_v1_prefix)
app.include_router(feedback_router, prefix=settings.api_v1_prefix)
app.include_router(admin_feedback_router, prefix=settings.api_v1_prefix)
app.include_router(attachment_router, prefix=settings.api_v1_prefix)
app.include_router(student_router, prefix=settings.api_v1_prefix)


@app.get("/")
def read_root():
    return {"name": settings.app_name, "status": "ok", "docs": "/docs"}


@app.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "redis": "ok" if ping_redis() else "unavailable",
    }
