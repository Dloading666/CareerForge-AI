"""add interview_report_analysis table

Revision ID: 20260617_0001
Revises: 20260615_0001
Create Date: 2026-06-17

Stores per-student aggregated interview analysis result
(radar + knowledge distribution + summary statistics).
Only one row per student (overwritten on regenerate).
"""

from alembic import op
import sqlalchemy as sa


revision = "20260617_0001"
down_revision = ("20260613_0006", "20260615_0001")
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("interview_report_analysis"):
        return
    op.create_table(
        "interview_report_analysis",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, default=0, index=True),
        sa.Column("student_id", sa.Integer(), nullable=False, index=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ready"),
        sa.Column("report_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("trigger_type", sa.String(length=16), nullable=False, server_default="auto"),
        sa.Column("radar_json", sa.Text(), nullable=True),
        sa.Column("knowledge_json", sa.Text(), nullable=True),
        sa.Column("summary_json", sa.Text(), nullable=True),
        sa.Column("weaknesses_text", sa.Text(), nullable=True),
        sa.Column("llm_meta_json", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_interview_report_analysis_tenant_student",
        "interview_report_analysis",
        ["tenant_id", "student_id"],
    )


def downgrade() -> None:
    if not _has_table("interview_report_analysis"):
        return
    op.drop_index("ix_interview_report_analysis_tenant_student", table_name="interview_report_analysis")
    op.drop_table("interview_report_analysis")
