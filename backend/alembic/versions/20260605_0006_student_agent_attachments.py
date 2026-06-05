"""学生端主智能体附件上传"""

from alembic import op
import sqlalchemy as sa

revision = "20260605_0006"
down_revision = "20260605_0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "student_agent_attachment",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=True),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("stored_path", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("file_ext", sa.String(32), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="ready"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_agent_attachment_tenant_id", "student_agent_attachment", ["tenant_id"])
    op.create_index("ix_student_agent_attachment_student_id", "student_agent_attachment", ["student_id"])
    op.create_index("ix_student_agent_attachment_session_id", "student_agent_attachment", ["session_id"])
    op.create_index("ix_student_agent_attachment_message_id", "student_agent_attachment", ["message_id"])


def downgrade():
    op.drop_index("ix_student_agent_attachment_message_id", table_name="student_agent_attachment")
    op.drop_index("ix_student_agent_attachment_session_id", table_name="student_agent_attachment")
    op.drop_index("ix_student_agent_attachment_student_id", table_name="student_agent_attachment")
    op.drop_index("ix_student_agent_attachment_tenant_id", table_name="student_agent_attachment")
    op.drop_table("student_agent_attachment")
