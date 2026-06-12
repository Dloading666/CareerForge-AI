"""add summarized_until_message_id to student_agent_session

Revision ID: 20260612_0024
Revises: 20260612_0023
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0024"
down_revision = "20260612_0023"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade() -> None:
    if not _has_column("student_agent_session", "summarized_until_message_id"):
        with op.batch_alter_table("student_agent_session") as batch:
            batch.add_column(sa.Column("summarized_until_message_id", sa.Integer, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch:
        batch.drop_column("summarized_until_message_id")
