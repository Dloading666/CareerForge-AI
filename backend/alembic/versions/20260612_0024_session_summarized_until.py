"""add summarized_until_message_id to student_agent_session

Revision ID: 20260612_0024
Revises: 20260612_0023
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0024"
down_revision = "20260612_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch:
        batch.add_column(sa.Column("summarized_until_message_id", sa.Integer, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch:
        batch.drop_column("summarized_until_message_id")
