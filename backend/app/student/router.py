from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.service import require_role
from app.core.response import ok

router = APIRouter(prefix="/student", tags=["student"])


@router.get("/home")
def student_home(current=Depends(require_role("student"))):
    _, student = current
    return ok(
        {
            "welcome": f"你好，{student.name or '同学'}",
            "suggestions": [
                "帮我模拟一次面试",
                "看看我和某岗位的匹配度",
                "优化我的简历项目经历",
            ],
        }
    )
