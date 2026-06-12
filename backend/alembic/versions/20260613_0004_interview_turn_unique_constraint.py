"""add unique constraint (session_id, turn_index) to interview_turns

Revision ID: 20260613_0004
Revises: 20260613_0003
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260613_0004"
down_revision = "20260613_0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_interview_turn_session_turn_index",
        "interview_turns",
        ["session_id", "turn_index"],
    )


def downgrade():
    op.drop_constraint(
        "uq_interview_turn_session_turn_index",
        "interview_turns",
        type_="unique",
    )