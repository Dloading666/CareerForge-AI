"""主智能体配置和路由规则"""

from alembic import op
import sqlalchemy as sa

revision = "20260605_0007"
down_revision = "20260605_0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "master_agent_config",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("model_id", sa.Integer(), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("max_tokens", sa.Integer(), nullable=True),
        sa.Column("max_iterations", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("permission_mode", sa.String(16), nullable=False, server_default="ask"),
        sa.Column("memory_isolation", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("model_passthrough", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("fallback_mode", sa.String(32), nullable=False, server_default="direct_answer"),
        sa.Column("fallback_message", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", name="uq_master_agent_config_tenant"),
    )
    op.create_index("ix_master_agent_config_tenant_id", "master_agent_config", ["tenant_id"])

    op.create_table(
        "master_route_rule",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("intent", sa.String(256), nullable=False),
        sa.Column("target_agent_key", sa.String(64), nullable=False),
        sa.Column("target_agent_name", sa.String(128), nullable=False),
        sa.Column("memory_strategy", sa.String(32), nullable=False, server_default="isolated"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_master_route_rule_tenant_id", "master_route_rule", ["tenant_id"])


def downgrade():
    op.drop_index("ix_master_route_rule_tenant_id", table_name="master_route_rule")
    op.drop_table("master_route_rule")
    op.drop_index("ix_master_agent_config_tenant_id", table_name="master_agent_config")
    op.drop_table("master_agent_config")
