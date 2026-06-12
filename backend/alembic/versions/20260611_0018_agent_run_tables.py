"""add student_agent_run and student_agent_run_event tables

Revision ID: 20260611_0018
Revises: 20260610_0017_interview
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa

revision = "20260611_0018"
down_revision = "20260610_0017_interview"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- student_agent_run ---
    op.create_table(
        "student_agent_run",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer, nullable=False, server_default="0"),
        sa.Column("student_id", sa.Integer, nullable=False),
        sa.Column("session_id", sa.Integer, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("assistant_message_id", sa.BigInteger, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime, nullable=True),
        sa.Column("error_text", sa.Text, nullable=True),
    )
    op.create_index("ix_student_agent_run_tenant_student", "student_agent_run", ["tenant_id", "student_id"])
    op.create_index("ix_student_agent_run_tenant_session", "student_agent_run", ["tenant_id", "session_id"])
    op.create_index("ix_student_agent_run_tenant_status", "student_agent_run", ["tenant_id", "status"])

    # --- student_agent_run_event ---
    op.create_table(
        "student_agent_run_event",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer, nullable=False, server_default="0"),
        sa.Column("run_id", sa.BigInteger, nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("event", sa.String(32), nullable=False),
        sa.Column("data_json", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_student_agent_run_event_run_seq", "student_agent_run_event", ["run_id", "seq"])
    op.create_index("ix_student_agent_run_event_tenant_run", "student_agent_run_event", ["tenant_id", "run_id"])


def downgrade() -> None:
    op.drop_table("student_agent_run_event")
    op.drop_table("student_agent_run")
