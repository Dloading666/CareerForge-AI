"""expand student_skill.name to 256

Revision ID: 0026
Revises: 0025
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260612_0026"
down_revision = "20260612_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("student_skill") as batch_op:
        batch_op.alter_column("name", type_=sa.String(256), existing_nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("student_skill") as batch_op:
        batch_op.alter_column("name", type_=sa.String(64), existing_nullable=True)
