"""merge heads 20260617_0001 + 20260618_0001

两个迁移（interview_report_analysis 表、student_user SSO 字段）都声明了
down_revision = ("20260613_0006", "20260615_0001")，导致产生两个 head，
`alembic upgrade head` 因多 head 失败（违反「必须只有一个 head」约定）。
本迁移把两个 head 合并成单一线性链，不新增任何表/列。

Revision ID: 20260623_0001
Revises: 20260617_0001, 20260618_0001
Create Date: 2026-06-23
"""
from alembic import op


revision = "20260623_0001"
down_revision = ("20260617_0001", "20260618_0001")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 纯 merge，无 DDL。
    pass


def downgrade() -> None:
    # merge 节点不可逆降级（会重新产生多 head）。
    pass
