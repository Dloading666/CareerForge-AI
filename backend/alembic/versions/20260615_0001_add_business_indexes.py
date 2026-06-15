"""Add missing business indexes for hot read endpoints.

Targets:
  - agent           : list endpoint filters + sorts on is_deleted/enabled/published/created_at
  - model_config    : student-facing model list filters on tenant/capability/status
  - user_feedback   : admin list filters on status and sorts by created_at
  - student_event   : calendar range queries on (student_id, event_date)
  - student_resume  : list endpoint filters on (tenant_id, student_id, updated_at)

user_feedback is created via raw SQL in main.py lifespan rather than via Alembic,
so we guard each op with a table-existence check to keep this migration idempotent.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260615_0001"
down_revision = ("20260612_0026", "20260613_0003")
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _existing_indexes(name: str) -> set[str]:
    if not _has_table(name):
        return set()
    return {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes(name)}


def _create_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_table(table_name):
        return
    if index_name in _existing_indexes(table_name):
        return
    op.create_index(index_name, table_name, columns)


def _drop_if_exists(index_name: str, table_name: str) -> None:
    if not _has_table(table_name):
        return
    if index_name not in _existing_indexes(table_name):
        return
    op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    _create_if_missing("ix_agent_published", "agent", ["is_deleted", "is_enabled", "is_published", "created_at"])
    _create_if_missing("ix_model_config_active", "model_config", ["tenant_id", "is_deleted", "open_to_student", "status", "capability"])
    _create_if_missing("ix_user_feedback_status", "user_feedback", ["status"])
    _create_if_missing("ix_user_feedback_created", "user_feedback", ["created_at"])
    _create_if_missing("ix_student_event_student_date", "student_event", ["student_id", "event_date"])
    _create_if_missing("ix_student_resume_tenant_student_updated", "student_resume", ["tenant_id", "student_id", "updated_at"])


def downgrade() -> None:
    _drop_if_exists("ix_agent_published", "agent")
    _drop_if_exists("ix_model_config_active", "model_config")
    _drop_if_exists("ix_user_feedback_status", "user_feedback")
    _drop_if_exists("ix_user_feedback_created", "user_feedback")
    _drop_if_exists("ix_student_event_student_date", "student_event")
    _drop_if_exists("ix_student_resume_tenant_student_updated", "student_resume")