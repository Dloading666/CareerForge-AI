"""add active_resume_id and memory_json to student_agent_session

Revision ID: 20260612_0022
Revises: 20260612_0021
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0022"
down_revision = "20260612_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch:
        batch.add_column(sa.Column("active_resume_id", sa.Integer, nullable=True))
        batch.add_column(sa.Column("memory_json", sa.Text, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch:
        batch.drop_column("memory_json")
        batch.drop_column("active_resume_id")
