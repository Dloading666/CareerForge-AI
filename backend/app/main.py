from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin.router import router as admin_router
from app.auth import models  # noqa: F401
from app.auth.router import router as auth_router
from app.auth.service import ensure_admin_bootstrap
from app.core.config import get_settings
from app.infra.db import Base, SessionLocal, engine
from app.infra.redis_client import ping_redis
from app.student.router import router as student_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ensure_admin_bootstrap(db)
    finally:
        db.close()
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(admin_router, prefix=settings.api_v1_prefix)
app.include_router(student_router, prefix=settings.api_v1_prefix)


@app.get("/")
def read_root():
    return {
        "name": settings.app_name,
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "redis": "ok" if ping_redis() else "unavailable",
    }
