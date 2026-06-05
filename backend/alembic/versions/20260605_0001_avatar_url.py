"""add avatar_url to admin_user and student_user (idempotent)

student_user.avatar_url 已在 init 迁移中创建，这里只对「尚不存在该列」的表补加，
避免全新数据库从零迁移时报 Duplicate column name 'avatar_url'。
"""
from alembic import op
import sqlalchemy as sa

revision = "20260605_0001"
down_revision = "20260604_0004"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade():
    for table in ("admin_user", "student_user"):
        if not _has_column(table, "avatar_url"):
            op.add_column(table, sa.Column("avatar_url", sa.String(512), nullable=True))


def downgrade():
    for table in ("admin_user", "student_user"):
        if _has_column(table, "avatar_url"):
            op.drop_column(table, "avatar_url")
