"""事实闸门（fact guard）与质量闸门的回归测试。

覆盖 2026-06 三个修复：
1. 白名单专名字段补齐 major/degree（避免如实照抄档案被误拦）
2. 时间段整段/端点互认（profile 存单点，schema 要求模型输出区间）
3. 日期混用检测重写（区间分隔符不误判、真混用能检出、birth_date 不参与）
"""
from __future__ import annotations

from app.student.agent_runtime import _check_resume_quality, _validate_resume_facts

PROFILE = {
    "name": "张三",
    "educations": [
        {
            "school": "华南理工大学",
            "major": "计算机科学与技术",
            "degree": "本科",
            "duration": "2021.09 - 2025.06",
            "description": "",
        }
    ],
    "work_experiences": [
        {
            "company": "腾讯",
            "position": "后端开发实习生",
            "start_date": "2024.06",
            "end_date": "2024.12",
            "description": "- 优化接口性能，QPS 提升 30%，使用 Python 和 MySQL",
        }
    ],
}


def test_faithful_resume_passes_fact_guard():
    """如实照抄档案（含 STAR 改写、区间格式时间）不应有任何违规。"""
    args = {
        "basic": {"name": "张三"},
        "education": [
            {
                "school": "华南理工大学",
                "major": "计算机科学与技术",
                "degree": "本科",
                "date": "2021-09 - 2025-06",
            }
        ],
        "experience": [
            {
                "company": "腾讯",
                "position": "后端开发实习生",
                "date": "2024-06 - 2024-12",
                "details": "- 优化接口性能，QPS 提升 30%（Python + MySQL）",
            }
        ],
    }
    assert _validate_resume_facts(args, [PROFILE])[0] == []


def test_fabricated_facts_are_blocked():
    args = {
        "experience": [
            {
                "company": "字节跳动",
                "position": "后端开发实习生",
                "date": "2024-06 - 2024-12",
                "details": "- 用 TerraformPro 重构服务，QPS 提升 300%",
            }
        ],
    }
    violations, _ = _validate_resume_facts(args, [PROFILE])
    # 字节跳动不在证据中（证据里是腾讯），应被拦截——经历实体造假
    assert any("字节跳动" in v for v in violations), f"编造公司名应被拦截: {violations}"
    # 数字指标和技术词不再校验——AI 生成的是建议草稿，用户会编辑
    assert not any("300%" in v for v in violations), f"数字指标不应被拦截: {violations}"
    assert not any("TerraformPro" in v for v in violations), f"技术词不应被拦截: {violations}"


def test_fabricated_time_range_is_blocked():
    args = {
        "experience": [
            {"company": "腾讯", "date": "2019-01 - 2020-01", "details": "- 优化接口"}
        ],
    }
    violations, _ = _validate_resume_facts(args, [PROFILE])
    assert any("2019-01" in v for v in violations)


def test_range_endpoints_accepted_from_evidence_range():
    """证据是整段（duration），模型输出单个端点也应通过。"""
    args = {
        "education": [
            {"school": "华南理工大学", "start_date": "2021-09", "end_date": "2025-06"}
        ],
    }
    assert _validate_resume_facts(args, [PROFILE])[0] == []


def test_mixed_date_format_detected():
    args = {
        "experience": [
            {"company": "腾讯", "date": "2022-06-01 - 2024-12", "details": "- 开发系统"}
        ],
    }
    quality = _check_resume_quality(args)
    assert any(e["section"] == "dates" for e in quality["errors"])


def test_uniform_date_format_with_birth_date_not_flagged():
    """schema 要求所有简历日期使用 YYYY-MM，不应误报。"""
    args = {
        "basic": {"birth_date": "2003-05"},
        "experience": [
            {
                "company": "腾讯",
                "date": "2024-06 - 2024-12",
                "details": "- 优化接口性能，QPS 提升 30%",
            }
        ],
    }
    quality = _check_resume_quality(args)
    assert not any(e["section"] == "dates" for e in quality["errors"])


