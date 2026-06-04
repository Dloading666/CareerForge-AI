from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.admin.model_service import (
    create_model, delete_model, get_all_config, get_model_detail,
    list_models, test_batch, test_model_connection, toggle_open, update_config, update_model,
)
from app.admin.schemas import (
    ModelCreate, ModelListQuery, ModelToggleOpen, ModelUpdate, SystemConfigUpdate,
)
from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard")
def admin_dashboard(current=Depends(require_role("admin"))):
    _, admin = current
    return ok({"welcome": f"欢迎回来，{admin.display_name or admin.email}", "modules": ["智能体管理", "主智能体配置", "模型广场", "MCP 广场", "Skills 广场", "知识库"]})


# ── 模型广场 ─────────────────────────────────────

@router.get("/models")
def api_list_models(capability: str | None = Query(None), status: str | None = Query(None), open_to_student: bool | None = Query(None, alias="open"), keyword: str | None = Query(None), page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(list_models(db, ModelListQuery(capability=capability, status=status, open_to_student=open_to_student, keyword=keyword, page=page, size=size)))

@router.post("/models", status_code=201)
def api_create_model(payload: ModelCreate, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(create_model(db, payload))

@router.get("/models/{model_id}")
def api_get_model(model_id: int, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(get_model_detail(db, model_id))

@router.put("/models/{model_id}")
def api_update_model(model_id: int, payload: ModelUpdate, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(update_model(db, model_id, payload))

@router.delete("/models/{model_id}")
def api_delete_model(model_id: int, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    delete_model(db, model_id); return ok(msg="已删除")

@router.post("/models/{model_id}/test")
async def api_test_model(model_id: int, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(await test_model_connection(db, model_id))

@router.post("/models/test-batch")
async def api_test_batch(db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(await test_batch(db))

@router.patch("/models/{model_id}/open")
def api_toggle_open(model_id: int, payload: ModelToggleOpen, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(toggle_open(db, model_id, payload.open))


# ── 系统设置 ─────────────────────────────────────

@router.get("/system/config")
def api_get_system_config(db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(get_all_config(db))

@router.put("/system/config")
def api_update_system_config(payload: SystemConfigUpdate, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(update_config(db, [item.model_dump() for item in payload.items]))
