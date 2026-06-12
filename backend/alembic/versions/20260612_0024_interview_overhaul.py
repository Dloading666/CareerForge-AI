"""interview overhaul: job profile, stage machine, scoring explainability, training plan

Revision ID: 20260612_0024_interview
Revises: 20260613_0002
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0024_interview"
down_revision = "20260613_0002"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return any(item["name"] == column for item in inspector.get_columns(table))


def _has_table(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table in inspector.get_table_names()


def _create_interview_tables_if_missing():
    if not _has_table("interview_sessions"):
        op.create_table(
            "interview_sessions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("student_id", sa.Integer(), nullable=False),
            sa.Column("target_role", sa.String(128), nullable=False),
            sa.Column("job_description", sa.Text(), nullable=True),
            sa.Column("interview_type", sa.String(32), nullable=False, server_default="technical"),
            sa.Column("interview_style", sa.String(32), nullable=False, server_default="strict"),
            sa.Column("difficulty", sa.String(32), nullable=False, server_default="normal"),
            sa.Column("round_limit", sa.Integer(), nullable=False, server_default="8"),
            sa.Column("model_config_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(24), nullable=False, server_default="active"),
            sa.Column("resume_snapshot", sa.Text(), nullable=True),
            sa.Column("company_name", sa.String(128), nullable=True),
            sa.Column("seniority_level", sa.String(32), nullable=True),
            sa.Column("job_skills_json", sa.Text(), nullable=True),
            sa.Column("job_profile_json", sa.Text(), nullable=True),
            sa.Column("current_stage", sa.String(32), nullable=False, server_default="opening"),
            sa.Column("stage_plan_json", sa.Text(), nullable=True),
            sa.Column("coverage_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_interview_sessions_tenant_id", "interview_sessions", ["tenant_id"])
        op.create_index("ix_interview_sessions_student_id", "interview_sessions", ["student_id"])

    if not _has_table("interview_turns"):
        op.create_table(
            "interview_turns",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("session_id", sa.Integer(), nullable=False),
            sa.Column("student_id", sa.Integer(), nullable=False),
            sa.Column("turn_index", sa.Integer(), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=True),
            sa.Column("answer_assessment", sa.Text(), nullable=True),
            sa.Column("score_json", sa.Text(), nullable=True),
            sa.Column("followup_reason", sa.Text(), nullable=True),
            sa.Column("retrieved_chunks_json", sa.Text(), nullable=True),
            sa.Column("knowledge_points_json", sa.Text(), nullable=True),
            sa.Column("stage", sa.String(32), nullable=True),
            sa.Column("question_type", sa.String(64), nullable=True),
            sa.Column("question_reason", sa.Text(), nullable=True),
            sa.Column("capability_tags_json", sa.Text(), nullable=True),
            sa.Column("retrieval_query", sa.Text(), nullable=True),
            sa.Column("retrieval_hit_count", sa.Integer(), nullable=True),
            sa.Column("top_sources_json", sa.Text(), nullable=True),
            sa.Column("score_reasons_json", sa.Text(), nullable=True),
            sa.Column("evidence_quotes_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_interview_turns_session_id", "interview_turns", ["session_id"])
        op.create_index("ix_interview_turns_student_id", "interview_turns", ["student_id"])

    if not _has_table("interview_reports"):
        op.create_table(
            "interview_reports",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("session_id", sa.Integer(), nullable=False),
            sa.Column("student_id", sa.Integer(), nullable=False),
            sa.Column("overall_score", sa.Float(), nullable=False, server_default="0"),
            sa.Column("dimension_scores_json", sa.Text(), nullable=False),
            sa.Column("strengths_json", sa.Text(), nullable=False),
            sa.Column("weaknesses_json", sa.Text(), nullable=False),
            sa.Column("suggestions_json", sa.Text(), nullable=False),
            sa.Column("next_questions_json", sa.Text(), nullable=False),
            sa.Column("comparison_json", sa.Text(), nullable=True),
            sa.Column("report_text", sa.Text(), nullable=False),
            sa.Column("training_plan_json", sa.Text(), nullable=True),
            sa.Column("rewrite_examples_json", sa.Text(), nullable=True),
            sa.Column("next_session_preset_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_interview_reports_session_id", "interview_reports", ["session_id"])
        op.create_index("ix_interview_reports_student_id", "interview_reports", ["student_id"])


def upgrade():
    _create_interview_tables_if_missing()

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
