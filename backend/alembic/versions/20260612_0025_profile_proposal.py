"""add student_profile_proposal table

Revision ID: 20260612_0025
Revises: 20260612_0024
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0025"
down_revision = "20260612_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_profile_proposal",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer, nullable=False, server_default="0"),
        sa.Column("student_id", sa.Integer, nullable=False),
        sa.Column("session_id", sa.Integer, nullable=True),
        sa.Column("section", sa.String(32), nullable=False),
        sa.Column("payload_json", sa.Text, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_proposal_tenant_student", "student_profile_proposal", ["tenant_id", "student_id"])


def downgrade() -> None:
    op.drop_table("student_profile_proposal")
