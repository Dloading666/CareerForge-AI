"""student_user SSO fields

为中台 token 登录加字段：
- external_username：中台 username（关联键，全局唯一）
- external_source：来源标记，固定 'qingzhu'
- external_id：中台用户 id
- auth_source：账号主注册来源，'email' 或 'sso'（仅记录，不限制登录）

Revision ID: 20260618_0001
Revises: 20260613_0006, 20260615_0001
Create Date: 2026-06-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260618_0001"
down_revision = ("20260613_0006", "20260615_0001")
branch_labels = None
depends_on = None


_TABLE = "student_user"


def _has_column(column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return any(item["name"] == column for item in inspector.get_columns(_TABLE))


def _has_index(name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return any(ix["name"] == name for ix in inspector.get_indexes(_TABLE))


def upgrade() -> None:
    if _TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return

    if not _has_column("external_username"):
        op.add_column(
            _TABLE,
            sa.Column("external_username", sa.String(length=64), nullable=True),
        )
    if not _has_index("uq_student_user_external_username"):
        op.create_index(
            "uq_student_user_external_username",
            _TABLE,
            ["external_username"],
            unique=True,
        )

    if not _has_column("external_source"):
        op.add_column(
            _TABLE,
            sa.Column("external_source", sa.String(length=32), nullable=True),
        )

    if not _has_column("external_id"):
        op.add_column(
            _TABLE,
            sa.Column("external_id", sa.String(length=64), nullable=True),
        )

    if not _has_column("auth_source"):
        op.add_column(
            _TABLE,
            sa.Column(
                "auth_source",
                sa.String(length=16),
                nullable=False,
                server_default="email",
            ),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return

    if _has_column("auth_source"):
        op.drop_column(_TABLE, "auth_source")
    if _has_column("external_id"):
        op.drop_column(_TABLE, "external_id")
    if _has_column("external_source"):
        op.drop_column(_TABLE, "external_source")
    if _has_index("uq_student_user_external_username"):
        op.drop_index("uq_student_user_external_username", table_name=_TABLE)
    if _has_column("external_username"):
        op.drop_column(_TABLE, "external_username")