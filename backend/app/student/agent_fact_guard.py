"""Fact guard: evidence pool, whitelist, and resume fact validation.

Extracted from agent_runtime.py for focused responsibility.
"""
from __future__ import annotations

import logging
import re as _re
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ── Evidence pool ───────────────────────────────────────────────────────────

class SessionEvidencePool:
    """运行时事实证据池，绑定到一次 run_agent_loop 调用。"""

    def __init__(self) -> None:
        self.profile_snapshot: Optional[dict[str, Any]] = None
        self.read_resume_texts: list[dict[str, str]] = []
        self.attachment_texts: list[dict[str, str]] = []
        self.source_resume_jsons: list[dict[str, Any]] = []
        self.jd_text: Optional[str] = None
        self.jd_keywords: list[str] = []
        self.gap_keywords: list[str] = []

    def set_profile(self, profile: dict[str, Any]) -> None:
        self.profile_snapshot = profile

    def add_resume_texts(self, resumes: list[dict[str, str]]) -> None:
        for r in resumes:
            if r.get("excerpt") and r.get("name"):
                self.read_resume_texts.append(r)

    def add_attachment_text(self, name: str, text: str) -> None:
        if text and text.strip():
            self.attachment_texts.append({"name": name, "text": text[:12000]})

    def add_source_resume_json(self, resume_id: int, data_json: dict[str, Any]) -> None:
        self.source_resume_jsons.append({"resume_id": resume_id, "data_json": data_json})

    def set_jd(self, jd_text: str, keywords: list[str]) -> None:
        self.jd_text = jd_text
        self.jd_keywords = keywords

    def set_gap_keywords(self, gap_keywords: list[str]) -> None:
        self.gap_keywords = gap_keywords

    def collect_evidence_sources(self) -> list[Any]:
        sources: list[Any] = []
        if self.profile_snapshot:
            sources.append(self.profile_snapshot)
        for r in self.read_resume_texts:
            sources.append(r.get("excerpt", ""))
        for a in self.attachment_texts:
            sources.append(a.get("text", ""))
        for j in self.source_resume_jsons:
            sources.append(j.get("data_json", {}))
        return sources


# ── Fact whitelist ──────────────────────────────────────────────────────────

@dataclass
class FactWhitelist:
    numbers: set
    tech_tokens: set
    proper_nouns: set
    time_ranges: set


_STRONG_VERBS = frozenset({
    "主导", "设计", "实现", "优化", "搭建", "研发", "重构", "部署", "分析", "建立",
    "推动", "领导", "简化", "提升", "降低", "改善", "完成", "管理", "维护", "开发",
    "构建", "协调", "制定", "执行", "整合", "迁移", "扩展", "监控", "排查", "封装",
    "自动化", "benchmark", "architected", "designed", "implemented", "optimized",
    "built", "refactored", "deployed", "analyzed", "established",
})

_ROLE_ESCALATION_LADDER: dict[str, int] = {
    "协助": 1, "参与": 2, "负责": 3, "主导": 4,
    "独立完成": 5, "独立开发": 5, "从0到1搭建": 5, "从0到1": 5, "独自": 5,
}

_ROLE_VERB_RE = _re.compile(
    r"(协助|参与|负责|主导|独立完成|独立开发|从0到1搭建|从0到1|独自)[了着过]?"
)

_EMPTY_PHRASES = frozenset({
    "认真负责", "吃苦耐劳", "积极向上", "热爱学习", "团队合作精神",
    "良好的沟通能力", "较强的学习能力", "抗压能力强", "自我驱动力强",
    "workhardplayhard", "detailoriented", "teamplayer", "selfmotivated",
})

_WEAK_ITEM_RATIO_THRESHOLD = 0.6

_DATE_SEP = r"[.\-/。．]"
_RANGE_SEP = r"[-–—~～至]"
_TIME_RANGE_RE = _re.compile(
    rf"\d{{4}}{_DATE_SEP}\d{{1,2}}(?:\s*{_RANGE_SEP}\s*\d{{4}}{_DATE_SEP}\d{{1,2}})?"
)
_SINGLE_DATE_RE = _re.compile(rf"\d{{4}}{_DATE_SEP}\d{{1,2}}")


# ── Helpers ─────────────────────────────────────────────────────────────────

def _norm_time_token(value: str) -> str:
    value = _re.sub(r"\s+", "", value)
    return _re.sub(r"[-–—~～至。．/]", ".", value)


def _norm_token(s: str) -> str:
    return s.casefold().replace(" ", "").replace("\u3000", "")


