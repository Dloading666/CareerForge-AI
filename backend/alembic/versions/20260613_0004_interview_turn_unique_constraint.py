"""add unique constraint (session_id, turn_index) to interview_turns

Revision ID: 20260613_0004
Revises: 20260613_0003
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260613_0004"
down_revision = "20260613_0003"
branch_labels = None
depends_on = None


def _has_index(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return any(item["name"] == name for item in inspector.get_indexes(table))


def upgrade():
    if not _has_index("interview_turns", "uq_interview_turn_session_turn_index"):
        op.create_index(
            "uq_interview_turn_session_turn_index",
            "interview_turns",
            ["session_id", "turn_index"],
            unique=True,
        )


def downgrade():
    if _has_index("interview_turns", "uq_interview_turn_session_turn_index"):
        op.drop_index("uq_interview_turn_session_turn_index", table_name="interview_turns")
