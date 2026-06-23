from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.admin.vision_service import (
    VisionConfigUpdate,
    get_or_create_vision_config,
    test_vision_config,
    update_vision_config,
)
from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/admin", tags=["vision"])


@router.get("/vision/config")
def api_get_vision_config(
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    identity, _ = current
    return ok(get_or_create_vision_config(db, tenant_id=identity.tenant_id))


@router.put("/vision/config")
def api_update_vision_config(
    payload: VisionConfigUpdate,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    identity, _ = current
    return ok(update_vision_config(db, payload, tenant_id=identity.tenant_id))


@router.post("/vision/test")
def api_test_vision_config(
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    identity, _ = current
    return ok(test_vision_config(db, tenant_id=identity.tenant_id))