DIRTY_PROFILE = {
    "name": "吴少然",
    "educations": [
        {
            "school": "厦门大学",
            "major": "软件工程",
            "degree": "本科",
            "duration": "2023.09-2027。06",  # 用户手填的全角句号
            "description": "",
        }
    ],
    "work_experiences": [
        {
            "company": "某科技公司",
            "position": "Agent开发实习生",
            "start_date": "2026-03",
            "end_date": "2026-05",
            "description": "- 开发多Agent流程，接入 MCP 工具，RAG 优化",
        }
    ],
    "projects": [
        {
            "name": "合同审查助手",
            "role": "参与",  # 配合 test_role_escalation_independent_blocked（"参与" -> "独立完成" 应被拦截）
            "start_date": "2026。01",
            "end_date": "2026.04",
            "description": "- 基于 Python 和 FastAPI 搭建",
        }
    ],
}


def test_dirty_profile_dates_normalized_output_passes():
    """档案时间格式脏（全角句号/短横线混用），模型统一为 YYYY-MM 输出必须通过。

    回归：此前时间逐字比对 + 质量闸门要求格式统一互相矛盾，
    模型怎么改都过不了，最终只能提交空白章节绕过校验。
    """
    args = {
        "education": [
            {"school": "厦门大学", "major": "软件工程", "degree": "本科",
             "date": "2023-09 - 2027-06"}
        ],
        "experience": [
            {"company": "某科技公司", "position": "Agent开发实习生",
             "date": "2026-03 - 2026-05",
             "details": "- 开发多Agent流程，接入 MCP 工具，完成 RAG 优化"}
        ],
        "projects": [
            {"name": "合同审查助手", "role": "参与",
             "date": "2026-01 - 2026-04",
             "details": "- 基于 Python 和 FastAPI 搭建"}
        ],
    }
    assert _validate_resume_facts(args, [DIRTY_PROFILE])[0] == []
    quality = _check_resume_quality(args)
    assert not any(e["section"] == "dates" for e in quality["errors"])


def test_dirty_date_format_in_output_flagged_by_quality_gate():
    """模型照抄档案里的全角句号/混用格式时，质量闸门要能检出并要求统一。"""
    args = {
        "education": [{"school": "厦门大学", "date": "2023.09-2027。06"}],
        "experience": [{"company": "某科技公司", "date": "2026-03 至 2026-05",
                        "details": "- 开发多Agent流程"}],
    }
    quality = _check_resume_quality(args)
    assert any(e["section"] == "dates" for e in quality["errors"])
    # 但事实校验不应因此报违规（分隔符不敏感）
    assert _validate_resume_facts(args, [DIRTY_PROFILE])[0] == []


def test_year_only_range_not_misdetected():
    """纯年份区间 "2023-2024" 不应被匹配成 YYYY-MM 分隔符。"""
    args = {
        "experience": [
            {"company": "腾讯", "date": "2024-06 - 2024-12", "details": "- 优化接口，QPS 提升 30%"},
            {"company": "腾讯", "date": "2023-2024", "details": "- 优化接口，QPS 提升 30%"},
        ],
    }
    quality = _check_resume_quality(args)
    assert not any(e["section"] == "dates" for e in quality["errors"])


# ── JD Coverage Gate Tests ────────────────────────────────────────────────────

from app.student.agent_runtime import (
    _check_jd_coverage,
    _looks_like_jd,
    _fact_guard_failure,
    FactWhitelist,
)


def test_jd_coverage_pass_with_good_match():
    """简历覆盖 JD 大部分关键词 → 通过。"""
    jd = (
        "岗位职责：负责后端服务开发，使用 Python、MySQL、Redis 构建高并发接口。"
        "任职要求：计算机相关专业，熟悉微服务架构，有 Docker 和 K8s 经验优先。"
    )
    args = {
        "skills": "Python, MySQL, Redis, Docker, Kubernetes",
        "experience": [
            {"details": "- 基于 Python 开发微服务接口，使用 MySQL 和 Redis 优化查询"}
        ],
        "projects": [],
    }
    result = _check_jd_coverage(args, jd)
    assert result["passed"] is True
    assert result["coverage_ratio"] >= 0.3


def test_jd_coverage_low_blocked():
    """JD 含多个技术词但简历只覆盖极少 → 被拦。"""
    jd = (
        "任职要求：精通 Java、Spring Boot、Kafka、Elasticsearch、Flink，"
        "熟悉分布式系统设计，有大规模数据处理经验。"
    )
    args = {
        "skills": "Python",
        "experience": [{"details": "- 用 Python 写脚本"}],
        "projects": [],
    }
    result = _check_jd_coverage(args, jd)
    assert result["passed"] is False
    assert result["coverage_ratio"] < 0.15


