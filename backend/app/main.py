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
from app.infra.rate_limit import IPRateLimitMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from app.mcp import models as mcp_models  # noqa: F401
from app.mcp.router import router as mcp_router
from app.skills import models as skill_models  # noqa: F401
from app.skills.router import router as skills_router
from app.student import agent_models as student_agent_models  # noqa: F401
from app.student import resume_models as student_resume_models  # noqa: F401
from app.student import event_models as student_event_models  # noqa: F401
from app.student.router import router as student_router
from app.student.profile_details_router import router as student_profile_details_router
from app.student.event_router import router as event_router
from app.student.announcement_router import router as announcement_router
from app.student.feedback_router import router as feedback_router
from app.admin.feedback_router import router as admin_feedback_router
from app.student.attachment_router import router as attachment_router
from app.student.resume_router import router as resume_router
from app.jobs_router import router as jobs_router
from app.student.ai_assist_router import router as resume_ai_router
from app.interview import models as interview_models  # noqa: F401
from app.interview.router_student import router as interview_router

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

    # 启动清扫：把库中 status=running 的孤儿 run 标记 failed
    from app.student.agent_models import StudentAgentRun
    from sqlalchemy import update as _update
    db2 = SessionLocal()
    try:
        db2.execute(
            _update(StudentAgentRun)
            .where(StudentAgentRun.status == "running")
            .values(status="failed", error_text="服务重启导致运行中断")
        )
        db2.commit()
    except Exception:
        db2.rollback()
    finally:
        db2.close()

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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(IPRateLimitMiddleware)

os.makedirs("data/avatars", exist_ok=True)
os.makedirs("/app/data/feedbacks", exist_ok=True)
app.mount("/feedback-images", StaticFiles(directory="/app/data/feedbacks"), name="feedback-images")
# /data 静态挂载已移除：学生简历 PDF 等敏感文件不再通过文件名 obscurity 保护。
# 改用受鉴权保护的 /api/v1/student/files/download 端点。
# app.mount("/data", StaticFiles(directory="data"), name="data")  # 已废弃

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
app.include_router(resume_ai_router, prefix=settings.api_v1_prefix)
app.include_router(student_profile_details_router, prefix=settings.api_v1_prefix)
app.include_router(resume_router, prefix=settings.api_v1_prefix)
app.include_router(jobs_router, prefix=settings.api_v1_prefix)
app.include_router(interview_router, prefix=settings.api_v1_prefix)


# ── Authenticated file download endpoint ──────────────────────────────────────
# 方案：前端无法在 <a href> / <img src> 中携带 Authorization header，
# 因此使用短时效签名 token 作为 query 参数鉴权。
import hashlib as _hashlib
import hmac as _hmac
import time as _time
from fastapi import Query as _Query
from fastapi.responses import FileResponse as _FileResponse


def _sign_download_token(path: str, user_id: int, tenant_id: int) -> str:
    """生成短时效下载签名 token（HMAC-SHA256，有效期 10 分钟）。"""
    exp = int(_time.time()) + 600  # 10 分钟
    payload = f"{tenant_id}:{user_id}:{path}:{exp}"
    sig = _hmac.new(
        settings.jwt_secret_key.encode("utf-8"),
        payload.encode("utf-8"),
        _hashlib.sha256,
    ).hexdigest()[:32]
    return f"{exp}.{sig}"


def _verify_download_token(path: str, user_id: int, tenant_id: int, token: str) -> bool:
    """验证下载签名 token。"""
    try:
        parts = token.split(".", 1)
        if len(parts) != 2:
            return False
        exp = int(parts[0])
        sig = parts[1]
        if _time.time() > exp:
            return False
        payload = f"{tenant_id}:{user_id}:{path}:{exp}"
        expected = _hmac.new(
            settings.jwt_secret_key.encode("utf-8"),
            payload.encode("utf-8"),
            _hashlib.sha256,
        ).hexdigest()[:32]
        return _hmac.compare_digest(sig, expected)
    except Exception:
        return False


def _attachment_download_url_with_token(stored_path: str, user_id: int, tenant_id: int) -> str:
    """生成带签名 token 的下载 URL。"""
    s = stored_path.replace("\\", "/")
    marker = "agent_uploads/"
    idx = s.find(marker)
    rel_path = s[idx:] if idx >= 0 else Path(s).name
    token = _sign_download_token(rel_path, user_id, tenant_id)
    return f"/api/v1/student/files/download?path={rel_path}&token={token}"


@app.get("/api/v1/student/files/download")
def download_file(
    path: str,
    token: str = _Query(default=""),
):
    """受签名 token 保护的文件下载端点。

    鉴权方式：短时效 HMAC 签名 token（query 参数），支持 <a href> / <img src> 直接引用。
    安全校验：token 有效性 + tenant 隔离 + user 隔离 + 路径穿越防护。
    """
    # 解析 token 获取身份信息
    try:
        parts = token.split(".", 1)
        if len(parts) != 2:
            raise ValueError
        exp = int(parts[0])
    except Exception:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="下载链接无效或已过期")

    # 安全路径处理：拒绝含 .. 的路径穿越
    safe_path = path.replace("\\", "/").lstrip("/")
    if ".." in safe_path:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="非法路径")

    # 解析路径中的 tenant_id 和 user_id 并校验 token
    parts_path = safe_path.split("/")
    if len(parts_path) < 3 or parts_path[0] != "agent_uploads":
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该文件")

    try:
        path_tenant = int(parts_path[1])
        path_user = int(parts_path[2])
    except ValueError:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该文件")

    if not _verify_download_token(safe_path, path_user, path_tenant, token):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="下载链接无效或已过期")

    full_path = (Path("data") / safe_path).resolve()
    data_root = Path("data").resolve()
    if not str(full_path).startswith(str(data_root)):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该文件")

    if not full_path.exists() or not full_path.is_file():
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")

    return _FileResponse(str(full_path), filename=full_path.name)


@app.get("/")
def read_root():
    return {"name": settings.app_name, "status": "ok", "docs": "/docs"}


@app.get("/healthz")
def healthz():
    """Liveness + readiness probe. 200 when both Redis and MySQL respond; 503 otherwise."""
    redis_ok = bool(ping_redis())
    mysql_ok = False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        mysql_ok = True
    except Exception:
        mysql_ok = False
    healthy = redis_ok and mysql_ok
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "status": "ok" if healthy else "degraded",
            "redis": "ok" if redis_ok else "unavailable",
            "mysql": "ok" if mysql_ok else "unavailable",
        },
    )
