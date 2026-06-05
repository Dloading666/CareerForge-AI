"""个人中心：student_user 新增 banner_url / signature / gender / age

配合 dev-jyf 的个人中心功能（封面、签名、性别、年龄）。幂等：列已存在则跳过，
新老数据库都安全。
"""
from alembic import op
import sqlalchemy as sa

revision = "20260605_0009"
down_revision = "20260605_0008"
branch_labels = None
depends_on = None


NEW_COLUMNS = [
    ("banner_url", sa.String(512)),
    ("signature", sa.String(256)),
    ("gender", sa.String(16)),
    ("age", sa.Integer()),
]


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade():
    for name, col_type in NEW_COLUMNS:
        if not _has_column("student_user", name):
            op.add_column("student_user", sa.Column(name, col_type, nullable=True))


def downgrade():
    for name, _ in reversed(NEW_COLUMNS):
        if _has_column("student_user", name):
            op.drop_column("student_user", name)
