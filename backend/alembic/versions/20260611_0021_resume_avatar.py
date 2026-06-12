"""add dedicated resume profile fields

Revision ID: 20260611_0021
Revises: 20260611_0020
"""

from alembic import op
import sqlalchemy as sa


revision = "20260611_0021"
down_revision = "20260611_0020"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade():
    if not _has_column("student_user", "resume_avatar_url"):
        op.add_column(
            "student_user",
            sa.Column("resume_avatar_url", sa.String(length=512), nullable=True),
        )
    if not _has_column("student_project", "link"):
        op.add_column(
            "student_project",
            sa.Column("link", sa.String(length=512), nullable=True),
        )
    if not _has_column("student_project", "link_label"):
        op.add_column(
            "student_project",
            sa.Column("link_label", sa.String(length=64), nullable=True),
        )
    if not _has_column("student_education", "gpa"):
        op.add_column(
            "student_education",
            sa.Column("gpa", sa.String(length=64), nullable=True),
        )


def downgrade():
    if _has_column("student_education", "gpa"):
        op.drop_column("student_education", "gpa")
    if _has_column("student_project", "link_label"):
        op.drop_column("student_project", "link_label")
    if _has_column("student_project", "link"):
        op.drop_column("student_project", "link")
    if _has_column("student_user", "resume_avatar_url"):
        op.drop_column("student_user", "resume_avatar_url")
