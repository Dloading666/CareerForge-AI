"""add active_resume_id to student_agent_session

Revision ID: 20260613_0005
Revises: 20260613_0004
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260613_0005"
down_revision = "20260613_0004"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade() -> None:
    if not _has_column("student_agent_session", "active_resume_id"):
        op.add_column(
            "student_agent_session",
            sa.Column("active_resume_id", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    if _has_column("student_agent_session", "active_resume_id"):
        op.drop_column("student_agent_session", "active_resume_id")
