"""add agent_type to student_agent_session

Revision ID: 20260610_0016
Revises: 20260610_0015
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = "20260610_0016"
down_revision = "20260610_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch_op:
        batch_op.add_column(
            sa.Column("agent_type", sa.String(32), nullable=False, server_default="resume")
        )


def downgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch_op:
        batch_op.drop_column("agent_type")
