"""add submit_request_id to interview_turns for idempotent submit

Revision ID: 20260613_0003
Revises: 20260612_0024_interview
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260613_0003"
down_revision = "20260612_0024_interview"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade():
    if not _has_column("interview_turns", "submit_request_id"):
        op.add_column(
            "interview_turns",
            sa.Column("submit_request_id", sa.String(length=80), nullable=True),
        )
        op.create_index(
            "ix_interview_turns_submit_request_id",
            "interview_turns",
            ["submit_request_id"],
            unique=False,
        )


def downgrade():
    if _has_column("interview_turns", "submit_request_id"):
        op.drop_index("ix_interview_turns_submit_request_id", table_name="interview_turns")
        op.drop_column("interview_turns", "submit_request_id")
