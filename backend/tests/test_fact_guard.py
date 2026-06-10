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
                "date": "2021.09 - 2025.06",
            }
        ],
        "experience": [
            {
                "company": "腾讯",
                "position": "后端开发实习生",
                "date": "2024.06 - 2024.12",
                "details": "- 优化接口性能，QPS 提升 30%（Python + MySQL）",
            }
        ],
    }
    assert _validate_resume_facts(args, [PROFILE]) == []


def test_fabricated_facts_are_blocked():
    args = {
        "experience": [
            {
                "company": "字节跳动",
                "position": "后端开发实习生",
                "date": "2024.06 - 2024.12",
                "details": "- 用 TerraformPro 重构服务，QPS 提升 300%",
            }
        ],
    }
    violations = _validate_resume_facts(args, [PROFILE])
    # 字节跳动不在证据中（证据里是腾讯），应被拦截——经历实体造假
    assert any("字节跳动" in v for v in violations), f"编造公司名应被拦截: {violations}"
    # 数字指标和技术词不再校验——AI 生成的是建议草稿，用户会编辑
    assert not any("300%" in v for v in violations), f"数字指标不应被拦截: {violations}"
    assert not any("TerraformPro" in v for v in violations), f"技术词不应被拦截: {violations}"


def test_fabricated_time_range_is_blocked():
    args = {
        "experience": [
            {"company": "腾讯", "date": "2019.01 - 2020.01", "details": "- 优化接口"}
        ],
    }
    violations = _validate_resume_facts(args, [PROFILE])
    assert any("2019.01" in v for v in violations)


def test_range_endpoints_accepted_from_evidence_range():
    """证据是整段（duration），模型输出单个端点也应通过。"""
    args = {
        "education": [
            {"school": "华南理工大学", "start_date": "2021.09", "end_date": "2025.06"}
        ],
    }
    assert _validate_resume_facts(args, [PROFILE]) == []


def test_mixed_date_format_detected():
    args = {
        "experience": [
            {"company": "腾讯", "date": "2022.06 - 2024-12", "details": "- 开发系统"}
        ],
    }
    quality = _check_resume_quality(args)
    assert any(e["section"] == "dates" for e in quality["errors"])


def test_uniform_date_format_with_birth_date_not_flagged():
    """schema 要求 birth_date 用 YYYY-MM、经历用 YYYY.MM，不应判为混用。"""
    args = {
        "basic": {"birth_date": "2003-05"},
        "experience": [
            {
                "company": "腾讯",
                "date": "2024.06 - 2024.12",
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
            "role": "独立开发",
            "start_date": "2026。01",
            "end_date": "2026.04",
            "description": "- 基于 Python 和 FastAPI 搭建",
        }
    ],
}


def test_dirty_profile_dates_normalized_output_passes():
    """档案时间格式脏（全角句号/短横线混用），模型统一为 YYYY.MM 输出必须通过。

    回归：此前时间逐字比对 + 质量闸门要求格式统一互相矛盾，
    模型怎么改都过不了，最终只能提交空白章节绕过校验。
    """
    args = {
        "education": [
            {"school": "厦门大学", "major": "软件工程", "degree": "本科",
             "date": "2023.09 - 2027.06"}
        ],
        "experience": [
            {"company": "某科技公司", "position": "Agent开发实习生",
             "date": "2026.03 - 2026.05",
             "details": "- 开发多Agent流程，接入 MCP 工具，完成 RAG 优化"}
        ],
        "projects": [
            {"name": "合同审查助手", "role": "独立开发",
             "date": "2026.01 - 2026.04",
             "details": "- 基于 Python 和 FastAPI 搭建"}
        ],
    }
    assert _validate_resume_facts(args, [DIRTY_PROFILE]) == []
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
    assert _validate_resume_facts(args, [DIRTY_PROFILE]) == []


def test_year_only_range_not_misdetected():
    """纯年份区间 "2023-2024" 不应被匹配成 YYYY-MM 分隔符。"""
    args = {
        "experience": [
            {"company": "腾讯", "date": "2024.06 - 2024.12", "details": "- 优化接口，QPS 提升 30%"},
            {"company": "腾讯", "date": "2023-2024", "details": "- 优化接口，QPS 提升 30%"},
        ],
    }
    quality = _check_resume_quality(args)
    assert not any(e["section"] == "dates" for e in quality["errors"])
