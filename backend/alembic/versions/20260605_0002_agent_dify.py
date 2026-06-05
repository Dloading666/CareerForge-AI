"""add dify fields to agent table"""

from alembic import op
import sqlalchemy as sa

revision = "20260605_0002"
down_revision = "20260605_0001"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("agent", sa.Column("use_dify", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("agent", sa.Column("dify_api_key_cipher", sa.String(1024), nullable=True))
    op.add_column("agent", sa.Column("dify_app_id", sa.String(128), nullable=True))

def downgrade():
    op.drop_column("agent", "dify_app_id")
    op.drop_column("agent", "dify_api_key_cipher")
    op.drop_column("agent", "use_dify")
