"""add student nickname field (idempotent - column may already exist)

Revision ID: 20260613_0002
Revises: 20260613_0001
Create Date: 2026-06-12

The original migration was 20260612_0022 (nickname) but that revision ID
collided with the team's 20260612_0022 (interview overhaul). This file
re-introduces the nickname column on top of the team's merge head.
The upgrade is a guarded no-op so re-runs are safe.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260613_0002"
down_revision = "20260613_0001"
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