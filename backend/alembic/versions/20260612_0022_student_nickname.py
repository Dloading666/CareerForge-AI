"""add student nickname field

Revision ID: 20260612_0022
Revises: 20260612_0021
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0022"
down_revision = "20260611_0021"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade():
    if not _has_column("student_user", "nickname"):
        op.add_column(
            "student_user",
            sa.Column("nickname", sa.String(length=64), nullable=True),
        )


def downgrade():
    if _has_column("student_user", "nickname"):
        op.drop_column("student_user", "nickname")
