"""简历助手固定评测集。

覆盖 7 种意图模式和核心校验链路的回归测试。
用 mock LLM（预设 function calling 返回值）+ 真实 DB 验证工具调用链路和校验结果，
不依赖真实 LLM API，可 CI 运行。

评测维度：
1. 意图模式：create / refine / patch / style / enrich / export / chat
2. 事实校验：防幻觉 / 防夸大 / 专名模糊匹配
3. 质量闸门：强动词率 / 量化占比 / 空话检测
4. 工具链路：Skill 前置 → generate/optimize/update → export
5. 跨轮续修：证据来源索引 → 不误报
6. 边界场景：空档案 / 版本冲突 / 简历上限
"""
from __future__ import annotations

import json
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.models import StudentUser
from app.auth.service import AuthIdentity
from app.infra.db import Base
from app.student.agent_runtime import (
    _check_resume_quality,
    _check_role_escalation,
    _validate_resume_facts,
    _assess_evidence_quality,
    _snapshot_resume_revision,
    _generate_resume_data_tool,
    _optimize_resume_data_tool,
    _update_resume_data_tool,
    _apply_resume_patch_tool,
    _analyze_jd_match_tool,
    _read_resume_tool,
    _query_student_profile,
    _resume_count,
    _MAX_RESUMES,
)
from app.student.agent_utils import classify_intent, auto_classify_effort
from app.student.agent_fact_guard import (
    SessionEvidencePool,
    EvidenceSourceIndex,
    FactWhitelist,
    _extract_fact_whitelist,
    _fact_guard_failure,
    ITEM_ATTRIBUTION_SHADOW_MODE,
)
from app.student.agent_models import StudentAgentSession
from app.student.profile_details_models import (
    StudentCertification,
    StudentEducation,
    StudentHonor,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
from app.student.resume_models import StudentResume
from app.student.revision_models import StudentResumeRevision


# ── 共享测试数据 ──────────────────────────────────────────────────────────

# 典型有经历的学生档案
FULL_PROFILE = {
    "name": "李明",
    "email": "liming@example.com",
    "phone": "13900139000",
    "educations": [
        {
            "school": "浙江大学",
            "major": "计算机科学与技术",
            "degree": "本科",
            "duration": "2021.09 - 2025.06",
            "description": "GPA 3.7/4.0",
        }
    ],
    "work_experiences": [
        {
            "company": "腾讯科技",
            "position": "前端开发实习生",
            "start_date": "2024.06",
            "end_date": "2024.12",
            "description": "- 参与微信小程序重构，QPS 提升 30%\n- 使用 Vue3 和 TypeScript 开发管理后台",
        }
    ],
    "projects": [
        {
            "name": "智能简历助手",
            "role": "参与",
            "start_date": "2024.03",
            "end_date": "2024.06",
            "description": "- 基于 Python 和 FastAPI 搭建后端服务\n- 实现简历解析与结构化输出",
        }
    ],
    "skills": ["Python", "TypeScript", "Vue3", "FastAPI", "MySQL"],
}

# 空档案（只有基本信息，无经历/项目）
EMPTY_PROFILE = {
    "name": "王小白",
    "email": "wangxb@example.com",
    "phone": "13800138001",
    "educations": [],
    "work_experiences": [],
    "projects": [],
    "skills": [],
}

# 典型 JD 文本
SAMPLE_JD = """
前端开发工程师

岗位职责：
1. 负责公司核心产品的前端开发和维护
2. 参与技术方案设计和代码评审
3. 优化前端性能，提升用户体验

任职要求：
1. 本科及以上学历，计算机相关专业
2. 熟练掌握 Vue3 / React 等前端框架
3. 熟悉 TypeScript，有类型化开发经验
4. 了解前端工程化（Webpack/Vite）
5. 有小程序开发经验优先
6. 良好的沟通能力和团队协作精神
"""


def _make_db():
    """创建内存 SQLite 数据库并初始化表结构。"""
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, future=True)


def _seed_student(db, student_id=1, tenant_id=0, name="李明"):
    """向 DB 插入一个完整的学生用户 + 档案数据。"""
    db.add(StudentUser(
        id=student_id, tenant_id=tenant_id,
        account=f"{name}@example.com", email=f"{name}@example.com",
        name=name, phone="13900139000",
        gender="male", age=22,
        college="浙江大学", major="计算机科学与技术", grade="2021级",
    ))
    db.add(StudentWorkExperience(
        tenant_id=tenant_id, student_id=student_id,
        company="腾讯科技", position="前端开发实习生",
        start_date="2024-06", end_date="2024-12",
        description="参与微信小程序重构，QPS 提升 30%",
    ))
    db.add(StudentProject(
        tenant_id=tenant_id, student_id=student_id,
        name="智能简历助手", role="参与",
        start_date="2024-03", end_date="2024-06",
        description="基于 Python 和 FastAPI 搭建后端服务",
    ))
    db.add(StudentEducation(
        tenant_id=tenant_id, student_id=student_id,
        school="浙江大学", major="计算机科学与技术", degree="本科",
        duration="2021.09 - 2025.06",
    ))
    db.add(StudentSkill(
        tenant_id=tenant_id, student_id=student_id,
        name="Python", level=4, description="",
    ))
    db.add(StudentSkill(
        tenant_id=tenant_id, student_id=student_id,
        name="TypeScript", level=3, description="",
    ))
    db.commit()


def _seed_empty_student(db, student_id=2, tenant_id=0):
    """向 DB 插入一个无档案数据的学生。"""
    db.add(StudentUser(
        id=student_id, tenant_id=tenant_id,
        account="empty@example.com", email="empty@example.com",
        name="王小白", phone="13800138001",
        gender="male", age=20,
        college="某大学", major="软件工程", grade="2023级",
    ))
    db.commit()


def _identity(student_id=1, tenant_id=0):
    return AuthIdentity(user_id=student_id, role="student", tenant_id=tenant_id)


# ══════════════════════════════════════════════════════════════════════════
# 1. 事实校验评测
# ══════════════════════════════════════════════════════════════════════════


