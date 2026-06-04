"""模型广场 — model_config + model_test_log"""
from alembic import op
import sqlalchemy as sa

revision = "20260604_0002"
down_revision = "20260603_0001"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("model_config",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("deploy_type", sa.String(32), nullable=False, server_default="cloud"),
        sa.Column("capability", sa.String(32), nullable=False, server_default="chat"),
        sa.Column("protocols", sa.String(256), nullable=False, server_default="openai"),
        sa.Column("base_url", sa.String(512), nullable=False),
        sa.Column("api_key_cipher", sa.String(1024), nullable=True),
        sa.Column("model_identifier", sa.String(256), nullable=False),
        sa.Column("dify_model_ref", sa.String(128), nullable=True),
        sa.Column("context_length", sa.Integer(), nullable=True),
        sa.Column("default_temp", sa.Float(), nullable=True),
        sa.Column("max_output", sa.Integer(), nullable=True),
        sa.Column("timeout_sec", sa.Integer(), nullable=True),
        sa.Column("open_to_student", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table("model_test_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("model_id", sa.Integer(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("tested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_model_test_log_model_id", "model_test_log", ["model_id"])

def downgrade():
    op.drop_index("ix_model_test_log_model_id", table_name="model_test_log")
    op.drop_table("model_test_log")
    op.drop_table("model_config")
