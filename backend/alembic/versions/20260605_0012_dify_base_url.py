"""add dify_api_base_url to agent table"""

from alembic import op
import sqlalchemy as sa

revision = "20260605_0012"
down_revision = "20260605_0011"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("agent", sa.Column("dify_api_base_url", sa.String(512), nullable=True))

def downgrade():
    op.drop_column("agent", "dify_api_base_url")
