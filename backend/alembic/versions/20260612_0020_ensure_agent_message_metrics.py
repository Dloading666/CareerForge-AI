"""ensure runtime metrics columns exist on student_agent_message

Revision ID: 20260612_0020
Revises: 20260612_0019
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0020"
down_revision = "20260612_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("student_agent_message")}
    with op.batch_alter_table("student_agent_message") as batch_op:
        if "model_name" not in columns:
            batch_op.add_column(sa.Column("model_name", sa.String(128), nullable=True))
        if "prompt_tokens" not in columns:
            batch_op.add_column(sa.Column("prompt_tokens", sa.Integer(), nullable=True))
        if "completion_tokens" not in columns:
            batch_op.add_column(sa.Column("completion_tokens", sa.Integer(), nullable=True))
        if "total_tokens" not in columns:
            batch_op.add_column(sa.Column("total_tokens", sa.Integer(), nullable=True))
        if "duration_ms" not in columns:
            batch_op.add_column(sa.Column("duration_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("student_agent_message")}
    with op.batch_alter_table("student_agent_message") as batch_op:
        if "duration_ms" in columns:
            batch_op.drop_column("duration_ms")
        if "total_tokens" in columns:
            batch_op.drop_column("total_tokens")
        if "completion_tokens" in columns:
            batch_op.drop_column("completion_tokens")
        if "prompt_tokens" in columns:
            batch_op.drop_column("prompt_tokens")
        if "model_name" in columns:
            batch_op.drop_column("model_name")
