"""merge: resume_avatar branch + nickname branch

This migration merges the two heads produced by the prior branching of
``20260611_0020`` so subsequent ``alembic upgrade head`` calls work against a
single head (``20260612_0023``).
"""

revision = "20260612_0023"
down_revision = ("20260611_0021", "20260612_0022")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