def _flatten_dict_values(data: dict, target_key: str) -> list[Any]:
    results: list[Any] = []
    if isinstance(data, dict):
        for k, v in data.items():
            if k == target_key:
                results.append(v)
            elif isinstance(v, dict):
                results.extend(_flatten_dict_values(v, target_key))
            elif isinstance(v, list):
                for item in v:
                    if isinstance(item, dict):
                        results.extend(_flatten_dict_values(item, target_key))
    return results


def _collect_evidence_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        texts: list[str] = []
        for v in value.values():
            texts.extend(_collect_evidence_values(v))
        return texts
    if isinstance(value, list):
        texts = []
        for item in value:
            texts.extend(_collect_evidence_values(item))
        return texts
    return [str(value)] if value is not None else []


def _extract_fact_whitelist(evidence_sources: list[Any]) -> FactWhitelist:
    numbers: set[str] = set()
    tech_tokens: set[str] = set()
    proper_nouns: set[str] = set()
    time_ranges: set[str] = set()

    for source in evidence_sources:
        if isinstance(source, dict):
            for key in ("company", "school", "name", "position", "role", "major", "degree"):
                for item in _flatten_dict_values(source, key):
                    val = str(item).strip()
                    if val and len(val) >= 2:
                        proper_nouns.add(val)
            texts = _collect_evidence_values(source)
        else:
            texts = _collect_evidence_values(source)

        for text_item in texts:
            text = str(text_item)
            for m in _re.finditer(r"\d[\d.,]*\s*[%万亿千百十人个次台条项年月天KkMmBb]", text):
                numbers.add(m.group().strip())
            for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{1,}", text):
                word = m.group()
                if len(word) >= 2:
                    tech_tokens.add(word)
            for m in _TIME_RANGE_RE.finditer(text):
                time_ranges.add(m.group().strip())

    return FactWhitelist(
        numbers=numbers,
        tech_tokens={w for w in tech_tokens if len(w) >= 3 and w.lower() not in {"the", "and", "for", "with", "from"}},
        proper_nouns=proper_nouns,
        time_ranges=time_ranges,
    )


def _extract_candidate_facts(args: dict[str, Any]) -> FactWhitelist:
    numbers: set[str] = set()
    tech_tokens: set[str] = set()
    proper_nouns: set[str] = set()
    time_ranges: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, str):
            for m in _re.finditer(r"\d[\d.,]*\s*[%万亿千百十人个次台条项年月天KkMmBb]", value):
                numbers.add(m.group().strip())
            for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{1,}", value):
                word = m.group()
                if len(word) >= 2:
                    tech_tokens.add(word)
            for m in _TIME_RANGE_RE.finditer(value):
                time_ranges.add(m.group().strip())
        elif isinstance(value, dict):
            for k, v in value.items():
                if k in ("company", "school", "name", "position", "role", "major", "degree"):
                    val = str(v).strip()
                    if val and len(val) >= 2:
                        proper_nouns.add(val)
                walk(v)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(args)
    return FactWhitelist(
        numbers=numbers,
        tech_tokens={w for w in tech_tokens if len(w) >= 3},
        proper_nouns=proper_nouns,
        time_ranges=time_ranges,
    )


def _fact_values_from_args(args: dict[str, Any]) -> list[tuple[str, str]]:
    facts: list[tuple[str, str]] = []
    basic = args.get("basic") or {}
    if isinstance(basic, dict):
        for key in ("name", "email", "phone", "location", "birth_date", "birthDate"):
            if basic.get(key):
                facts.append((f"基本信息.{key}", str(basic[key])))
    for section in ("education", "experience", "projects"):
        items = args.get(section)
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            for key, value in item.items():
                if key in {"id", "visible", "link", "linkLabel"} or value in (None, "", False):
                    continue
                lines = str(value).splitlines() if key in {"description", "details"} else [str(value)]
                facts.extend((f"{section}[{index}].{key}", line.strip()) for line in lines if line.strip())
    for key in ("skills", "self_evaluation"):
        value = args.get(key)
        if value:
            facts.extend((key, line.strip()) for line in str(value).splitlines() if line.strip())
    return facts


# ── Core validation ─────────────────────────────────────────────────────────

FACT_GUARD_SHADOW_MODE = False
ITEM_ATTRIBUTION_SHADOW_MODE = True


