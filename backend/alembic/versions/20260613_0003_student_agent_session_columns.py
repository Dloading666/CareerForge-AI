"""add missing columns to student_agent_session

Revision ID: 20260613_0006
Revises: 20260612_0026, 20260613_0005
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260613_0006"
down_revision = ("20260612_0026", "20260613_0005")
branch_labels = None
depends_on = None


def _has_column(table, column):
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade():
    if not _has_column("student_agent_session", "active_resume_id"):
        op.add_column("student_agent_session", sa.Column("active_resume_id", sa.Integer(), nullable=True))
    if not _has_column("student_agent_session", "memory_json"):
        op.add_column("student_agent_session", sa.Column("memory_json", sa.Text(), nullable=True))
    if not _has_column("student_agent_session", "summarized_until_message_id"):
        op.add_column("student_agent_session", sa.Column("summarized_until_message_id", sa.Integer(), nullable=True))


def downgrade():
    if _has_column("student_agent_session", "summarized_until_message_id"):
        op.drop_column("student_agent_session", "summarized_until_message_id")
    if _has_column("student_agent_session", "memory_json"):
        op.drop_column("student_agent_session", "memory_json")
    if _has_column("student_agent_session", "active_resume_id"):
        op.drop_column("student_agent_session", "active_resume_id")
