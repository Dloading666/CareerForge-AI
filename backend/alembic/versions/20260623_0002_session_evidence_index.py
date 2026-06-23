"""add student_agent_session.evidence_index_json

为 StudentAgentSession 增加跨轮证据来源索引列：记录已读 resume_id、
已分析附件、GAP 关键词等元数据，让 per-run 的证据池换轮后能懒重读、
不丢 JD 分析结果（P1.1 证据来源索引）。

Revision ID: 20260623_0002
Revises: 20260623_0001
Create Date: 2026-06-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260623_0002"
down_revision = "20260623_0001"
branch_labels = None
depends_on = None


_TABLE = "student_agent_session"
_COL = "evidence_index_json"


def _has_column(column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return any(item["name"] == column for item in inspector.get_columns(_TABLE))


def upgrade() -> None:
    if _TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    if not _has_column(_COL):
        op.add_column(
            _TABLE,
            sa.Column(_COL, sa.Text(), nullable=True),
        )


def downgrade() -> None:
    if _TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    if _has_column(_COL):
        op.drop_column(_TABLE, _COL)
