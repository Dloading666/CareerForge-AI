"""add mcp_service.config_json

为 McpService 增加 config_json 列，用于存储服务级配置（如视觉模型 ID）。

Revision ID: 20260623_0003
Revises: 20260623_0002
Create Date: 2026-06-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260623_0003"
down_revision = "20260623_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mcp_service", sa.Column("config_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mcp_service", "config_json")
