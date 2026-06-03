from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.service import require_role
from app.core.response import ok

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard")
def admin_dashboard(current=Depends(require_role("admin"))):
    _, admin = current
    return ok(
        {
            "welcome": f"欢迎回来，{admin.display_name or admin.email}",
            "modules": ["智能体管理", "主智能体配置", "模型广场", "MCP 广场", "Skills 广场", "知识库"],
        }
    )
