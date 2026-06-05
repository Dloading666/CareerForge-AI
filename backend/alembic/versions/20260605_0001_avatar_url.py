"""add avatar_url to admin_user and student_user"""
from alembic import op
import sqlalchemy as sa

revision = "20260605_0001"
down_revision = "20260604_0004"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("admin_user", sa.Column("avatar_url", sa.String(512), nullable=True))
    op.add_column("student_user", sa.Column("avatar_url", sa.String(512), nullable=True))

def downgrade():
    op.drop_column("admin_user", "avatar_url")
    op.drop_column("student_user", "avatar_url")
