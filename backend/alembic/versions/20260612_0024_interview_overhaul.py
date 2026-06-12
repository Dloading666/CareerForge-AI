"""interview overhaul: job profile, stage machine, scoring explainability, training plan

Revision ID: 20260612_0022
Revises: 20260612_0021
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0022"
down_revision = "20260612_0021"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade():
    # ── interview_sessions: 岗位画像 + 阶段状态机 ──
    if not _has_column("interview_sessions", "company_name"):
        op.add_column("interview_sessions", sa.Column("company_name", sa.String(128), nullable=True))
    if not _has_column("interview_sessions", "seniority_level"):
        op.add_column("interview_sessions", sa.Column("seniority_level", sa.String(32), nullable=True))
    if not _has_column("interview_sessions", "job_skills_json"):
        op.add_column("interview_sessions", sa.Column("job_skills_json", sa.Text(), nullable=True))
    if not _has_column("interview_sessions", "job_profile_json"):
        op.add_column("interview_sessions", sa.Column("job_profile_json", sa.Text(), nullable=True))
    if not _has_column("interview_sessions", "current_stage"):
        op.add_column("interview_sessions", sa.Column("current_stage", sa.String(32), nullable=False, server_default="opening"))
    if not _has_column("interview_sessions", "stage_plan_json"):
        op.add_column("interview_sessions", sa.Column("stage_plan_json", sa.Text(), nullable=True))
    if not _has_column("interview_sessions", "coverage_json"):
        op.add_column("interview_sessions", sa.Column("coverage_json", sa.Text(), nullable=True))

    # ── interview_turns: 阶段 + 检索解释性 + 评分可解释性 ──
    if not _has_column("interview_turns", "stage"):
        op.add_column("interview_turns", sa.Column("stage", sa.String(32), nullable=True))
    if not _has_column("interview_turns", "question_type"):
        op.add_column("interview_turns", sa.Column("question_type", sa.String(64), nullable=True))
    if not _has_column("interview_turns", "question_reason"):
        op.add_column("interview_turns", sa.Column("question_reason", sa.Text(), nullable=True))
    if not _has_column("interview_turns", "capability_tags_json"):
        op.add_column("interview_turns", sa.Column("capability_tags_json", sa.Text(), nullable=True))
    if not _has_column("interview_turns", "retrieval_query"):
        op.add_column("interview_turns", sa.Column("retrieval_query", sa.Text(), nullable=True))
    if not _has_column("interview_turns", "retrieval_hit_count"):
        op.add_column("interview_turns", sa.Column("retrieval_hit_count", sa.Integer(), nullable=True))
    if not _has_column("interview_turns", "top_sources_json"):
        op.add_column("interview_turns", sa.Column("top_sources_json", sa.Text(), nullable=True))
    if not _has_column("interview_turns", "score_reasons_json"):
        op.add_column("interview_turns", sa.Column("score_reasons_json", sa.Text(), nullable=True))
    if not _has_column("interview_turns", "evidence_quotes_json"):
        op.add_column("interview_turns", sa.Column("evidence_quotes_json", sa.Text(), nullable=True))

    # ── interview_reports: 训练闭环 ──
    if not _has_column("interview_reports", "training_plan_json"):
        op.add_column("interview_reports", sa.Column("training_plan_json", sa.Text(), nullable=True))
    if not _has_column("interview_reports", "rewrite_examples_json"):
        op.add_column("interview_reports", sa.Column("rewrite_examples_json", sa.Text(), nullable=True))
    if not _has_column("interview_reports", "next_session_preset_json"):
        op.add_column("interview_reports", sa.Column("next_session_preset_json", sa.Text(), nullable=True))


def downgrade():
    for col in ["next_session_preset_json", "rewrite_examples_json", "training_plan_json"]:
        if _has_column("interview_reports", col):
            op.drop_column("interview_reports", col)
    for col in ["evidence_quotes_json", "score_reasons_json", "top_sources_json",
                "retrieval_hit_count", "retrieval_query", "capability_tags_json",
                "question_reason", "question_type", "stage"]:
        if _has_column("interview_turns", col):
            op.drop_column("interview_turns", col)
    for col in ["coverage_json", "stage_plan_json", "current_stage",
                "job_profile_json", "job_skills_json", "seniority_level", "company_name"]:
        if _has_column("interview_sessions", col):
            op.drop_column("interview_sessions", col)
