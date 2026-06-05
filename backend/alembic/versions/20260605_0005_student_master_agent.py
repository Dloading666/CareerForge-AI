"""学生端主智能体会话和可扩展子智能体 provider"""

from alembic import op
import sqlalchemy as sa

revision = "20260605_0005"
down_revision = "20260605_0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "master_route_rule",
        sa.Column("target_provider", sa.String(32), nullable=False, server_default="builtin"),
    )
    op.add_column("master_route_rule", sa.Column("provider_config_json", sa.Text(), nullable=True))

    op.create_table(
        "student_agent_session",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(128), nullable=False, server_default="新对话"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_agent_session_student_id", "student_agent_session", ["student_id"])
    op.create_index("ix_student_agent_session_tenant_id", "student_agent_session", ["tenant_id"])

    op.create_table(
        "student_agent_message",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_agent_message_session_id", "student_agent_message", ["session_id"])

    op.create_table(
        "student_agent_activity",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("detail_json", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_student_agent_activity_session_id", "student_agent_activity", ["session_id"])
    op.create_index("ix_student_agent_activity_message_id", "student_agent_activity", ["message_id"])


def downgrade():
    op.drop_index("ix_student_agent_activity_message_id", table_name="student_agent_activity")
    op.drop_index("ix_student_agent_activity_session_id", table_name="student_agent_activity")
    op.drop_table("student_agent_activity")
    op.drop_index("ix_student_agent_message_session_id", table_name="student_agent_message")
    op.drop_table("student_agent_message")
    op.drop_index("ix_student_agent_session_tenant_id", table_name="student_agent_session")
    op.drop_index("ix_student_agent_session_student_id", table_name="student_agent_session")
    op.drop_table("student_agent_session")
    op.drop_column("master_route_rule", "provider_config_json")
    op.drop_column("master_route_rule", "target_provider")
