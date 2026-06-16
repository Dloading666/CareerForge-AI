"""add student_resume_revision table

Revision ID: 20260612_0023
Revises: 20260612_0022
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0023"
down_revision = "20260612_0022"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table in inspector.get_table_names()


def _has_index(table: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == index_name for item in inspector.get_indexes(table))


def upgrade() -> None:
    if not _has_table("student_resume_revision"):
        op.create_table(
            "student_resume_revision",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer, nullable=False, server_default="0"),
            sa.Column("student_id", sa.Integer, nullable=False),
            sa.Column("resume_id", sa.Integer, nullable=False),
            sa.Column("data_json", sa.Text, nullable=False),
            sa.Column("title", sa.String(128), nullable=False),
            sa.Column("template_id", sa.String(64), nullable=False),
            sa.Column("source", sa.String(32), nullable=False, server_default="ai_update"),
            sa.Column("session_id", sa.Integer, nullable=True),
            sa.Column("message_id", sa.Integer, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if not _has_index("student_resume_revision", "ix_resume_revision_tenant_student"):
        op.create_index("ix_resume_revision_tenant_student", "student_resume_revision", ["tenant_id", "student_id"])
    if not _has_index("student_resume_revision", "ix_resume_revision_resume_id"):
        op.create_index("ix_resume_revision_resume_id", "student_resume_revision", ["resume_id"])


def downgrade() -> None:
    op.drop_table("student_resume_revision")