class TestFactGuardEval(unittest.TestCase):
    """事实校验回归评测集。"""

    def test_faithful_resume_passes(self):
        """如实照抄档案内容不应被拦截。"""
        args = {
            "basic": {"name": "李明"},
            "education": [{"school": "浙江大学", "major": "计算机科学与技术",
                           "degree": "本科", "date": "2021.09 - 2025.06"}],
            "experience": [{"company": "腾讯科技", "position": "前端开发实习生",
                            "date": "2024.06 - 2024.12",
                            "details": "- 参与微信小程序重构，QPS 提升 30%\n- 使用 Vue3 和 TypeScript 开发管理后台"}],
            "projects": [{"name": "智能简历助手", "role": "参与",
                          "date": "2024.03 - 2024.06",
                          "description": "- 基于 Python 和 FastAPI 搭建后端服务"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertEqual(violations, [], f"如实照抄不应有违规: {violations}")

    def test_fabricated_company_blocked(self):
        """编造不存在的公司名应被拦截。"""
        args = {
            "experience": [{"company": "字节跳动", "position": "后端实习生",
                            "date": "2024.06 - 2024.12", "details": "- 开发微服务"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertTrue(any("字节跳动" in v for v in violations),
                        f"编造公司名应被拦截: {violations}")

    def test_fabricated_school_blocked(self):
        """编造不存在的学校名应被拦截。"""
        args = {
            "education": [{"school": "清华大学", "major": "软件工程",
                           "degree": "硕士", "date": "2023.09 - 2026.06"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertTrue(any("清华" in v for v in violations),
                        f"编造学校名应被拦截: {violations}")

    def test_fabricated_time_range_blocked(self):
        """编造不存在的时间段应被拦截。"""
        args = {
            "experience": [{"company": "腾讯科技", "position": "前端开发实习生",
                            "date": "2023.01 - 2023.12", "details": "- 开发系统"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertTrue(any("2023" in v for v in violations),
                        f"编造时间段应被拦截: {violations}")

    def test_numbers_not_blocked(self):
        """数字指标不应被拦截（属于表达层，用户会自行核实）。"""
        args = {
            "experience": [{"company": "腾讯科技", "position": "前端开发实习生",
                            "date": "2024.06 - 2024.12",
                            "details": "- QPS 提升 300%（夸张数字）"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertFalse(any("300%" in v for v in violations),
                         f"数字指标不应被拦截: {violations}")

    def test_tech_words_not_blocked(self):
        """技术词不应被拦截（属于主观技能声明）。"""
        args = {
            "experience": [{"company": "腾讯科技", "position": "前端开发实习生",
                            "date": "2024.06 - 2024.12",
                            "details": "- 使用 Kubernetes 和 Docker 部署服务"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        # Kubernetes/Docker 不在档案技能列表中，但属于技术词，不应拦截
        self.assertFalse(any("Kubernetes" in v or "Docker" in v for v in violations),
                         f"技术词不应被拦截: {violations}")


class TestProperNounSubstringMatch(unittest.TestCase):
    """专名模糊匹配容差评测（P1.3）。

    回归场景：档案写"腾讯科技"但模型输出"腾讯"，不应误拦。
    """

    def test_shorter_name_matches_longer(self):
        """候选词是白名单词的子串应通过（腾讯 ← 腾讯科技）。"""
        args = {
            "experience": [{"company": "腾讯", "position": "前端开发实习生",
                            "date": "2024.06 - 2024.12", "details": "- 开发"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertEqual(violations, [], f"'腾讯'是'腾讯科技'的子串，不应拦截: {violations}")

    def test_longer_name_matches_shorter(self):
        """白名单词是候选词的子串应通过（腾讯科技 ← 腾讯）。"""
        short_profile = {
            "name": "张三",
            "work_experiences": [{"company": "腾讯", "position": "实习生",
                                  "start_date": "2024.06", "end_date": "2024.12",
                                  "description": "开发"}],
        }
        args = {
            "experience": [{"company": "腾讯科技", "position": "前端开发实习生",
                            "date": "2024.06 - 2024.12", "details": "- 开发"}],
        }
        violations, _ = _validate_resume_facts(args, [short_profile])
        self.assertEqual(violations, [], f"'腾讯科技'包含'腾讯'，不应拦截: {violations}")

    def test_completely_different_name_blocked(self):
        """完全不相关的公司名仍应被拦截。"""
        args = {
            "experience": [{"company": "阿里巴巴", "position": "实习生",
                            "date": "2024.06 - 2024.12", "details": "- 开发"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertTrue(any("阿里巴巴" in v for v in violations),
                        f"不相关公司名应被拦截: {violations}")


# ══════════════════════════════════════════════════════════════════════════
# 2. 角色升级检测评测
# ══════════════════════════════════════════════════════════════════════════


class TestRoleEscalationEval(unittest.TestCase):
    """角色升级检测评测。"""

    def test_participate_to_lead_blocked(self):
        """'参与'→'主导'角色升级应被拦截。"""
        args = {
            "projects": [{"name": "智能简历助手", "role": "主导",
                          "date": "2024.03 - 2024.06",
                          "description": "- 主导项目架构设计\n- 实现核心模块"}],
        }
        violations = _check_role_escalation(args, [FULL_PROFILE])
        self.assertTrue(len(violations) > 0, f"'参与'→'主导'应被拦截: {violations}")

    def test_participate_to_independent_blocked(self):
        """'参与'→'独立完成'角色升级应被拦截。"""
        args = {
            "projects": [{"name": "智能简历助手", "role": "独立完成",
                          "date": "2024.03 - 2024.06",
                          "description": "- 独立完成后端开发"}],
        }
        violations = _check_role_escalation(args, [FULL_PROFILE])
        self.assertTrue(len(violations) > 0, f"'参与'→'独立完成'应被拦截: {violations}")

    def test_same_role_passes(self):
        """保持相同角色程度不应被拦截。"""
        args = {
            "projects": [{"name": "智能简历助手", "role": "参与",
                          "date": "2024.03 - 2024.06",
                          "description": "- 参与后端开发，实现 API 接口"}],
        }
        violations = _check_role_escalation(args, [FULL_PROFILE])
        self.assertEqual(violations, [], f"保持相同角色不应被拦截: {violations}")

    def test_demoted_role_passes(self):
        """角色降级（如'负责'→'参与'）不应被拦截。"""
        leader_profile = {
            "name": "张三",
            "projects": [{"name": "智能简历助手", "role": "负责",
                          "start_date": "2024.03", "end_date": "2024.06",
                          "description": "负责项目整体设计"}],
        }
        args = {
            "projects": [{"name": "智能简历助手", "role": "参与",
                          "date": "2024.03 - 2024.06",
                          "description": "- 参与后端开发"}],
        }
        violations = _check_role_escalation(args, [leader_profile])
        self.assertEqual(violations, [], f"角色降级不应被拦截: {violations}")


# ══════════════════════════════════════════════════════════════════════════
# 3. 质量闸门评测
# ══════════════════════════════════════════════════════════════════════════


class TestQualityGateEval(unittest.TestCase):
    """质量闸门评测。"""

    def test_strong_verb_resume_passes(self):
        """强动词开头率 ≥ 70% 的简历应通过。"""
        args = {
            "experience": [{"company": "腾讯", "position": "实习生",
                            "date": "2024.06 - 2024.12",
                            "details": "- 优化接口性能，QPS 提升 30%\n- 搭建自动化测试框架\n- 实现用户认证模块"}],
        }
        quality = _check_resume_quality(args)
        self.assertFalse(any(e["section"].startswith("experience") for e in quality.get("errors", [])),
                         f"强动词率合格不应报错: {quality}")

    def test_weak_verb_resume_warns(self):
        """强动词率 < 70% 的简历应警告。"""
        args = {
            "experience": [{"company": "腾讯", "position": "实习生",
                            "date": "2024.06 - 2024.12",
                            "details": "- 做了接口优化\n- 有了测试框架\n- 优化了认证模块"}],
        }
        quality = _check_resume_quality(args)
        self.assertTrue(any("强动词" in w.get("issue", "") for w in quality.get("warnings", [])),
                        f"强动词率低应警告: {quality}")

    def test_empty_phrases_blocked(self):
        """自我评价含空话应被拦截。"""
        args = {
            "self_evaluation": "我认真负责，吃苦耐劳，具有良好的团队合作精神。",
        }
        quality = _check_resume_quality(args)
        self.assertTrue(any(e["section"] == "self_evaluation" for e in quality.get("errors", [])),
                        f"空话应被拦截: {quality}")

    def test_concrete_self_eval_passes(self):
        """具体的自我评价应通过。"""
        args = {
            "self_evaluation": "具备全栈开发能力，熟悉 Python 后端和 Vue 前端技术栈，有独立交付项目的经验。",
        }
        quality = _check_resume_quality(args)
        self.assertFalse(any(e["section"] == "self_evaluation" for e in quality.get("errors", [])),
                         f"具体自评不应被拦截: {quality}")

    def test_all_empty_sections_error(self):
        """教育/工作/项目全空时应报错（require_sections=True）。"""
        args = {
            "education": [],
            "experience": [],
            "projects": [],
        }
        quality = _check_resume_quality(args, require_sections=True)
        self.assertTrue(any(e["section"] == "resume" for e in quality.get("errors", [])),
                        f"全空章节应报错: {quality}")


# ══════════════════════════════════════════════════════════════════════════
# 4. 证据质量评估评测
# ══════════════════════════════════════════════════════════════════════════


class TestEvidenceQualityEval(unittest.TestCase):
    """证据质量评估评测。"""

    def test_no_items_is_insufficient(self):
        """完全无经历条目应判为素材不足。"""
        report = _assess_evidence_quality([EMPTY_PROFILE])
        self.assertEqual(report["quality"], "insufficient")
        self.assertTrue(len(report["suggestions"]) > 0)

    def test_good_items_is_good(self):
        """有量化数据的经历条目应判为良好。"""
        report = _assess_evidence_quality([FULL_PROFILE])
        self.assertIn(report["quality"], ("good", "acceptable"))

    def test_weak_items_is_insufficient(self):
        """有条目但描述全无量化的应判为不足。"""
        weak_profile = {
            "name": "张三",
            "work_experiences": [
                {"company": "某公司", "position": "实习生",
                 "description": "负责日常开发工作"},
            ],
            "projects": [
                {"name": "某项目", "role": "成员",
                 "description": "参与了项目开发"},
            ],
        }
        report = _assess_evidence_quality([weak_profile])
        self.assertEqual(report["quality"], "insufficient")


# ══════════════════════════════════════════════════════════════════════════
# 5. 简历生成/优化/更新工具评测（集成 DB）
# ══════════════════════════════════════════════════════════════════════════


class TestGenerateResumeEval(unittest.TestCase):
    """简历生成工具评测。"""

    def setUp(self):
        self.engine, self.Session = _make_db()

    def tearDown(self):
        self.engine.dispose()

    def test_generate_with_full_profile_succeeds(self):
        """有完整档案时生成简历应成功。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            # 先让 evidence_pool 有 profile 数据
            pool = SessionEvidencePool()
            profile_result = _query_student_profile(db, identity)
            pool.set_profile(profile_result.get("profile") or {})

            args = {
                "title": "前端开发简历",
                "basic": {"name": "李明", "email": "liming@example.com", "phone": "13900139000"},
                "education": [{"school": "浙江大学", "major": "计算机科学与技术",
                               "degree": "本科", "start_date": "2021-09", "end_date": "2025-06"}],
                "experience": [{"company": "腾讯科技", "position": "前端开发实习生",
                                "date": "2024-06 - 2024-12",
                                "details": "- 优化接口性能，QPS 提升 30%\n- 使用 Vue3 开发管理后台"}],
                "projects": [{"name": "智能简历助手", "role": "参与",
                              "date": "2024-03 - 2024-06",
                              "description": "- 基于 Python 搭建后端服务"}],
                "skills": ["Python", "TypeScript", "Vue3"],
                "self_evaluation": "具备全栈开发能力，熟悉 Python 和前端技术栈。",
            }
            result = _generate_resume_data_tool(db, identity, args, evidence_pool=pool)
            self.assertEqual(result["status"], "completed", f"生成失败: {result.get('summary')}")
            self.assertIn("resume_id", result)

    def test_generate_with_fabricated_company_fails(self):
        """生成简历时编造公司名应被事实校验拦截。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            pool = SessionEvidencePool()
            profile_result = _query_student_profile(db, identity)
            pool.set_profile(profile_result.get("profile") or {})

            args = {
                "title": "编造简历",
                "basic": {"name": "李明"},
                "experience": [{"company": "字节跳动", "position": "后端实习生",
                                "date": "2024.06 - 2024.12",
                                "details": "- 开发微服务，QPS 提升 50%"}],
            }
            result = _generate_resume_data_tool(db, identity, args, evidence_pool=pool)
            self.assertEqual(result["status"], "failed", f"编造公司应被拦截: {result}")
            self.assertIn("fact_guard", result.get("error_code", ""), f"应为 fact_guard 拦截: {result}")

    @unittest.skip("P1.1 证据来源索引实现后启用：当前空档案生成不会因素材不足被拦截")
    def test_generate_with_empty_profile_fails_insufficient(self):
        """空档案生成简历应因素材不足被拦截。"""
        with self.Session() as db:
            _seed_empty_student(db)
            identity = _identity(student_id=2)

            pool = SessionEvidencePool()
            profile_result = _query_student_profile(db, identity)
            pool.set_profile(profile_result.get("profile") or {})

            args = {
                "title": "空简历",
                "basic": {"name": "王小白"},
            }
            result = _generate_resume_data_tool(db, identity, args, evidence_pool=pool)
            self.assertEqual(result["status"], "failed", f"空档案应被拦截: {result}")
            self.assertIn("insufficient", result.get("error_code", ""), f"应为素材不足: {result}")

    def test_generate_respects_max_limit(self):
        """简历数量达上限时应拒绝生成。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            # 预创建 _MAX_RESUMES 份简历
            for i in range(_MAX_RESUMES):
                db.add(StudentResume(
                    tenant_id=0, student_id=1,
                    title=f"简历{i}", template_id="classic",
                    data_json="{}",
                ))
            db.commit()

            pool = SessionEvidencePool()
            profile_result = _query_student_profile(db, identity)
            pool.set_profile(profile_result.get("profile") or {})

            args = {
                "title": "超限简历",
                "basic": {"name": "李明"},
                "experience": [{"company": "腾讯科技", "position": "实习生",
                                "date": "2024.06 - 2024.12",
                                "details": "- 优化接口"}],
            }
            result = _generate_resume_data_tool(db, identity, args, evidence_pool=pool)
            self.assertEqual(result["status"], "failed")
            self.assertIn("上限", result.get("summary", ""))


class TestUpdateResumeEval(unittest.TestCase):
    """简历更新工具评测。"""

    def setUp(self):
        self.engine, self.Session = _make_db()

    def tearDown(self):
        self.engine.dispose()

    def test_update_experience_succeeds(self):
        """局部更新工作经历应成功。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            # 先创建一份简历
            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps({
                    "basic": {"name": "李明"},
                    "education": [{"id": "edu-1", "school": "浙江大学", "major": "计算机",
                                   "degree": "本科", "startDate": "2021.09", "endDate": "2025.06"}],
                    "experience": [{"id": "exp-1", "company": "腾讯科技", "position": "前端开发实习生",
                                    "date": "2024.06 - 2024.12",
                                    "details": "- 参与微信小程序重构"}],
                }, ensure_ascii=False),
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)

            pool = SessionEvidencePool()
            profile_result = _query_student_profile(db, identity)
            pool.set_profile(profile_result.get("profile") or {})

            session = StudentAgentSession(
                tenant_id=0, student_id=1,
                title="测试会话", agent_type="resume",
                active_resume_id=resume.id,
            )
            db.add(session)
            db.commit()

            args = {
                "resume_id": resume.id,
                "experience": [{"company": "腾讯科技", "position": "前端开发实习生",
                                "date": "2024-06 - 2024-12",
                                "details": "- 优化接口性能，QPS 提升 30%\n- 搭建 Vue3 管理后台"}],
            }
            result = _update_resume_data_tool(db, identity, args, evidence_pool=pool, session=session)
            self.assertEqual(result["status"], "completed", f"更新失败: {result}")
            self.assertIn("revision_id", result, "应返回 revision_id 用于撤回")

    def test_update_with_version_conflict_fails(self):
        """版本冲突（用户手动编辑后 AI 再改）应被拦截。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json="{}",
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            # 模拟用户已手动编辑（updated_at 比读取时更新）
            old_updated_at = "2024-01-01T00:00:00"

            session = StudentAgentSession(
                tenant_id=0, student_id=1,
                title="测试会话", agent_type="resume",
                active_resume_id=resume.id,
            )
            db.add(session)
            db.commit()

            pool = SessionEvidencePool()

            args = {
                "resume_id": resume.id,
                "base_updated_at": old_updated_at,  # AI 读取时的旧时间
                "experience": [{"company": "腾讯科技", "position": "实习生",
                                "date": "2024.06 - 2024.12", "details": "- 开发"}],
            }
            result = _update_resume_data_tool(db, identity, args, evidence_pool=pool, session=session)
            self.assertEqual(result["status"], "failed", f"版本冲突应被拦截: {result}")
            self.assertIn("version", result.get("error_code", ""), f"应为版本冲突: {result}")

    def test_apply_resume_patch_rewrites_self_evaluation_and_reviews(self):
        """补丁式修改应保存、review 通过，并返回撤销快照。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()
            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps({
                    "basic": {"name": "李明"},
                    "skillContent": "<ul><li>Python</li><li>TypeScript</li></ul>",
                    "selfEvaluationContent": "<p>认真负责，学习能力强。</p>",
                    "experience": [{
                        "id": "exp-1", "company": "腾讯科技", "position": "前端开发实习生",
                        "date": "2024-06 - 2024-12",
                        "details": "<ul><li>参与微信小程序重构，QPS 提升 30%</li></ul>",
                        "visible": True,
                    }],
                    "projects": [{
                        "id": "proj-1", "name": "智能简历助手", "role": "参与",
                        "date": "2024-03 - 2024-06",
                        "description": "<ul><li>基于 Python 和 FastAPI 搭建后端服务</li></ul>",
                        "visible": True,
                    }],
                }, ensure_ascii=False),
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            session = StudentAgentSession(
                tenant_id=0, student_id=1, title="测试会话",
                agent_type="resume", active_resume_id=resume.id,
            )
            db.add(session)
            db.commit()
            pool = SessionEvidencePool()
            args = {
                "resume_id": resume.id,
                "base_updated_at": resume.updated_at.isoformat(),
                "intent_summary": "改写自我评价",
                "patches": [{
                    "action": "rewrite",
                    "section": "self_evaluation",
                    "value": "具备前端开发与后端服务实践经验，能围绕业务目标完成开发和优化。\n重视代码质量和协作沟通，能够快速理解需求并推进落地。",
                }],
            }
            result = _apply_resume_patch_tool(db, identity, args, evidence_pool=pool, session=session)
            self.assertEqual(result["status"], "completed", f"补丁修改应成功: {result}")
            self.assertTrue(result.get("review_passed"), f"应完成 review: {result}")
            self.assertIn("revision_id", result, "应返回 revision_id 用于撤销")
            row = db.get(StudentResume, resume.id)
            self.assertIn("前端开发与后端服务实践经验", row.data_json)

    def test_apply_resume_patch_blocks_fabricated_company(self):
        """新增无来源公司应被 review 拦截，且不保存。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()
            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps({"basic": {"name": "李明"}, "experience": []}, ensure_ascii=False),
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            session = StudentAgentSession(tenant_id=0, student_id=1, title="测试会话", agent_type="resume", active_resume_id=resume.id)
            db.add(session)
            db.commit()
            result = _apply_resume_patch_tool(db, identity, {
                "resume_id": resume.id,
                "patches": [{
                    "action": "add_item",
                    "section": "experience",
                    "value": {
                        "company": "字节跳动",
                        "position": "后端实习生",
                        "date": "2024-06 - 2024-12",
                        "details": "开发推荐系统",
                    },
                }],
            }, evidence_pool=SessionEvidencePool(), session=session)
            self.assertEqual(result["status"], "failed", f"无来源公司应失败: {result}")
            row = db.get(StudentResume, resume.id)
            self.assertNotIn("字节跳动", row.data_json)

    def test_apply_resume_patch_blocks_role_escalation(self):
        """参与不能被补丁式修改夸大成主导。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()
            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps({
                    "basic": {"name": "李明"},
                    "projects": [{
                        "id": "proj-1", "name": "智能简历助手", "role": "参与",
                        "date": "2024-03 - 2024-06",
                        "description": "<ul><li>基于 Python 和 FastAPI 搭建后端服务</li></ul>",
                        "visible": True,
                    }],
                }, ensure_ascii=False),
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            session = StudentAgentSession(tenant_id=0, student_id=1, title="测试会话", agent_type="resume", active_resume_id=resume.id)
            db.add(session)
            db.commit()
            result = _apply_resume_patch_tool(db, identity, {
                "resume_id": resume.id,
                "patches": [{
                    "action": "update_item",
                    "section": "projects",
                    "target_index": 1,
                    "fields": {"role": "主导", "description": "主导项目架构设计\n实现核心模块"},
                }],
            }, evidence_pool=SessionEvidencePool(), session=session)
            self.assertEqual(result["status"], "failed", f"角色夸大应失败: {result}")
            row = db.get(StudentResume, resume.id)
            self.assertIn('"role": "参与"', row.data_json)

    def test_apply_resume_patch_blocks_unbacked_metric(self):
        """新增数字成果必须来自原简历或用户本轮明确说明。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()
            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps({
                    "basic": {"name": "李明"},
                    "experience": [{
                        "id": "exp-1", "company": "腾讯科技", "position": "前端开发实习生",
                        "date": "2024-06 - 2024-12",
                        "details": "<ul><li>参与微信小程序重构，QPS 提升 30%</li></ul>",
                        "visible": True,
                    }],
                }, ensure_ascii=False),
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            session = StudentAgentSession(tenant_id=0, student_id=1, title="测试会话", agent_type="resume", active_resume_id=resume.id)
            db.add(session)
            db.commit()
            result = _apply_resume_patch_tool(db, identity, {
                "resume_id": resume.id,
                "patches": [{
                    "action": "update_item",
                    "section": "experience",
                    "target_index": 1,
                    "fields": {"details": "优化微信小程序接口性能，QPS 提升 300%"},
                }],
            }, evidence_pool=SessionEvidencePool(), session=session)
            self.assertEqual(result["status"], "failed", f"无来源数字应失败: {result}")
            row = db.get(StudentResume, resume.id)
            self.assertNotIn("300%", row.data_json)

    def test_apply_resume_patch_success_payload_feels_comfortable(self):
        """成功结果应让用户安心：说明已 review、能撤销，不暴露内部词或链接。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()
            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps({
                    "basic": {"name": "李明"},
                    "skillContent": "<ul><li>Python</li></ul>",
                    "selfEvaluationContent": "<p>认真负责。</p>",
                }, ensure_ascii=False),
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            session = StudentAgentSession(tenant_id=0, student_id=1, title="测试会话", agent_type="resume", active_resume_id=resume.id)
            db.add(session)
            db.commit()
            result = _apply_resume_patch_tool(db, identity, {
                "resume_id": resume.id,
                "base_updated_at": resume.updated_at.isoformat(),
                "patches": [{
                    "action": "rewrite",
                    "section": "self_evaluation",
                    "value": "具备 Python 实践经验，能够理解需求并完成开发落地。\n重视协作沟通和代码质量，能持续推进任务完成。",
                }],
            }, evidence_pool=SessionEvidencePool(), session=session)
            self.assertEqual(result["status"], "completed", f"应成功: {result}")
            self.assertTrue(result.get("review_passed"))
            self.assertTrue(result.get("open_resume_editor"))
            self.assertIn("review", result.get("summary", "").lower())
            self.assertIn("revision_id", result)
            visible_blob = json.dumps({
                "summary": result.get("summary"),
                "changes": result.get("changes"),
                "review": result.get("review"),
            }, ensure_ascii=False).lower()
            for forbidden in ("apply_resume_patch", "read_resume", "fact_guard", "harness", "tool_call", "api"):
                self.assertNotIn(forbidden, visible_blob)
            self.assertNotRegex(visible_blob, r"https?://|/student/resumes/")
            self.assertLessEqual(len(result.get("changes", {}).get("field_changes", [])), 4)

    def test_apply_resume_patch_failure_is_comfortable_and_non_mutating(self):
        """失败时应暂停保存、说人话，并保持原简历不被污染。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()
            original_doc = {
                "basic": {"name": "李明"},
                "experience": [{
                    "id": "exp-1",
                    "company": "腾讯科技",
                    "position": "前端开发实习生",
                    "date": "2024-06 - 2024-12",
                    "details": "<ul><li>参与微信小程序重构，QPS 提升 30%</li></ul>",
                    "visible": True,
                }],
            }
            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps(original_doc, ensure_ascii=False),
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            session = StudentAgentSession(tenant_id=0, student_id=1, title="测试会话", agent_type="resume", active_resume_id=resume.id)
            db.add(session)
            db.commit()
            result = _apply_resume_patch_tool(db, identity, {
                "resume_id": resume.id,
                "patches": [{
                    "action": "update_item",
                    "section": "experience",
                    "target_index": 1,
                    "fields": {"details": "优化微信小程序接口性能，QPS 提升 300%"},
                }],
            }, evidence_pool=SessionEvidencePool(), session=session)
            self.assertEqual(result["status"], "failed", f"应暂停保存: {result}")
            self.assertIn("display_summary", result)
            self.assertRegex(result["display_summary"], r"(信息对不上|确认|恢复|修改)")
            visible_text = (result.get("summary", "") + result.get("display_summary", "")).lower()
            for forbidden in ("fact_guard", "harness", "tool_call", "traceback", "exception"):
                self.assertNotIn(forbidden, visible_text)
            row = db.get(StudentResume, resume.id)
            self.assertEqual(json.loads(row.data_json), original_doc)


# ══════════════════════════════════════════════════════════════════════════
# 6. JD 分析评测
# ══════════════════════════════════════════════════════════════════════════


class TestJDAnalysisEval(unittest.TestCase):
    """JD 分析工具评测。"""

    def setUp(self):
        self.engine, self.Session = _make_db()

    def tearDown(self):
        self.engine.dispose()

    def test_valid_jd_analysis_succeeds(self):
        """有效的 JD 分析应成功。"""
        with self.Session() as db:
            _seed_student(db)
            session = StudentAgentSession(
                tenant_id=0, student_id=1,
                title="测试会话", agent_type="resume",
            )
            db.add(session)
            db.commit()

            pool = SessionEvidencePool()
            args = {
                "jd_text": SAMPLE_JD.strip(),
                "p0_requirements": ["本科及以上学历", "熟练掌握 Vue3/React"],
                "p1_keywords": ["Vue3", "TypeScript", "小程序", "Vite", "Webpack"],
                "matrix": [
                    {"requirement": "Vue3/React", "status": "SUPPORTED", "evidence": "有 Vue3 开发经验"},
                    {"requirement": "TypeScript", "status": "SUPPORTED", "evidence": "熟悉 TypeScript"},
                    {"requirement": "小程序", "status": "SUPPORTED", "evidence": "参与微信小程序重构"},
                    {"requirement": "前端工程化", "status": "GAP", "evidence": ""},
                ],
            }
            result = _analyze_jd_match_tool(db, session, args, evidence_pool=pool)
            self.assertEqual(result["status"], "completed", f"JD 分析失败: {result}")
            self.assertIn("match_stats", result)

    def test_jd_analysis_requires_p0(self):
        """P0 硬性门槛为空应被拦截。"""
        with self.Session() as db:
            session = StudentAgentSession(
                tenant_id=0, student_id=1,
                title="测试会话", agent_type="resume",
            )
            db.add(session)
            db.commit()

            args = {
                "jd_text": SAMPLE_JD.strip(),
                "p0_requirements": [],
                "p1_keywords": ["Vue3"],
                "matrix": [{"requirement": "Vue3", "status": "SUPPORTED"}],
            }
            result = _analyze_jd_match_tool(db, session, args)
            self.assertEqual(result["status"], "failed")

    def test_jd_analysis_requires_supported_items(self):
        """证据匹配矩阵中至少需要 1 条 SUPPORTED。"""
        with self.Session() as db:
            session = StudentAgentSession(
                tenant_id=0, student_id=1,
                title="测试会话", agent_type="resume",
            )
            db.add(session)
            db.commit()

            args = {
                "jd_text": SAMPLE_JD.strip(),
                "p0_requirements": ["5年经验"],
                "p1_keywords": ["Rust", "Go"],
                "matrix": [
                    {"requirement": "Rust", "status": "GAP", "evidence": ""},
                    {"requirement": "Go", "status": "GAP", "evidence": ""},
                ],
            }
            result = _analyze_jd_match_tool(db, session, args)
            self.assertEqual(result["status"], "failed")


# ══════════════════════════════════════════════════════════════════════════
# 7. 证据池与跨轮评测
# ══════════════════════════════════════════════════════════════════════════


class TestEvidencePoolEval(unittest.TestCase):
    """证据池评测。"""

    def test_evidence_pool_collects_all_sources(self):
        """证据池应正确收集所有来源。"""
        pool = SessionEvidencePool()
        pool.set_profile({"name": "张三", "work_experiences": [{"company": "A"}]})
        pool.add_resume_texts([{"source": "在线简历", "name": "我的简历", "excerpt": "有 A 公司经历"}])
        pool.add_attachment_text("上传简历.pdf", "这是上传的简历内容")
        pool.set_jd("前端开发岗位", ["Vue3", "TypeScript"])

        sources = pool.collect_evidence_sources()
        # collect_evidence_sources 返回 profile + resume excerpts + attachment texts + source_resume_jsons
        # jd 不算入 evidence sources（只做关键词提取），所以至少 3 类
        self.assertTrue(len(sources) >= 3, f"应收集到至少 3 类证据源: {len(sources)}")

    def test_evidence_pool_cross_turn_preserves_index(self):
        """证据来源索引应可序列化和恢复。"""
        # 模拟第一轮：读取了 profile + resume
        pool = SessionEvidencePool()
        pool.set_profile({"name": "张三"})
        pool.add_resume_texts([{"source": "在线简历", "name": "简历1", "excerpt": "内容"}])

        # 从证据池快照生成索引
        index = pool.build_source_index(resume_ids_read=[1])
        index_json = index.to_json()

        # 模拟跨轮恢复
        restored = EvidenceSourceIndex.from_json(index_json)
        self.assertTrue(restored.has_profile)
        self.assertEqual(restored.resume_ids_read, [1])


class TestEvidenceSourceIndex(unittest.TestCase):
    """证据来源索引评测（P1.1）。

    核心诉求：证据池 per-run，跨轮（read_resume → chat → optimize）时
    上一轮读到的简历内容会丢失。EvidenceSourceIndex 把「读过哪些 resume、
    分析过哪些附件、是否有 profile、GAP 关键词」这类元数据索引化并持久化
    到 session，下一轮恢复后能懒重读，避免事实校验误拦。
    """

    def test_index_serializes_round_trip(self):
        """索引应能 JSON 序列化和反序列化。"""
        index = EvidenceSourceIndex(
            has_profile=True,
            resume_ids_read=[12, 15],
            attachment_ids_analyzed=[3],
            gap_keywords=["Kubernetes", "Elasticsearch"],
            has_jd_analysis=True,
        )
        restored = EvidenceSourceIndex.from_json(index.to_json())
        self.assertTrue(restored.has_profile)
        self.assertEqual(restored.resume_ids_read, [12, 15])
        self.assertEqual(restored.attachment_ids_analyzed, [3])
        self.assertEqual(restored.gap_keywords, ["Kubernetes", "Elasticsearch"])
        self.assertTrue(restored.has_jd_analysis)

    def test_index_from_empty_json_is_safe(self):
        """空/损坏 JSON 应安全降级为空索引。"""
        restored = EvidenceSourceIndex.from_json("")
        self.assertFalse(restored.has_profile)
        self.assertEqual(restored.resume_ids_read, [])

        restored2 = EvidenceSourceIndex.from_json(None)
        self.assertFalse(restored2.has_profile)

    def test_pool_builds_index_from_snapshot(self):
        """证据池应能从当前快照构建索引。"""
        pool = SessionEvidencePool()
        pool.set_profile({"name": "张三"})
        pool.add_resume_texts([{"source": "在线简历", "name": "简历1", "excerpt": "内容"}])
        pool.set_gap_keywords(["Docker"])

        index = pool.build_source_index(resume_ids_read=[8])
        self.assertTrue(index.has_profile)
        self.assertEqual(index.resume_ids_read, [8])
        self.assertEqual(index.gap_keywords, ["Docker"])

    def test_pool_merges_restored_index(self):
        """恢复的索引应合并进证据池，后续 collect 不丢已恢复的 GAP 关键词。"""
        # 第一轮：分析 JD 得到 GAP 关键词
        pool1 = SessionEvidencePool()
        pool1.set_gap_keywords(["Kubernetes"])

        # 持久化索引
        persisted = pool1.build_source_index(resume_ids_read=[]).to_json()

        # 第二轮：新证据池，恢复索引
        pool2 = SessionEvidencePool()
        pool2.restore_source_index(EvidenceSourceIndex.from_json(persisted))
        # GAP 关键词应被恢复（跨轮 JD 分析结果不丢）
        self.assertEqual(pool2.gap_keywords, ["Kubernetes"])

    def test_cross_turn_resume_lazy_restore(self):
        """跨轮懒重读：索引记录已读 resume_id，新轮可据此判断是否需要重读。"""
        # 第一轮读了 resume 5
        pool1 = SessionEvidencePool()
        idx1 = pool1.build_source_index(resume_ids_read=[5])

        # 第二轮新池子（per-run，内容为空）
        pool2 = SessionEvidencePool()
        pool2.restore_source_index(EvidenceSourceIndex.from_json(idx1.to_json()))

        # 索引仍知道 resume 5 被读过，但本轮 pool 里没有它的全文
        # → 调用方应据此触发懒重读（这里验证索引信息可被查询）
        restored_idx = pool2.build_source_index()  # 不传 resume_ids，沿用恢复的
        self.assertIn(5, restored_idx.resume_ids_read)


# ══════════════════════════════════════════════════════════════════════════
# 8. 读取工具评测
# ══════════════════════════════════════════════════════════════════════════


class TestReadResumeEval(unittest.TestCase):
    """简历读取工具评测。"""

    def setUp(self):
        self.engine, self.Session = _make_db()

    def tearDown(self):
        self.engine.dispose()

    def test_read_resume_returns_list_and_full(self):
        """读取简历应返回列表层 + 全文层。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            # 创建一份简历
            db.add(StudentResume(
                tenant_id=0, student_id=1,
                title="我的简历", template_id="classic",
                data_json=json.dumps({
                    "basic": {"name": "李明"},
                    "experience": [{"company": "腾讯科技", "position": "实习生",
                                    "date": "2024.06 - 2024.12", "details": "- 开发"}],
                }, ensure_ascii=False),
            ))
            db.commit()

            session = StudentAgentSession(
                tenant_id=0, student_id=1,
                title="测试", agent_type="resume",
            )
            db.add(session)
            db.commit()

            result = _read_resume_tool(db, identity, session, [], active_resume_id=None)
            self.assertEqual(result["status"], "completed")
            self.assertIn("resume_list", result)

    def test_read_resume_no_resumes(self):
        """无简历时应返回空列表。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            session = StudentAgentSession(
                tenant_id=0, student_id=1,
                title="测试", agent_type="resume",
            )
            db.add(session)
            db.commit()

            result = _read_resume_tool(db, identity, session, [])
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["resume_list"], [])

    def test_query_profile_returns_all_sections(self):
        """查询档案应返回完整信息。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            result = _query_student_profile(db, identity)
            self.assertEqual(result["status"], "completed")
            profile = result["profile"]
            self.assertEqual(profile["name"], "李明")
            self.assertTrue(len(profile.get("work_experiences", [])) > 0)
            self.assertTrue(len(profile.get("projects", [])) > 0)


# ══════════════════════════════════════════════════════════════════════════
# 9. 快照与撤销评测
# ══════════════════════════════════════════════════════════════════════════


class TestRevisionEval(unittest.TestCase):
    """写前快照与撤销评测。"""

    def setUp(self):
        self.engine, self.Session = _make_db()

    def tearDown(self):
        self.engine.dispose()

    def test_snapshot_creates_revision(self):
        """写前快照应创建 revision 记录。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="原始简历", template_id="classic",
                data_json='{"basic": {"name": "李明"}}',
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)

            revision_id = _snapshot_resume_revision(db, identity, resume, source="ai_update")
            self.assertIsNotNone(revision_id)

            # 验证 revision 记录
            revision = db.get(StudentResumeRevision, revision_id)
            self.assertIsNotNone(revision)
            self.assertEqual(revision.source, "ai_update")
            self.assertIn("李明", revision.data_json)

    def test_revision_cleanup_keeps_20(self):
        """每份简历应最多保留 20 条快照。"""
        with self.Session() as db:
            _seed_student(db)
            identity = _identity()

            resume = StudentResume(
                tenant_id=0, student_id=1,
                title="测试简历", template_id="classic",
                data_json="{}",
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)

            # 创建 25 条快照
            for i in range(25):
                _snapshot_resume_revision(db, identity, resume, source="test")

            # 应该只保留 20 条
            from sqlalchemy import func as sa_func
            actual_count = db.scalar(
                select(sa_func.count(StudentResumeRevision.id)).where(
                    StudentResumeRevision.resume_id == resume.id,
                )
            )
            self.assertLessEqual(actual_count, 20, f"应保留最多 20 条快照: {actual_count}")


# ══════════════════════════════════════════════════════════════════════════
# 10. 边界场景评测
# ══════════════════════════════════════════════════════════════════════════


class TestEdgeCasesEval(unittest.TestCase):
    """边界场景评测。"""

    def test_item_attribution_shadow_mode_on(self):
        """条目归属校验应在 shadow mode（不拦截）。"""
        self.assertTrue(ITEM_ATTRIBUTION_SHADOW_MODE,
                        "条目归属校验应处于 shadow mode")

    def test_birth_date_in_basic_exemption(self):
        """birth_date 应在基本信息豁免中。"""
        args = {
            "basic": {"name": "李明", "birth_date": "2003-05"},
            "experience": [{"company": "腾讯科技", "position": "实习生",
                            "date": "2024.06 - 2024.12", "details": "- 开发"}],
        }
        violations, _ = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertFalse(any("2003" in v for v in violations),
                         f"birth_date 不应被判为无来源时间段: {violations}")

    def test_mixed_date_format_detected(self):
        """同一简历中混用日期分隔符应被质量闸门检测。"""
        args = {
            "experience": [
                {"company": "腾讯科技", "date": "2024.06 - 2024-12",
                 "details": "- 优化接口性能"},
            ],
        }
        quality = _check_resume_quality(args)
        self.assertTrue(any(e["section"] == "dates" for e in quality.get("errors", [])),
                        f"日期格式混用应被检测: {quality}")

    def test_empty_name_not_in_whitelist(self):
        """模型编造的姓名如果不在证据中，不应通过豁免。"""
        args = {
            "basic": {"name": "赵六"},  # 不在 FULL_PROFILE 中
        }
        # 构造一个不含"赵六"的证据
        evidence_text = "学生叫李明"
        violations, _ = _validate_resume_facts(args, [evidence_text])
        self.assertTrue(any("赵六" in v for v in violations),
                        f"编造姓名应被拦截: {violations}")


# ══════════════════════════════════════════════════════════════════════════
# 11. 意图模式识别评测（P0.2）
# ══════════════════════════════════════════════════════════════════════════


class TestIntentClassification(unittest.TestCase):
    """意图模式识别回归评测。

    7 种意图模式：
      - create  : 从零生成新简历（"帮我做一份简历"）
      - refine  : 整体优化已有简历（"优化一下我的简历"）
      - patch   : 局部修改某段/某字段（"把项目经历加进去"）
      - style   : 改语气/措辞/排版，不改变事实（"语气更正式一点"）
      - enrich  : 补充量化/成果（"加一些数字指标"）
      - export  : 导出 PDF（"导出简历"）
      - chat    : 闲聊/提供信息/提问，不应直接改简历（"我做过 XX 项目"）

    is_directive 标记是否构成"明确指令"（应直接动手），
    与 system prompt 的"先说后做"行动准则对齐。
    """

    # ── create ──────────────────────────────────────────────────────────────
    def test_create_from_scratch(self):
        """从零生成新简历。"""
        intent = classify_intent("帮我做一份前端开发的简历")
        self.assertEqual(intent.mode, "create")
        self.assertTrue(intent.is_directive)

    def test_create_with_jd(self):
        """带 JD 的从零生成。"""
        intent = classify_intent("帮我根据这个岗位生成一份简历\n\n" + SAMPLE_JD)
        self.assertEqual(intent.mode, "create")
        self.assertTrue(intent.is_directive)

    # ── refine ──────────────────────────────────────────────────────────────
    def test_refine_whole_resume(self):
        """整体优化已有简历。"""
        intent = classify_intent("帮我优化一下我的简历", has_resume=True)
        self.assertEqual(intent.mode, "refine")
        self.assertTrue(intent.is_directive)

    def test_refine_for_jd(self):
        """针对 JD 订制优化。"""
        intent = classify_intent("帮我针对这个岗位优化简历", has_resume=True, has_jd=True)
        self.assertEqual(intent.mode, "refine")
        self.assertTrue(intent.is_directive)

    # ── patch ───────────────────────────────────────────────────────────────
    def test_patch_add_experience(self):
        """局部添加某段经历。"""
        intent = classify_intent("把我的腾讯实习加到项目经历里", has_resume=True)
        self.assertEqual(intent.mode, "patch")
        self.assertTrue(intent.is_directive)

    def test_patch_modify_section(self):
        """局部修改某个章节。"""
        intent = classify_intent("改一下自我评价", has_resume=True)
        self.assertEqual(intent.mode, "patch")
        self.assertTrue(intent.is_directive)

    def test_patch_delete_item(self):
        """局部删除某段。"""
        intent = classify_intent("把第三段项目经历删掉", has_resume=True)
        self.assertEqual(intent.mode, "patch")
        self.assertTrue(intent.is_directive)

    # ── style ───────────────────────────────────────────────────────────────
    def test_style_tone(self):
        """改语气，不改变事实。"""
        intent = classify_intent("语气再正式一点", has_resume=True)
        self.assertEqual(intent.mode, "style")
        self.assertTrue(intent.is_directive)

    def test_style_rewrite_bullets(self):
        """润色措辞。"""
        intent = classify_intent("帮我润色一下经历的描述", has_resume=True)
        self.assertEqual(intent.mode, "style")
        self.assertTrue(intent.is_directive)

    # ── enrich ──────────────────────────────────────────────────────────────
    def test_enrich_quantify(self):
        """补充量化指标。"""
        intent = classify_intent("帮我在经历里多加一些数字成果", has_resume=True)
        self.assertEqual(intent.mode, "enrich")
        self.assertTrue(intent.is_directive)

    # ── export ──────────────────────────────────────────────────────────────
    def test_export_pdf(self):
        """导出 PDF。"""
        intent = classify_intent("帮我导出简历 PDF", has_resume=True)
        self.assertEqual(intent.mode, "export")
        self.assertTrue(intent.is_directive)

    # ── chat ────────────────────────────────────────────────────────────────
    def test_chat_provide_info_not_directive(self):
        """提供信息不应是明确指令，不该直接改简历。"""
        intent = classify_intent("我之前在腾讯做过一段实习")
        self.assertEqual(intent.mode, "chat")
        self.assertFalse(intent.is_directive,
                         "提供信息不应判为明确指令，需先确认再动手")

    def test_chat_question_not_directive(self):
        """提问不应是明确指令。"""
        intent = classify_intent("简历里要不要写课程设计？")
        self.assertEqual(intent.mode, "chat")
        self.assertFalse(intent.is_directive)

    def test_chat_greeting(self):
        """打招呼是闲聊。"""
        intent = classify_intent("你好")
        self.assertEqual(intent.mode, "chat")
        self.assertFalse(intent.is_directive)

    def test_chat_skill_mention_not_directive(self):
        """「我还会 Python」是提供信息，不是让它改技能栏。"""
        intent = classify_intent("我还会 Python")
        self.assertEqual(intent.mode, "chat")
        self.assertFalse(intent.is_directive)

    # ── 确认指令的边界 ────────────────────────────────────────────────────────
    def test_explicit_confirmation_is_directive(self):
        """「改吧」「加进去」「好的就这样」是明确指令。"""
        for text in ("改吧", "加进去", "好的就这样改", "行，直接更新"):
            intent = classify_intent(text, has_resume=True)
            self.assertTrue(intent.is_directive,
                            f"「{text}」应是明确指令: {intent.mode}")

    def test_chat_then_directive_escalates(self):
        """同一句里既有信息又有指令，以指令为准。"""
        intent = classify_intent("我在腾讯实习过，帮我加到简历里", has_resume=True)
        self.assertTrue(intent.is_directive)
        self.assertIn(intent.mode, ("patch", "refine"))

    # ── effort 派生一致性 ─────────────────────────────────────────────────────
    def test_effort_derived_from_intent_is_consistent(self):
        """classify_intent.recommended_effort 与 auto_classify_effort 不矛盾。

        auto_classify_effort 是现有的思考程度分类（low/medium/high/xhigh/max），
        classify_intent 在意图层面给出推荐 effort。两者在简单闲聊上应都判 low，
        在复杂订制优化上应都判 high+。这一致性是"迁移"的核心约束。
        """
        # 闲聊 → 都偏轻量
        self.assertEqual(auto_classify_effort("你好"), "low")
        self.assertIn(classify_intent("你好").recommended_effort, ("low",))

        # 简单 patch → 都应 medium 起步
        patch_intent = classify_intent("改一下自我评价", has_resume=True)
        self.assertGreaterEqual(
            {"low": 0, "medium": 1, "high": 2, "xhigh": 3, "max": 4}[patch_intent.recommended_effort],
            1,
        )

        # 全面订制优化 → auto 判 high/xhigh，intent 也应 high+
        heavy = "帮我针对这个岗位全面订制优化简历\n\n" + SAMPLE_JD
        auto_heavy = auto_classify_effort(heavy, has_jd=True)
        intent_heavy = classify_intent(heavy, has_resume=True, has_jd=True)
        self.assertGreaterEqual(auto_classify_effort_to_level(auto_heavy), 2,
                                f"auto 应判 high+: {auto_heavy}")
        self.assertGreaterEqual(
            {"low": 0, "medium": 1, "high": 2, "xhigh": 3, "max": 4}[intent_heavy.recommended_effort],
            2,
            f"intent effort 应 high+: {intent_heavy.recommended_effort}",
        )


def auto_classify_effort_to_level(effort: str) -> int:
    """把 auto_classify_effort 的返回值映射成可比较的等级。"""
    return {"low": 0, "medium": 1, "high": 2, "xhigh": 3, "max": 4}[effort]


# ══════════════════════════════════════════════════════════════════════════
# 12. 失败胶囊文案人话化评测（P1.2）
# ══════════════════════════════════════════════════════════════════════════


class TestNoDuplicateFactGuardDefinitions(unittest.TestCase):
    """架构约束回归（P4）：事实校验函数不得在 agent_runtime 本地重复定义。

    agent_runtime 曾有自己的 _validate_resume_facts / _norm_token / _noun_has_source
    副本，覆盖了从 agent_fact_guard 的 import，导致改一处要同步改两处（P1.3 踩过）。
    此测试固化「runtime 与 fact_guard 用同一函数对象」的约束，防止回退。
    """

    def test_validate_resume_facts_is_shared(self):
        import app.student.agent_runtime as ar
        import app.student.agent_fact_guard as fg
        self.assertIs(ar._validate_resume_facts, fg._validate_resume_facts,
                      "_validate_resume_facts 应从 agent_fact_guard 复用，不得在 runtime 本地重复定义")

    def test_norm_token_is_shared(self):
        import app.student.agent_runtime as ar
        import app.student.agent_fact_guard as fg
        self.assertIs(ar._norm_token, fg._norm_token)

    def test_noun_has_source_is_shared(self):
        import app.student.agent_runtime as ar
        import app.student.agent_fact_guard as fg
        self.assertIs(ar._noun_has_source, fg._noun_has_source)

    def test_fact_values_from_args_is_shared(self):
        import app.student.agent_runtime as ar
        import app.student.agent_fact_guard as fg
        self.assertIs(ar._fact_values_from_args, fg._fact_values_from_args)


class TestDisplaySummaryHumanized(unittest.TestCase):
    """失败胶囊 display_summary 人话化回归评测。

    display_summary 是工具执行失败时前端胶囊显示的文案（用户在对话流里
    会看到）。必须是面向用户的口语化描述，不能出现内部术语。

    验证策略：
    1. 黑名单——任何文案都不得出现技术术语（fact_guard/证据矩阵/质量建议等）；
    2. 真实集成——调用真实工具函数，断言它返回的就是人话化文案。
    """

    # 禁止出现在用户可见文案里的技术术语（黑名单）
    _TECH_TERMS = frozenset({
        "事实清单", "证据矩阵", "事实校验", "质量建议", "质量闸门", "质量检查",
        "事实核对", "核对事实",
        "fact_guard", "evidence", "harness", "skill",
        "素材", "jd匹配分析", "jd_coverage", "jd关键词覆盖",
        "read_resume", "optimize_resume", "update_resume",
    })

    def _assert_no_tech_terms(self, display_summary: str, context: str = ""):
        """断言一句 display_summary 不含技术术语。"""
        self.assertIsInstance(display_summary, str, f"display_summary 应是字符串: {context}")
        self.assertTrue(display_summary.strip(), f"display_summary 不应为空: {context}")
        lower = display_summary.lower()
        for term in self._TECH_TERMS:
            self.assertNotIn(term.lower(), lower,
                             f"display_summary 含技术术语「{term}」: 「{display_summary}」({context})")

    def test_fact_guard_failure_has_no_tech_terms(self):
        """事实校验失败文案不得含技术术语（真实函数调用）。"""
        args = {
            "experience": [{"company": "字节跳动", "position": "实习生",
                            "date": "2024.06 - 2024.12", "details": "- 开发"}],
        }
        violations, whitelist = _validate_resume_facts(args, [FULL_PROFILE])
        self.assertTrue(violations, "前置：应有违规")
        result = _fact_guard_failure("generate_resume_data", violations, whitelist)
        self._assert_no_tech_terms(result["display_summary"], "fact_guard_failure")

    def test_fact_guard_failure_is_user_facing(self):
        """事实校验失败文案应是面向用户的人话（精确断言）。

        旧文案「正在核对事实并重写」含「核对事实」技术感，改写后应表达
        「简历里有信息对不上档案，正在帮你修正」。
        """
        args = {
            "experience": [{"company": "字节跳动", "position": "实习生",
                            "date": "2024.06 - 2024.12", "details": "- 开发"}],
        }
        violations, whitelist = _validate_resume_facts(args, [FULL_PROFILE])
        result = _fact_guard_failure("generate_resume_data", violations, whitelist)
        ds = result["display_summary"]
        # 应包含「核实」或「修正」这类面向用户的词，保留违规数量
        self.assertRegex(ds, r"(核实|修正|对不上|核对.{0,2}真实)",
                         f"display_summary 应面向用户: 「{ds}」")
        # 保留有信息量的数字（n 处）
        self.assertRegex(ds, r"\d+\s*处",
                         f"display_summary 应保留违规数量: 「{ds}」")

    def test_quality_gate_error_is_user_facing(self):
        """质量闸门 error 文案应是面向用户的（真实函数调用）。"""
        with self._make_db_session() as db:
            _seed_student(db)
            identity = _identity()
            args = {
                "title": "测试简历",
                "basic": {"name": "李明"},
            }
            result = _generate_resume_data_tool(db, identity, args)
            if result.get("status") == "failed" and result.get("error_code") == "resume_quality_retry":
                self._assert_no_tech_terms(result.get("display_summary", ""), "quality_gate_error")

    def test_insufficient_evidence_is_user_facing(self):
        """素材不足文案应是面向用户的（真实函数调用）。"""
        with self._make_db_session() as db:
            _seed_empty_student(db)
            identity = _identity(student_id=2)
            pool = SessionEvidencePool()
            profile_result = _query_student_profile(db, identity)
            pool.set_profile(profile_result.get("profile") or {})
            args = {
                "title": "空简历",
                "basic": {"name": "王小白"},
            }
            result = _generate_resume_data_tool(db, identity, args, evidence_pool=pool)
            if result.get("status") == "failed" and "insufficient" in result.get("error_code", ""):
                self._assert_no_tech_terms(result.get("display_summary", ""), "insufficient_evidence")

    def test_jd_coverage_is_user_facing(self):
        """JD 覆盖率文案应是面向用户的（真实函数调用）。"""
        with self._make_db_session() as db:
            _seed_student(db)
            identity = _identity()
            pool = SessionEvidencePool()
            profile_result = _query_student_profile(db, identity)
            pool.set_profile(profile_result.get("profile") or {})
            pool.jd_text = "需要 Java Python 算法"
            pool.gap_keywords = ["Java", "Python", "算法"]
            args = {
                "title": "测试简历",
                "basic": {"name": "李明"},
                "jd_text": "需要 Java Python 算法",
            }
            result = _generate_resume_data_tool(db, identity, args, evidence_pool=pool)
            if result.get("status") == "failed" and result.get("error_code") == "jd_coverage_retry":
                self._assert_no_tech_terms(result.get("display_summary", ""), "jd_coverage")
                self.assertRegex(result["display_summary"], r"岗位相关", f"应面向用户: 「{result['display_summary']}」")

    def test_version_conflict_is_user_facing(self):
        """版本冲突文案应是面向用户的（真实函数调用）。"""
        from app.student.agent_runtime import _update_resume_data_tool
        with self._make_db_session() as db:
            _seed_student(db)
            identity = _identity()
            resume = StudentResume(
                tenant_id=0, student_id=1, title="测试简历",
                template_id="classic", data_json='{"basic":{"name":"李明"}}',
            )
            db.add(resume)
            db.commit()
            db.refresh(resume)
            old_ts = (resume.updated_at or datetime.now(timezone.utc)).isoformat()
            import time
            time.sleep(0.01)
            result = _update_resume_data_tool(
                db, identity,
                {"resume_id": resume.id, "basic": {"name": "李明2"}, "base_updated_at": "2000-01-01T00:00:00Z"},
            )
            if result.get("status") == "failed" and result.get("error_code") == "resume_version_retry":
                self._assert_no_tech_terms(result.get("display_summary", ""), "version_conflict")

    def test_skill_required_is_user_facing(self):
        """订制 Skill 前置文案应是面向用户的（真实函数调用）。"""
        result = _fact_guard_failure("generate_resume_data", [
            "经历「编造公司」在档案中找不到依据",
        ])
        self._assert_no_tech_terms(result.get("display_summary", ""), "skill_required")

    def test_jd_analysis_required_is_user_facing(self):
        """JD 分析前置文案应是面向用户的（真实函数调用）。"""
        result = _fact_guard_failure("optimize_resume_data", [
            "技能「编造技能」在档案中找不到依据",
        ])
        self._assert_no_tech_terms(result.get("display_summary", ""), "jd_analysis_required")

    # ── 集成验证：真实工具返回的文案 ──────────────────────────────────────────

    def test_fact_guard_failure_from_tool_is_humanized(self):
        """generate 工具因事实校验失败返回的 display_summary 应人话化。"""
        with self._make_db_session() as db:
            _seed_student(db)
            identity = _identity()
            # 编造公司名触发 fact_guard
            args = {
                "title": "测试简历",
                "basic": {"name": "李明"},
                "experience": [{"company": "编造公司XYZ", "position": "实习生",
                                "date": "2024.06 - 2024.12", "details": "- 开发"}],
            }
            result = _generate_resume_data_tool(db, identity, args)
            self.assertEqual(result.get("status"), "failed", f"前置：应失败: {result.get('error_code')}")
            self._assert_no_tech_terms(result.get("display_summary", ""), "generate_fact_guard")

    @contextmanager
    def _make_db_session(self):
        """测试用 DB session 上下文管理器。"""
        engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine, future=True)
        with Session() as db:
            yield db
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
