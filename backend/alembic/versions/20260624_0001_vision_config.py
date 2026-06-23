"""vision_model_config 表 + 删除 MCP 三表

新建独立的视觉模型配置表（每 tenant 一行，upsert），并移除已废弃的 MCP 广场
三张表（mcp_service / mcp_tool / mcp_call_log）。视觉理解能力改由
vision_model_config 驱动，不再依赖 MCP 服务记录。

安全：本迁移不写入任何 api_key_cipher。

Revision ID: 20260624_0001
Revises: 20260623_0003
Create Date: 2026-06-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260624_0001"
down_revision = "20260623_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 新建视觉模型配置表（单行 per tenant）
    op.create_table(
        "vision_model_config",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("protocol", sa.String(16), nullable=False, server_default="openai"),
        sa.Column("base_url", sa.String(512), nullable=True),
        sa.Column("model_name", sa.String(256), nullable=True),
        sa.Column("api_key_cipher", sa.String(1024), nullable=True),
        sa.Column("max_tokens", sa.Integer(), nullable=False, server_default="2000"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", name="uq_vision_model_config_tenant"),
    )
    op.create_index("ix_vision_model_config_tenant_id", "vision_model_config", ["tenant_id"])

    # 2. 删除 MCP 广场三表（先子后父：call_log → tool → service）
    #    索引随表一并删除，但 SQLite/MySQL 下显式 drop_index 更稳妥。
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


def downgrade() -> None:
    # 反向：重建 MCP 三表（含 20260623_0003 增加的 config_json 列），删除 vision 表
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
        sa.Column("agent_ids_json", sa.Text(), nullable=False),
        sa.Column("auto_disable_on_error", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config_json", sa.Text(), nullable=True),
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
        sa.Column("input_schema_json", sa.Text(), nullable=False),
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

    op.drop_index("ix_vision_model_config_tenant_id", table_name="vision_model_config")
    op.drop_table("vision_model_config")
