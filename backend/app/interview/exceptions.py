"""Interview module — domain exceptions.

All custom errors live here so router / service / harness can import
them without circular dependencies.
"""
from __future__ import annotations


class InterviewError(Exception):
    """Base class for all interview domain errors."""

    status_code: int = 500
    detail: str = "Internal server error"

    def __init__(self, detail: str | None = None, *, status_code: int | None = None):
        self.detail = detail or self.__class__.detail
        self.status_code = status_code or self.__class__.status_code
        super().__init__(self.detail)


class InterviewNotFoundError(InterviewError):
    status_code = 404
    detail = "面试会话不存在"


class InterviewNotActiveError(InterviewError):
    status_code = 400
    detail = "面试已经结束"


class InterviewNoPendingQuestionError(InterviewError):
    status_code = 400
    detail = "没有待回答的问题"


class InterviewReportExistsError(InterviewError):
    status_code = 400
    detail = "报告已存在"


class InterviewConfigError(InterviewError):
    status_code = 500
    detail = "面试配置错误"


class InterviewLLMError(InterviewError):
    status_code = 502
    detail = "AI 模型服务暂时不可用"


class InterviewReportGenerationError(InterviewError):
    status_code = 500
    detail = "报告生成失败"