def _validate_resume_facts(args: dict[str, Any], evidence_sources: list[Any]) -> tuple[list[str], FactWhitelist]:
    whitelist = _extract_fact_whitelist(evidence_sources)
    candidate = _extract_candidate_facts(args)

    _evidence_text_blob = " ".join(str(s) for s in evidence_sources if isinstance(s, str))
    for _src in evidence_sources:
        if isinstance(_src, dict):
            _evidence_text_blob += " " + " ".join(str(v) for v in _collect_evidence_values(_src))

    basic = args.get("basic") or {}
    if isinstance(basic, dict):
        _BASIC_EXEMPT_KEYS = {"name", "email", "phone", "location", "birth_date", "birthDate"}
        for key in _BASIC_EXEMPT_KEYS:
            val = str(basic.get(key) or "").strip()
            if not val:
                continue
            if key in ("birth_date", "birthDate"):
                for m in _TIME_RANGE_RE.finditer(val):
                    whitelist.time_ranges.add(m.group().strip())
                for m in _SINGLE_DATE_RE.findall(val):
                    whitelist.time_ranges.add(m)
                continue
            if val in _evidence_text_blob:
                whitelist.proper_nouns.add(val)

    norm_nouns = {_norm_token(n) for n in whitelist.proper_nouns}
    norm_times: set[str] = set()
    for t in whitelist.time_ranges:
        norm_times.add(_norm_time_token(t))
        for endpoint in _SINGLE_DATE_RE.findall(t):
            norm_times.add(_norm_time_token(endpoint))

    violations: list[str] = []

    for noun in candidate.proper_nouns:
        if _norm_token(noun) not in norm_nouns:
            violations.append(f"无来源专名「{noun}」")

    for tr in candidate.time_ranges:
        if _norm_time_token(tr) in norm_times:
            continue
        endpoints = _SINGLE_DATE_RE.findall(tr)
        if endpoints and all(_norm_time_token(p) in norm_times for p in endpoints):
            continue
        violations.append(f"无来源时间段「{tr}」")

    _desc_suspicious: list[str] = []
    for path, raw_value in _fact_values_from_args(args):
        if ".description" not in path and ".details" not in path:
            continue
        for m in _re.finditer(r"[一-鿿]{3,8}", raw_value):
            word = m.group()
            if _norm_token(word) not in norm_nouns and len(word) >= 4:
                if any(word.endswith(s) for s in ("大学", "学院", "公司", "集团", "科技", "有限")):
                    _desc_suspicious.append(word)
    if _desc_suspicious:
        whitelist._desc_suspicious = list(set(_desc_suspicious))[:10]  # type: ignore[attr-defined]

    return violations[:20], whitelist


def _fact_guard_failure(tool: str, violations: list[str], whitelist: Optional[FactWhitelist] = None) -> dict[str, Any]:
    preview = "；".join(violations[:6])
    if FACT_GUARD_SHADOW_MODE:
        logger.warning("fact_guard shadow_mode violation tool=%s violations=%s", tool, violations[:10])
        return {
            "status": "completed",
            "tool": tool,
            "summary": f"（shadow mode）事实校验发现以下内容缺少依据，但未拦截：{preview}",
            "fact_validation": {"passed": True, "shadow_violations": violations[:20]},
        }
    n = len(violations)
    examples = []
    for v in violations[:2]:
        if "「" in v and "」" in v:
            examples.append(v[v.index("「")+1:v.index("」")])
    example_text = "、".join(f"「{e}」" for e in examples) if examples else ""
    suffix = f"（如{example_text}等 {n} 处）" if example_text else f"（共 {n} 处）"
    whitelist_hint = ""
    if whitelist:
        avail_nouns = sorted(whitelist.proper_nouns)[:10]
        avail_times = sorted(whitelist.time_ranges)[:6]
        if avail_nouns:
            whitelist_hint += f"\n可用专名：{'、'.join(avail_nouns)}等 {len(whitelist.proper_nouns)} 个。"
        if avail_times:
            whitelist_hint += f"\n可用时间段：{'、'.join(avail_times)}等 {len(whitelist.time_ranges)} 段。"
        if whitelist_hint:
            whitelist_hint += "\n请确保输出中的专名和时间段在以上白名单内。"
        desc_sus = getattr(whitelist, "_desc_suspicious", None)
        if desc_sus:
            whitelist_hint += (
                f"\n⚠️ 以下词出现在经历描述中但不在白名单，请核实是否属实：{'、'.join(desc_sus[:6])}。"
                f"若属实请补充到档案中，若不属实请删除。"
            )

    return {
        "status": "failed",
        "tool": tool,
        "summary": f"事实校验未通过{suffix}：{preview}。请基于个人档案和已有简历中的真实信息修改，不要编造新的公司名、学校名、项目名或时间段。{whitelist_hint}",
        "display_summary": f"事实校验未通过（{n} 处）",
        "fact_validation": {"passed": False, "violations": violations[:20]},
    }
