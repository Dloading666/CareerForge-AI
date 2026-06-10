import unittest
import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.auth.models import StudentUser
from app.auth.service import AuthIdentity
from app.infra.db import Base
from app.student import agent_runtime
from app.student.profile_details_models import (
    StudentEducation,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
from app.student.resume_models import StudentResume


class AgentRuntimeEventTests(unittest.IsolatedAsyncioTestCase):
    def test_query_student_profile_returns_all_profile_sections(self):
        engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(engine)
        session_local = sessionmaker(bind=engine, future=True)

        with session_local() as db:
            db.add(
                StudentUser(
                    id=1,
                    tenant_id=0,
                    account="student@example.com",
                    email="student@example.com",
                    name="测试同学",
                    phone="13800138000",
                    gender="male",
                    age=21,
                    college="测试大学",
                    major="软件工程",
                    grade="2023级",
                    personal_advantages="擅长 Agent 工程",
                    job_search_status="unemployed",
                    expected_position="AI 应用开发",
                    expected_salary="15k",
                    expected_location="重庆",
                )
            )
            db.add(StudentWorkExperience(tenant_id=0, student_id=1, company="测试公司", position="实习生"))
            db.add(StudentProject(tenant_id=0, student_id=1, name="合同审查助手", role="全栈开发"))
            db.add(StudentEducation(tenant_id=0, student_id=1, school="测试大学", major="软件工程", degree="本科"))
            db.add(StudentSkill(tenant_id=0, student_id=1, name="Python", level=4))
            db.commit()

            result = agent_runtime._query_student_profile(
                db,
                AuthIdentity(user_id=1, role="student", tenant_id=0),
            )

        profile = result["profile"]
        self.assertEqual(profile["phone"], "13800138000")
        self.assertEqual(profile["expected_position"], "AI 应用开发")
        self.assertEqual(profile["work_experiences"][0]["company"], "测试公司")
        self.assertEqual(profile["projects"][0]["name"], "合同审查助手")
        self.assertEqual(profile["educations"][0]["degree"], "本科")
        self.assertEqual(profile["skills"][0]["level"], 4)
        self.assertIn("完整个人档案", result["summary"])
        engine.dispose()

    def test_complete_activity_accepts_mysql_naive_datetime(self):
        activity = SimpleNamespace(
            started_at=datetime.utcnow(),
            status="started",
            summary="",
            detail_json="{}",
            completed_at=None,
        )
        db = SimpleNamespace(commit=lambda: None, refresh=lambda _row: None)

        completed = agent_runtime._complete_activity(
            db,
            activity,
            status_value="completed",
            summary="完成",
            detail={},
        )

        self.assertEqual(completed.status, "completed")
        self.assertIn("duration_ms", completed.detail_json)

    async def test_emits_status_and_aggregated_runtime_metrics(self):
        async def fake_stream(*_args, **_kwargs):
            yield "delta", "完成"
            yield "final", {
                "content": "完成",
                "tool_calls": [],
                "finish_reason": "stop",
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 8,
                    "total_tokens": 128,
                },
            }

        model = SimpleNamespace(display_name="测试模型", model_identifier="test-model")
        session = SimpleNamespace(id=7)
        assistant_message = SimpleNamespace(id=11)
        user_message = SimpleNamespace(id=10, content="测试")

        with patch.object(agent_runtime, "_stream_llm_turn", fake_stream):
            events = [
                event
                async for event in agent_runtime.run_agent_loop(
                    None,
                    SimpleNamespace(user_id=1, tenant_id=0),
                    session,
                    user_message,
                    assistant_message,
                    model,
                    [{"role": "user", "content": "测试"}],
                    [],
                    {},
                    [],
                    "medium",
                    2,
                )
            ]

        self.assertEqual(events[0][0], "runtime.status")
        self.assertEqual(events[0][1]["label"], "正在理解你的需求…")
        # Phase 1 在首个 delta 前插入了 runtime.status(phase:"writing") 事件
        self.assertEqual(events[1][0], "runtime.status")
        self.assertEqual(events[1][1].get("phase"), "writing")
        self.assertEqual(events[2], ("message.delta", {"message_id": 11, "delta": "完成"}))
        self.assertEqual(events[-1][0], "runtime.completed")
        self.assertEqual(events[-1][1]["prompt_tokens"], 120)
        self.assertEqual(events[-1][1]["completion_tokens"], 8)
        self.assertEqual(events[-1][1]["total_tokens"], 128)
        self.assertEqual(events[-1][1]["model_name"], "测试模型")

    def test_resume_tools_have_user_facing_labels(self):
        tools = {tool.name: tool for tool in agent_runtime.BUILTIN_TOOLS}

        self.assertEqual(
            agent_runtime._tool_start_label(tools["read_resume"], {}),
            "正在查看简历…",
        )
        self.assertEqual(
            agent_runtime._tool_start_label(tools["update_resume_data"], {}),
            "正在更改简历…",
        )

    def test_builtin_resume_tailor_skill_is_always_available_and_trusted(self):
        db = SimpleNamespace()

        with patch.object(agent_runtime, "list_skills", return_value=[]):
            tools = {
                tool.name: tool
                for tool in agent_runtime.assemble_active_tools(
                    db,
                    AuthIdentity(user_id=1, role="student", tenant_id=0),
                )
            }

        skill = tools["skill__evidence_backed_resume_tailor"]
        self.assertTrue(skill.metadata["trusted_builtin"])
        self.assertIn("证据匹配矩阵", skill.metadata["content"])
        self.assertIn("不得伪造指标", skill.metadata["content"])
        self.assertEqual(agent_runtime._permission_decision("strict", skill.name, skill)[0], "allow")

    def test_resume_write_requires_builtin_tailor_skill_first(self):
        blocked = agent_runtime._resume_skill_prerequisite_failure("generate_resume_data", set())
        allowed = agent_runtime._resume_skill_prerequisite_failure(
            "generate_resume_data",
            {"skill__evidence_backed_resume_tailor"},
        )

        self.assertEqual(blocked["error_code"], "resume_tailor_skill_required")
        self.assertIsNone(allowed)

    def test_generate_resume_validates_model_text_by_fact_whitelist(self):
        """新契约：generate 保留模型文本，但通过事实白名单校验拦截伪造内容。
        - 模型文本中的合法项目（在 profile 中有据）应被保留。
        - 模型编造的公司/项目（不在白名单中）应被拦截，返回 failed。
        - profile 的 name/email/phone 始终被强制覆盖为真实值。
        """
        engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(engine)
        session_local = sessionmaker(bind=engine, future=True)
        identity = AuthIdentity(user_id=1, role="student", tenant_id=0)

        with session_local() as db:
            db.add(
                StudentUser(
                    id=1,
                    tenant_id=0,
                    account="student@example.com",
                    email="student@example.com",
                    name="测试同学",
                    phone="13800138000",
                    college="测试大学",
                    major="软件工程",
                    expected_position="AI 应用开发",
                    expected_location="重庆",
                    personal_advantages="认真负责",
                )
            )
            db.add(
                StudentProject(
                    tenant_id=0,
                    student_id=1,
                    name="真实项目",
                    role="开发者",
                    description="实现合同文本解析",
                )
            )
            db.add(
                StudentSkill(
                    tenant_id=0,
                    student_id=1,
                    name="Python",
                    level="熟练",
                )
            )
            db.add(
                StudentSkill(
                    tenant_id=0,
                    student_id=1,
                    name="MySQL",
                    level="熟练",
                )
            )
            db.commit()

            # ── 场景 1：使用 profile 中存在的合法事实 → 应通过 ──
            result_ok = agent_runtime._generate_resume_data_tool(
                db,
                identity,
                {
                    "title": "测试简历",
                    "basic": {"name": "伪造姓名", "target_position": "后端工程师"},
                    "projects": [{"name": "真实项目", "role": "开发者", "description": "主导合同文本解析系统开发"}],
                    "skills": "Python, MySQL",
                },
            )
            self.assertEqual(result_ok["status"], "completed")
            self.assertTrue(result_ok["fact_validation"]["passed"])
            row = db.get(StudentResume, result_ok["resume_id"])
            document = json.loads(row.data_json)
            # name/email/phone 从 profile 强制覆盖
            self.assertEqual(document["basic"]["name"], "测试同学")
            self.assertEqual(document["basic"]["email"], "student@example.com")
            self.assertEqual(document["basic"]["phone"], "13800138000")
            # 模型文本被保留（项目名在 profile 有据）
            self.assertEqual(document["projects"][0]["name"], "真实项目")

            # ── 场景 2：编造不存在的公司和项目 → 应被拦截 ──
            result_bad = agent_runtime._generate_resume_data_tool(
                db,
                identity,
                {
                    "title": "伪造简历",
                    "basic": {"name": "测试同学"},
                    "projects": [{"name": "虚构项目", "role": "负责人", "description": "提升 90%"}],
                    "experience": [{"company": "虚构公司", "position": "架构师"}],
                },
            )
            self.assertEqual(result_bad["status"], "failed")
            self.assertFalse(result_bad["fact_validation"]["passed"])
            # 不应产生新简历行
            self.assertNotIn("resume_id", result_bad)

        engine.dispose()

    def test_optimize_resume_rejects_untraceable_project(self):
        engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(engine)
        session_local = sessionmaker(bind=engine, future=True)
        identity = AuthIdentity(user_id=1, role="student", tenant_id=0)

        with session_local() as db:
            db.add(
                StudentUser(
                    id=1,
                    tenant_id=0,
                    account="student@example.com",
                    email="student@example.com",
                    name="测试同学",
                )
            )
            db.commit()
            result = agent_runtime._optimize_resume_data_tool(
                db,
                identity,
                {
                    "title": "优化简历",
                    "basic": {"name": "测试同学"},
                    "projects": [{"name": "模型编造项目", "role": "负责人"}],
                },
                [],
            )

            self.assertEqual(result["status"], "failed")
            self.assertFalse(result["fact_validation"]["passed"])
            self.assertIn("模型编造项目", result["summary"])
            self.assertEqual(db.scalar(select(func.count(StudentResume.id))), 0)
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