def test_jd_coverage_no_keywords_returns_pass():
    """JD 中未提取到有效关键词 → 不卡。"""
    jd = "123 456 789"
    args = {"skills": "", "experience": [], "projects": []}
    result = _check_jd_coverage(args, jd)
    assert result["passed"] is True


def test_looks_like_jd_true():
    text = (
        "岗位职责\n"
        "1. 负责公司核心系统的后端开发和维护\n"
        "2. 参与系统架构设计和优化\n"
        "3. 编写技术文档和代码评审\n"
        "4. 与产品和前端团队紧密协作，确保需求落地\n"
        "任职要求\n"
        "1. 计算机相关专业本科及以上学历\n"
        "2. 3年以上 Java 开发经验\n"
        "3. 熟悉 Spring Boot、MySQL、Redis\n"
        "4. 良好的沟通能力和团队协作精神\n"
        "5. 有大规模分布式系统开发经验者优先\n"
    )
    assert _looks_like_jd(text) is True


def test_looks_like_jd_false_short():
    assert _looks_like_jd("帮我优化简历") is False


def test_looks_like_jd_false_no_features():
    text = "这是一段很长的文本" * 50
    assert _looks_like_jd(text) is False


def test_fact_guard_shows_whitelist():
    """专名违规时失败消息应包含可用白名单摘要。"""
    violations = ["无来源专名「字节跳动」"]
    whitelist = FactWhitelist(
        numbers=set(),
        tech_tokens={"python", "mysql"},
        proper_nouns={"腾讯", "华南理工大学"},
        time_ranges={"2024.06 - 2024.12"},
    )
    result = _fact_guard_failure("optimize_resume_data", violations, whitelist)
    summary = result["summary"]
    assert "可用专名" in summary
    assert "腾讯" in summary
    assert "可用时间段" in summary


def test_fact_guard_no_whitelist_still_works():
    """没有白名单时 fact-guard 正常工作。"""
    violations = ["无来源专名「字节跳动」"]
    result = _fact_guard_failure("optimize_resume_data", violations)
    assert result["status"] == "failed"
    assert "字节跳动" in result["summary"]


# ── 防线1: 程度词阶梯检测测试 ─────────────────────────────────────────────────

from app.student.agent_runtime import _check_role_escalation


def test_role_escalation_participation_to_lead_blocked():
    """「参与」→「主导」应被拦截。"""
    args = {
        "experience": [
            {
                "company": "腾讯",
                "details": "- 主导后端服务架构设计，带领 3 人小组完成重构",
            }
        ],
    }
    violations = _check_role_escalation(args, [PROFILE])
    assert len(violations) == 1
    assert "主导" in violations[0]
    assert "参与" in violations[0]


def test_role_escalation_same_level_allowed():
    """相同等级的角色词应通过。"""
    args = {
        "experience": [
            {
                "company": "腾讯",
                "details": "- 参与后端服务开发，优化接口性能",
            }
        ],
    }
    violations = _check_role_escalation(args, [PROFILE])
    assert violations == []


def test_role_escalation_downgrade_allowed():
    """降级使用角色词应通过（如「主导」→「参与」）。"""
    PROFILE_WITH_LEAD = {
        "work_experiences": [
            {
                "company": "阿里巴巴",
                "position": "前端开发",
                "description": "- 主导电商平台前端重构",
            }
        ],
    }
    args = {
        "experience": [
            {
                "company": "阿里巴巴",
                "details": "- 参与电商平台前端开发",
            }
        ],
    }
    violations = _check_role_escalation(args, [PROFILE_WITH_LEAD])
    assert violations == []


def test_role_escalation_independent_blocked():
    """「参与」→「独立完成」应被拦截。"""
    args = {
        "projects": [
            {
                "name": "合同审查助手",
                "details": "- 独立完成合同审查助手的全栈开发",
            }
        ],
    }
    violations = _check_role_escalation(args, [DIRTY_PROFILE])
    assert len(violations) == 1
    assert "独立完成" in violations[0]


