"""系统设置 — system_config"""
from alembic import op
import sqlalchemy as sa

revision = "20260604_0003"
down_revision = "20260604_0002"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("system_config",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("config_key", sa.String(64), nullable=False, unique=True),
        sa.Column("config_value", sa.Text(), nullable=True),
        sa.Column("description", sa.String(256), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

def downgrade():
    op.drop_table("system_config")
