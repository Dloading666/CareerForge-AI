"""add runtime metrics to student agent messages

Revision ID: 20260610_0017
Revises: 20260610_0016
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = "20260610_0017"
down_revision = "20260610_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("student_agent_message") as batch_op:
        batch_op.add_column(sa.Column("model_name", sa.String(128), nullable=True))
        batch_op.add_column(sa.Column("prompt_tokens", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("completion_tokens", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("total_tokens", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("duration_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("student_agent_message") as batch_op:
        batch_op.drop_column("duration_ms")
        batch_op.drop_column("total_tokens")
        batch_op.drop_column("completion_tokens")
        batch_op.drop_column("prompt_tokens")
        batch_op.drop_column("model_name")