# ── 防线2: 条目归属校验测试 ─────────────────────────────────────────────────

from app.student.agent_runtime import _check_item_attribution


def test_attribution_cross_item_number_blocked():
    """把项目 A 的数字安到项目 B → 应被检测到。"""
    EVIDENCE = {
        "work_experiences": [
            {
                "company": "腾讯",
                "description": "- 优化接口性能，QPS 提升 30%",
            },
            {
                "company": "阿里巴巴",
                "description": "- 开发推荐系统，DAU 提升 50%",
            },
        ],
    }
    args = {
        "experience": [
            {
                "company": "腾讯",
                "details": "- 优化接口性能，DAU 提升 50%",  # 50% 是阿里巴巴的数字
            }
        ],
    }
    violations = _check_item_attribution(args, [EVIDENCE])
    assert any("50%" in v for v in violations)


def test_attribution_same_item_number_allowed():
    """同一段经历的数字应通过。"""
    args = {
        "experience": [
            {
                "company": "腾讯",
                "details": "- 优化接口性能，QPS 提升 30%",
            }
        ],
    }
    violations = _check_item_attribution(args, [PROFILE])
    assert violations == []


# ── 防线3: JD GAP 铁律测试 ─────────────────────────────────────────────────

from app.student.agent_runtime import _check_gap_violations


def test_gap_keyword_in_resume_blocked():
    """GAP 项出现在简历中应被拦截。"""
    args = {
        "skills": "Python, Java, Kubernetes, Elasticsearch",
        "experience": [
            {"details": "- 使用 Kubernetes 部署微服务"}
        ],
    }
    gap_keywords = ["Kubernetes", "Elasticsearch"]
    violations = _check_gap_violations(args, gap_keywords)
    assert len(violations) == 2
    assert any("Kubernetes" in v for v in violations)
    assert any("Elasticsearch" in v for v in violations)


def test_gap_keyword_not_in_resume_allowed():
    """GAP 项未出现在简历中应通过。"""
    args = {
        "skills": "Python, MySQL",
        "experience": [
            {"details": "- 使用 Python 开发后端服务"}
        ],
    }
    gap_keywords = ["Kubernetes", "Elasticsearch"]
    violations = _check_gap_violations(args, gap_keywords)
    assert violations == []


def test_no_gap_keywords_allowed():
    """没有 GAP 关键词时应通过。"""
    args = {"skills": "Python"}
    violations = _check_gap_violations(args, [])
    assert violations == []


# ── 集成测试 ─────────────────────────────────────────────────────────────────

def test_combined_defenses():
    """三道防线协同工作：程度词升级 + 条目归属 + GAP 铁律。"""
    EVIDENCE = {
        "work_experiences": [
            {
                "company": "腾讯",
                "position": "后端开发实习生",
                "start_date": "2024.06",
                "end_date": "2024.12",
                "description": "- 参与后端服务开发，优化接口性能，QPS 提升 30%",
            }
        ],
    }
    gap_keywords = ["Kubernetes", "Elasticsearch"]

    # 测试1：程度词升级应被拦截
    args1 = {
        "experience": [
            {
                "company": "腾讯",
                "details": "- 主导后端服务架构设计，QPS 提升 30%",
            }
        ],
    }
    violations1 = _check_role_escalation(args1, [EVIDENCE])
    assert len(violations1) == 1
    assert "主导" in violations1[0]

    # 测试2：GAP 项应被拦截
    args2 = {
        "skills": "Python, Kubernetes",
        "experience": [
            {
                "company": "腾讯",
                "details": "- 参与后端服务开发，使用 Kubernetes 部署",
            }
        ],
    }
    violations2 = _check_gap_violations(args2, gap_keywords)
    assert len(violations2) == 1
    assert "Kubernetes" in violations2[0]

    # 测试3：正常内容应通过
    args3 = {
        "experience": [
            {
                "company": "腾讯",
                "details": "- 参与后端服务开发，优化接口性能，QPS 提升 30%",
            }
        ],
    }
    violations3 = _check_role_escalation(args3, [EVIDENCE])
    assert violations3 == []
    violations4 = _check_item_attribution(args3, [EVIDENCE])
    assert violations4 == []
