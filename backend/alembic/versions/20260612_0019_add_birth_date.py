"""add birth_date to student_user

Revision ID: 20260612_0019
Revises: 20260611_0018
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0019"
down_revision = "20260611_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "student_user",
        sa.Column("birth_date", sa.String(16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("student_user", "birth_date")
