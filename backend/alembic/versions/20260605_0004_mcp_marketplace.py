"""MCP marketplace tables"""
from alembic import op
import sqlalchemy as sa

revision = "20260605_0004"
down_revision = "20260604_0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mcp_service",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(64), nullable=False, server_default="通用"),
        sa.Column("transport", sa.String(32), nullable=False, server_default="Streamable HTTP"),
        sa.Column("endpoint", sa.String(512), nullable=False),
        sa.Column("auth_type", sa.String(64), nullable=False, server_default="无鉴权"),
        sa.Column("auth_config", sa.Text(), nullable=True),
        sa.Column("owner", sa.String(128), nullable=True),
        sa.Column("version", sa.String(32), nullable=False, server_default="v1.0.0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="enabled"),
        sa.Column("agent_ids_json", sa.Text(), nullable=False),  # MySQL: TEXT 不能有 DEFAULT，由 ORM default="[]" 兜底
        sa.Column("auto_disable_on_error", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("success_rate", sa.Integer(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_mcp_service_slug"),
    )
    op.create_index("ix_mcp_service_slug", "mcp_service", ["slug"])
    op.create_index("ix_mcp_service_status", "mcp_service", ["status"])
    op.create_index("ix_mcp_service_is_deleted", "mcp_service", ["is_deleted"])
    op.create_index("ix_mcp_service_created_by_admin_id", "mcp_service", ["created_by_admin_id"])

    op.create_table(
        "mcp_tool",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("service_id", sa.Integer(), sa.ForeignKey("mcp_service.id"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("risk", sa.String(32), nullable=False, server_default="低风险"),
        sa.Column("input_schema_json", sa.Text(), nullable=False),  # MySQL: TEXT 不能有 DEFAULT，由 ORM default="{}" 兜底
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("service_id", "name", name="uq_mcp_tool_service_name"),
    )
    op.create_index("ix_mcp_tool_service_id", "mcp_tool", ["service_id"])

    op.create_table(
        "mcp_call_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("service_id", sa.Integer(), nullable=True),
        sa.Column("service_name", sa.String(128), nullable=False),
        sa.Column("tool_name", sa.String(128), nullable=False),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("agent_name", sa.String(128), nullable=False),
        sa.Column("request_text", sa.Text(), nullable=True),
        sa.Column("response_json", sa.Text(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mcp_call_log_service_id", "mcp_call_log", ["service_id"])
    op.create_index("ix_mcp_call_log_created_by_admin_id", "mcp_call_log", ["created_by_admin_id"])


def downgrade():
    op.drop_index("ix_mcp_call_log_created_by_admin_id", table_name="mcp_call_log")
    op.drop_index("ix_mcp_call_log_service_id", table_name="mcp_call_log")
    op.drop_table("mcp_call_log")
    op.drop_index("ix_mcp_tool_service_id", table_name="mcp_tool")
    op.drop_table("mcp_tool")
    op.drop_index("ix_mcp_service_created_by_admin_id", table_name="mcp_service")
    op.drop_index("ix_mcp_service_is_deleted", table_name="mcp_service")
    op.drop_index("ix_mcp_service_status", table_name="mcp_service")
    op.drop_index("ix_mcp_service_slug", table_name="mcp_service")
    op.drop_table("mcp_service")
