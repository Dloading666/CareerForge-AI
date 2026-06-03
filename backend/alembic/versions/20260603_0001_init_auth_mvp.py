"""init auth mvp"""

from alembic import op
import sqlalchemy as sa


revision = "20260603_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "admin_user",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_admin_user_email", "admin_user", ["email"], unique=True)
    op.create_table(
        "student_user",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("account", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=64), nullable=True),
        sa.Column("college", sa.String(length=128), nullable=True),
        sa.Column("major", sa.String(length=128), nullable=True),
        sa.Column("grade", sa.String(length=32), nullable=True),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_user_account", "student_user", ["account"], unique=True)
    op.create_index("ix_student_user_email", "student_user", ["email"], unique=True)
    op.create_table(
        "admin_refresh_token",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("admin_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_admin_refresh_token_admin_id", "admin_refresh_token", ["admin_id"])
    op.create_index("ix_admin_refresh_token_token_hash", "admin_refresh_token", ["token_hash"])
    op.create_table(
        "student_refresh_token",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_refresh_token_student_id", "student_refresh_token", ["student_id"])
    op.create_index("ix_student_refresh_token_token_hash", "student_refresh_token", ["token_hash"])
    op.create_table(
        "admin_login_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("admin_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("ua", sa.String(length=256), nullable=True),
        sa.Column("result", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_admin_login_log_admin_id", "admin_login_log", ["admin_id"])
    op.create_index("ix_admin_login_log_email", "admin_login_log", ["email"])
    op.create_table(
        "student_login_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Integer(), nullable=True),
        sa.Column("account", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("ua", sa.String(length=256), nullable=True),
        sa.Column("result", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_login_log_student_id", "student_login_log", ["student_id"])
    op.create_index("ix_student_login_log_email", "student_login_log", ["email"])
    op.create_table(
        "student_email_code",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("scene", sa.String(length=32), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("send_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("email", "scene", name="uq_student_email_code_email_scene"),
    )


def downgrade():
    op.drop_table("student_email_code")
    op.drop_index("ix_student_login_log_email", table_name="student_login_log")
    op.drop_index("ix_student_login_log_student_id", table_name="student_login_log")
    op.drop_table("student_login_log")
    op.drop_index("ix_admin_login_log_email", table_name="admin_login_log")
    op.drop_index("ix_admin_login_log_admin_id", table_name="admin_login_log")
    op.drop_table("admin_login_log")
    op.drop_index("ix_student_refresh_token_token_hash", table_name="student_refresh_token")
    op.drop_index("ix_student_refresh_token_student_id", table_name="student_refresh_token")
    op.drop_table("student_refresh_token")
    op.drop_index("ix_admin_refresh_token_token_hash", table_name="admin_refresh_token")
    op.drop_index("ix_admin_refresh_token_admin_id", table_name="admin_refresh_token")
    op.drop_table("admin_refresh_token")
    op.drop_index("ix_student_user_email", table_name="student_user")
    op.drop_index("ix_student_user_account", table_name="student_user")
    op.drop_table("student_user")
    op.drop_index("ix_admin_user_email", table_name="admin_user")
    op.drop_table("admin_user")
