"""agent table"""
from alembic import op
import sqlalchemy as sa

revision = "20260604_0004"
down_revision = "20260604_0003"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("agent",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.String(256), nullable=True),
        sa.Column("category", sa.String(32), nullable=False, server_default="other"),
        sa.Column("icon_name", sa.String(64), nullable=True, server_default="smart_toy"),
        sa.Column("icon_color_from", sa.String(16), nullable=True, server_default="#7C4DFF"),
        sa.Column("icon_color_to", sa.String(16), nullable=True, server_default="#2962FF"),
        sa.Column("model_config_id", sa.Integer(), nullable=True),
        sa.Column("welcome_message", sa.String(512), nullable=True),
        sa.Column("suggested_questions", sa.Text(), nullable=True),
        sa.Column("prompt_variables", sa.Text(), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="0.7"),
        sa.Column("max_tokens", sa.Integer(), nullable=False, server_default="4096"),
        sa.Column("top_p", sa.Float(), nullable=False, server_default="0.9"),
        sa.Column("frequency_penalty", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("presence_penalty", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("memory_window", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

def downgrade():
    op.drop_table("agent")
