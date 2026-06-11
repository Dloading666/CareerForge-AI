"""interview model selection and report comparison

Revision ID: 20260610_0017_interview
Revises: 20260610_0017
Create Date: 2026-06-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260610_0017_interview"
down_revision = "20260610_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "interview_sessions" in tables:
        columns = {col["name"] for col in inspector.get_columns("interview_sessions")}
        if "model_config_id" not in columns:
            op.add_column("interview_sessions", sa.Column("model_config_id", sa.Integer(), nullable=True))
    if "interview_reports" in tables:
        columns = {col["name"] for col in inspector.get_columns("interview_reports")}
        if "comparison_json" not in columns:
            op.add_column("interview_reports", sa.Column("comparison_json", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "interview_reports" in tables:
        columns = {col["name"] for col in inspector.get_columns("interview_reports")}
        if "comparison_json" in columns:
            op.drop_column("interview_reports", "comparison_json")
    if "interview_sessions" in tables:
        columns = {col["name"] for col in inspector.get_columns("interview_sessions")}
        if "model_config_id" in columns:
            op.drop_column("interview_sessions", "model_config_id")
