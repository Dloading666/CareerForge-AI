"""个人中心扩展：personal_advantages / job_search_status / expected_* 与五张子表

配合 dev-jyf 的个人中心强化（个人优势、求职状态、求职期望、工作/实习、项目、
荣誉、证书、技能）。幂等：列与表已存在则跳过。
"""
from alembic import op
import sqlalchemy as sa

revision = "20260610_0015"
down_revision = "20260609_0014"
branch_labels = None
depends_on = None


NEW_USER_COLUMNS = [
    ("personal_advantages", sa.Text()),
    ("job_search_status", sa.String(32)),
    ("expected_position", sa.String(128)),
    ("expected_salary", sa.String(64)),
    ("expected_location", sa.String(128)),
]

COMMON_SUFFIX = [
    sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
]


def _table_columns(table: str):
    base = [
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("student_id", sa.Integer(), nullable=False),
    ]
    if table == "student_work_experience":
        body = [
            sa.Column("company", sa.String(128), nullable=True),
            sa.Column("position", sa.String(128), nullable=True),
            sa.Column("start_date", sa.String(32), nullable=True),
            sa.Column("end_date", sa.String(32), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
        ]
    elif table == "student_project":
        body = [
            sa.Column("name", sa.String(128), nullable=True),
            sa.Column("role", sa.String(128), nullable=True),
            sa.Column("start_date", sa.String(32), nullable=True),
            sa.Column("end_date", sa.String(32), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
        ]
    elif table == "student_honor":
        body = [
            sa.Column("title", sa.String(160), nullable=True),
            sa.Column("level", sa.String(64), nullable=True),
            sa.Column("award_date", sa.String(32), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
        ]
    elif table == "student_certification":
        body = [
            sa.Column("name", sa.String(160), nullable=True),
            sa.Column("issuer", sa.String(160), nullable=True),
            sa.Column("issue_date", sa.String(32), nullable=True),
            sa.Column("expire_date", sa.String(32), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
        ]
    elif table == "student_education":
        body = [
            sa.Column("school", sa.String(160), nullable=True),
            sa.Column("major", sa.String(160), nullable=True),
            sa.Column("degree", sa.String(64), nullable=True),
            sa.Column("duration", sa.String(64), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
        ]
    elif table == "student_skill":
        body = [
            sa.Column("name", sa.String(64), nullable=True),
            sa.Column("level", sa.Integer(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
        ]
    else:
        body = []
    return base + body + COMMON_SUFFIX


SUB_TABLES = [
    "student_work_experience",
    "student_project",
    "student_education",
    "student_honor",
    "student_certification",
    "student_skill",
]


def _inspector():
    return sa.inspect(op.get_bind())


def _has_column(table: str, column: str) -> bool:
    return any(col["name"] == column for col in _inspector().get_columns(table))


def _has_table(table: str) -> bool:
    return _inspector().has_table(table)


def upgrade():
    for name, col_type in NEW_USER_COLUMNS:
        if not _has_column("student_user", name):
            op.add_column("student_user", sa.Column(name, col_type, nullable=True))

    for table in SUB_TABLES:
        if _has_table(table):
            continue
        op.create_table(table, *_table_columns(table))
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.create_index(f"ix_{table}_student_id", table, ["student_id"])


def downgrade():
    for name, _ in reversed(NEW_USER_COLUMNS):
        if _has_column("student_user", name):
            op.drop_column("student_user", name)
    for table in reversed(SUB_TABLES):
        if _has_table(table):
            op.drop_table(table)