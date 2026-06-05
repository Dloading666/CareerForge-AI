"""合并两条迁移分支：mcp_marketplace 与 student_event

lwy 的 20260605_0004(mcp_marketplace) 接在 20260604_0003 上，与主链 20260604_0004
形成分叉，导致出现两个 head（20260605_0004 与 20260605_0010），alembic upgrade head
会报 "Multiple head revisions"。本迁移把两个 head 合并为单头，无 schema 变更。
"""
from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "20260605_0011"
down_revision = ("20260605_0004", "20260605_0010")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
