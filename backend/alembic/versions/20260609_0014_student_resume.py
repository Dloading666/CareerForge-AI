"""student resume table"""

from alembic import op
import sqlalchemy as sa

revision = "20260609_0014"
down_revision = "20260608_0013"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "student_resume",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=128), nullable=False, server_default="新建简历"),
        sa.Column("template_id", sa.String(length=64), nullable=False, server_default="classic"),
        sa.Column("visibility", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("data_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_resume_student_id", "student_resume", ["student_id"])
    op.create_index("ix_student_resume_tenant_id", "student_resume", ["tenant_id"])


def downgrade():
    op.drop_index("ix_student_resume_tenant_id", table_name="student_resume")
    op.drop_index("ix_student_resume_student_id", table_name="student_resume")
    op.drop_table("student_resume")
