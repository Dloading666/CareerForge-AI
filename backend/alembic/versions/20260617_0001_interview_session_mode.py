"""Add interview_mode column to interview_sessions."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260617_0001"
down_revision = "20260613_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "interview_sessions",
        sa.Column(
            "interview_mode",
            sa.String(16),
            nullable=False,
            server_default="text",
        ),
    )


def downgrade() -> None:
    op.drop_column("interview_sessions", "interview_mode")
