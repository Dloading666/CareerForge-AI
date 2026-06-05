from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.mcp.schemas import McpCallRequest, McpServiceCreate, McpServiceUpdate, McpStatusRequest
from app.mcp.service import (
    build_tool_pool,
    call_tool,
    create_service,
    delete_service,
    discover_tools,
    list_call_logs,
    list_services,
    set_service_status,
    test_service,
    update_service,
)

router = APIRouter(prefix="/admin", tags=["mcp"])


@router.get("/mcp-services")
def api_list_mcp_services(
    keyword: str | None = Query(None),
    status: str | None = Query(None),
    category: str | None = Query(None),
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    return ok(list_services(db, keyword=keyword, status_filter=status, category=category))


@router.post("/mcp-services", status_code=201)
def api_create_mcp_service(
    payload: McpServiceCreate,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    identity, _ = current
    return ok(create_service(db, payload, admin_id=identity.user_id), msg="created")


@router.put("/mcp-services/{service_id}")
def api_update_mcp_service(
    service_id: int,
    payload: McpServiceUpdate,
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    return ok(update_service(db, service_id, payload))


@router.delete("/mcp-services/{service_id}")
def api_delete_mcp_service(
    service_id: int,
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    delete_service(db, service_id)
    return ok({"deleted": True})


@router.patch("/mcp-services/{service_id}/status")
def api_set_mcp_service_status(
    service_id: int,
    payload: McpStatusRequest,
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    return ok(set_service_status(db, service_id, payload.status))


@router.post("/mcp-services/{service_id}/test")
def api_test_mcp_service(
    service_id: int,
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    return ok(test_service(db, service_id))


@router.post("/mcp-services/{service_id}/discover")
def api_discover_mcp_tools(
    service_id: int,
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    return ok(discover_tools(db, service_id))


@router.post("/mcp-call")
def api_call_mcp_tool(
    payload: McpCallRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    identity, _ = current
    return ok(call_tool(db, payload, admin_id=identity.user_id))


@router.get("/mcp-call-logs")
def api_list_mcp_call_logs(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    return ok(list_call_logs(db, limit=limit))


@router.get("/mcp-tool-pool")
def api_get_mcp_tool_pool(
    db: Session = Depends(get_db),
    _current=Depends(require_role("admin")),
):
    return ok(build_tool_pool(db))
