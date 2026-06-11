"""add jd_text and jd_analyzed_at to student_agent_session

Revision ID: 20260611_0020
Revises: 20260612_0019
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa

revision = "20260611_0020"
down_revision = "20260612_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch_op:
        batch_op.add_column(sa.Column("jd_text", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("jd_analyzed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("student_agent_session") as batch_op:
        batch_op.drop_column("jd_analyzed_at")
        batch_op.drop_column("jd_text")
