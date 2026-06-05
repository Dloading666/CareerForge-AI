"""个人中心日程：创建 student_event 表

event_router.py 用裸 SQL 读写 student_event，但既无模型也无迁移，日程功能一调用就会
报 Table 'student_event' doesn't exist。这里补上建表迁移。幂等：表已存在则跳过。
"""
from alembic import op
import sqlalchemy as sa

revision = "20260605_0010"
down_revision = "20260605_0009"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return inspector.has_table(table)


def upgrade():
    if _has_table("student_event"):
        return
    op.create_table(
        "student_event",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("event_time", sa.Time(), nullable=True),
        sa.Column("color", sa.String(16), nullable=False, server_default="#165dff"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_event_student_id", "student_event", ["student_id"])
    op.create_index("ix_student_event_event_date", "student_event", ["event_date"])


def downgrade():
    if not _has_table("student_event"):
        return
    op.drop_index("ix_student_event_event_date", table_name="student_event")
    op.drop_index("ix_student_event_student_id", table_name="student_event")
    op.drop_table("student_event")
