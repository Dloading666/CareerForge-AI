"""Fact guard: evidence pool, whitelist, and resume fact validation.

Extracted from agent_runtime.py for focused responsibility.
"""
from __future__ import annotations

import json
import logging
import re as _re
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ── Evidence source index ───────────────────────────────────────────────────
#
# 证据池（SessionEvidencePool）绑定到单次 run_agent_loop，跨轮时会丢失上一轮
# 读到的简历全文、附件文本和 GAP 关键词。EvidenceSourceIndex 是一份轻量元数据
# 索引（不含全文），持久化到 session.evidence_index_json，下一轮恢复后用于：
#   1) 懒重读——索引记录已读 resume_id，调用方据此决定是否重新 read_resume；
#   2) GAP 关键词跨轮——JD 分析的 GAP 结果不因换轮而丢，避免下轮误放回简历；
#   3) 避免重复分析——附件已分析的标记防止重复 OCR。


@dataclass
class EvidenceSourceIndex:
    """跨轮持久化的证据来源元数据索引。"""

    has_profile: bool = False
    resume_ids_read: list[int] = field(default_factory=list)
    attachment_ids_analyzed: list[int] = field(default_factory=list)
    gap_keywords: list[str] = field(default_factory=list)
    has_jd_analysis: bool = False

    def to_json(self) -> str:
        """序列化为 JSON 字符串（用于持久化到 session）。"""
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, raw: Optional[str]) -> "EvidenceSourceIndex":
        """从 JSON 字符串恢复；空或损坏输入安全降级为空索引。"""
        if not raw:
            return cls()
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                return cls()
            return cls(
                has_profile=bool(data.get("has_profile")),
                resume_ids_read=[int(x) for x in (data.get("resume_ids_read") or []) if str(x).lstrip("-").isdigit() and int(x) > 0],
                attachment_ids_analyzed=[int(x) for x in (data.get("attachment_ids_analyzed") or []) if str(x).lstrip("-").isdigit() and int(x) > 0],
                gap_keywords=[str(x) for x in (data.get("gap_keywords") or [])],
                has_jd_analysis=bool(data.get("has_jd_analysis")),
            )
        except (json.JSONDecodeError, TypeError, ValueError):
            logger.warning("evidence_index_json corrupt, falling back to empty index")
            return cls()


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
        # 已恢复的来源索引（跨轮懒重读依据）
        self.restored_index: Optional[EvidenceSourceIndex] = None

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

    # ── 跨轮索引：持久化 / 恢复 ──────────────────────────────────────────────

    def build_source_index(self, *, resume_ids_read: Optional[list[int]] = None) -> EvidenceSourceIndex:
        """从当前证据快照构建可持久化的来源索引。

        resume_ids_read 由调用方传入（工具执行时记录），因为本池只存文本
        摘要、不存 resume_id。若不传且已恢复过索引，则沿用恢复值。
        """
        if resume_ids_read is None:
            resume_ids_read = list(self.restored_index.resume_ids_read) if self.restored_index else []
        else:
            if self.restored_index:
                # 合并历史已读 id，去重保序
                seen = set(resume_ids_read)
                for rid in self.restored_index.resume_ids_read:
                    if rid not in seen:
                        resume_ids_read.append(rid)
                        seen.add(rid)
        gap = list(self.gap_keywords)
        if self.restored_index:
            for kw in self.restored_index.gap_keywords:
                if kw not in gap:
                    gap.append(kw)
        return EvidenceSourceIndex(
            has_profile=self.profile_snapshot is not None or (self.restored_index.has_profile if self.restored_index else False),
            resume_ids_read=resume_ids_read,
            attachment_ids_analyzed=list(self.restored_index.attachment_ids_analyzed) if self.restored_index else [],
            gap_keywords=gap,
            has_jd_analysis=bool(self.jd_text) or (self.restored_index.has_jd_analysis if self.restored_index else False),
        )

    def restore_source_index(self, index: EvidenceSourceIndex) -> None:
        """恢复跨轮索引：主要恢复 GAP 关键词（防止下轮误把 GAP 项写回简历）。

        注意：本方法只恢复元数据，不恢复全文——全文需调用方按 resume_ids_read
        触发懒重读（read_resume），这样既避免无谓地把 8000 字简历灌进上下文，
        又保证事实校验在真正改简历时拿得到最新版本（配合版本检查更安全）。
        """
        self.restored_index = index
        # GAP 关键词跨轮恢复：JD 分析结果不应因换轮丢失
        if index.gap_keywords and not self.gap_keywords:
            self.gap_keywords = list(index.gap_keywords)


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
    "协助": 1, "参与": 2, "负责": 2, "主导": 4,
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


# 子串匹配容差（P1.3）：档案写「腾讯科技」、模型输出「腾讯」不应误拦。
# 规则：
# - 精确命中白名单 → 通过；
# - 候选是中文专名（≥2 个汉字）且是某白名单词的子串 → 通过（腾讯 ← 腾讯科技）；
# - 某白名单词是候选的子串 → 通过（腾讯科技 ← 腾讯，白名单更长）；
# - 英文专名不做子串匹配（短词如 AI/Go 做子串误放面太大），仍走精确。
_SUBSTR_MIN_CN_LEN = 2  # 中文子串匹配的最小候选长度
_CN_CHAR_RE = _re.compile(r"[一-鿿]")


def _is_chinese_noun(norm: str) -> bool:
    """归一化后的专名是否主要由汉字构成（用于决定是否启用子串容差）。"""
    return bool(_CN_CHAR_RE.search(norm))


def _noun_has_source(candidate_norm: str, whitelist_norms: set[str]) -> bool:
    """候选专名是否有证据来源（精确或双向子串匹配）。"""
    if not candidate_norm:
        return True
    if candidate_norm in whitelist_norms:
        return True
    # 仅对中文专名启用子串容差，且候选需达到最小长度
    if not _is_chinese_noun(candidate_norm) or len(candidate_norm) < _SUBSTR_MIN_CN_LEN:
        return False
    for wn in whitelist_norms:
        if not _is_chinese_noun(wn) or len(wn) < _SUBSTR_MIN_CN_LEN:
            continue
        # 候选 ⊆ 白名单（腾讯 是 腾讯科技 的子串）
        if candidate_norm in wn:
            return True
        # 白名单 ⊆ 候选（腾讯科技 包含 腾讯）
        if wn in candidate_norm:
            return True
    return False


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
        # P1.3: 中文专名启用双向子串匹配容差（腾讯 ↔ 腾讯科技），英文仍精确。
        if not _noun_has_source(_norm_token(noun), norm_nouns):
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
            # P1.3: 子串容差同样适用于描述正文里的疑似专名
            if not _noun_has_source(_norm_token(word), norm_nouns) and len(word) >= 4:
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
        "error_code": "fact_guard_retry",
        "recoverable": True,
        "summary": f"事实校验未通过{suffix}：{preview}。请基于个人档案和已有简历中的真实信息修改，不要编造新的公司名、学校名、项目名或时间段。{whitelist_hint}",
        "display_summary": f"简历里有 {n} 处对不上档案，正在帮你核实修正",
        "fact_validation": {"passed": False, "violations": violations[:20]},
    }


# ── Evidence quality assessment ─────────────────────────────────────────────

_JD_HINT_CJK = frozenset({
    "岗位职责", "任职要求", "职位描述", "学历要求", "工作经验",
    "技能要求", "岗位要求", "工作职责", "任职资格", "岗位说明",
})


def _assess_evidence_quality(evidence_sources: list[Any]) -> dict[str, Any]:
    """评估证据池中各条目的充实度。返回质量报告。"""
    total_items = 0
    weak_items = 0
    has_quantified = False

    for source in evidence_sources:
        if not isinstance(source, dict):
            continue
        for section in ("work_experiences", "experience", "projects"):
            items = source.get(section) or []
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                total_items += 1
                desc = str(item.get("description") or item.get("details") or "")
                if _re.search(r"\d+", desc):
                    has_quantified = True
                else:
                    weak_items += 1

    weak_ratio = weak_items / max(total_items, 1)
    if total_items == 0:
        quality = "insufficient"
    elif weak_ratio > _WEAK_ITEM_RATIO_THRESHOLD:
        quality = "insufficient"
    elif weak_ratio > 0.3:
        quality = "acceptable"
    else:
        quality = "good"

    suggestions: list[str] = []
    if total_items == 0:
        suggestions.append("当前无经历/项目条目，素材不足。请向学生追问其工作经历、实习经历或项目经历后再生成简历。")
    elif weak_ratio > _WEAK_ITEM_RATIO_THRESHOLD:
        suggestions.append(
            "当前经历/项目描述中缺少量化数据。请向学生追问：\n"
            "- 该项目服务多少用户？上线后有什么可量化的效果？\n"
            "- 团队几个人？你的角色是什么？\n"
            "- 有没有具体的数字可以补充？"
        )
    if not has_quantified and total_items > 0:
        suggestions.append("没有任何经历包含数字指标。建议引导学生补充量化成果。")

    return {
        "quality": quality,
        "total_items": total_items,
        "weak_items": weak_items,
        "weak_ratio": round(weak_ratio, 2),
        "has_quantified": has_quantified,
        "suggestions": suggestions,
    }


# ── Quality gate ────────────────────────────────────────────────────────────

def _check_resume_quality(args: dict[str, Any], *, require_sections: bool = False) -> dict[str, Any]:
    """确定性质量检查（纯代码，不依赖 LLM）。"""
    issues: list[dict[str, str]] = []

    if require_sections:
        has_education = bool(args.get("education") and isinstance(args["education"], list) and len(args["education"]) > 0)
        has_experience = bool(args.get("experience") and isinstance(args["experience"], list) and len(args["experience"]) > 0)
        has_projects = bool(args.get("projects") and isinstance(args["projects"], list) and len(args["projects"]) > 0)
        if not has_education and not has_experience and not has_projects:
            issues.append({"severity": "error", "section": "resume", "issue": "教育经历、工作经历和项目经历全部为空，至少需要填写一项内容板块"})

    for section in ("experience", "projects"):
        items = args.get(section) or []
        if not isinstance(items, list):
            continue
        for idx, item in enumerate(items, 1):
            if not isinstance(item, dict):
                continue
            details = str(item.get("details") or item.get("description") or "")
            bullets = [ln.strip() for ln in details.splitlines() if ln.strip() and ln.strip().startswith(("-", "•", "*"))]
            if not bullets:
                bullets = [ln.strip() for ln in details.splitlines() if ln.strip()]

            strong_verb_count = 0
            has_number_count = 0
            for bullet in bullets:
                if any(bullet.lstrip("-•* ").startswith(v) for v in _STRONG_VERBS):
                    strong_verb_count += 1
                if _re.search(r"\d+", bullet):
                    has_number_count += 1
                if len(bullet) > 80:
                    issues.append({"severity": "warning", "section": f"{section}[{idx}]", "issue": f"bullet 过长（{len(bullet)} 字，建议 ≤ 80）"})

            if bullets:
                verb_ratio = strong_verb_count / len(bullets)
                if verb_ratio < 0.7:
                    issues.append({"severity": "warning", "section": f"{section}[{idx}]", "issue": f"强动词开头率 {verb_ratio:.0%}（建议 ≥ 70%）"})
                num_ratio = has_number_count / len(bullets)
                if num_ratio < 0.3:
                    issues.append({"severity": "warning", "section": f"{section}[{idx}]", "issue": f"含数字条目占比 {num_ratio:.0%}（建议 ≥ 30%）"})

    self_eval = str(args.get("self_evaluation") or "")
    if self_eval:
        eval_normalized = _re.sub(r"[\W_]+", "", self_eval, flags=_re.UNICODE).lower()
        for phrase in _EMPTY_PHRASES:
            if phrase in eval_normalized:
                issues.append({"severity": "error", "section": "self_evaluation", "issue": f"含空话「{phrase}」，请用具体能力或成果替代"})
        eval_sentences = [s.strip() for s in self_eval.replace("。", "\n").replace("；", "\n").splitlines() if s.strip()]
        if len(eval_sentences) > 5:
            issues.append({"severity": "warning", "section": "self_evaluation", "issue": f"自我评价 {len(eval_sentences)} 句（建议 2-4 句）"})

    all_dates: list[str] = []
    for section in ("education", "experience", "projects"):
        items = args.get(section) or []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            for key in ("date", "start_date", "end_date", "startDate", "endDate"):
                val = item.get(key)
                if val:
                    all_dates.append(str(val))
    if all_dates:
        invalid_tokens: list[str] = []
        for d in all_dates:
            for m in _re.finditer(r"\d{4}[.\-/年。．]\d{1,2}(?:[.\-/月。．]\d{1,2})?", d):
                token = m.group()
                if not _re.fullmatch(r"\d{4}-\d{2}", token):
                    invalid_tokens.append(token)
        if invalid_tokens:
            preview = "、".join(invalid_tokens[:5])
            issues.append({"severity": "error", "section": "dates", "issue": f"时间格式需统一为 YYYY-MM，不保留具体日期：{preview}"})

    errors = [i for i in issues if i["severity"] == "error"]
    warnings = [i for i in issues if i["severity"] == "warning"]

    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "total_issues": len(issues),
    }


# ── Role escalation check ───────────────────────────────────────────────────

def _check_role_escalation(args: dict[str, Any], evidence_sources: list[Any]) -> list[str]:
    """程度词阶梯检测：防止「参与」→「主导」的角色升级造假。"""
    violations: list[str] = []
    evidence_roles: dict[tuple[str, str], int] = {}

    for source in evidence_sources:
        if not isinstance(source, dict):
            continue
        for exp in (source.get("work_experiences") or source.get("experience") or []):
            if not isinstance(exp, dict):
                continue
            company = str(exp.get("company") or "").strip()
            desc = str(exp.get("description") or exp.get("details") or "")
            max_level = 0
            for m in _ROLE_VERB_RE.finditer(desc):
                verb = m.group(1)
                level = _ROLE_ESCALATION_LADDER.get(verb, 0)
                max_level = max(max_level, level)
            if max_level == 0:
                max_level = _ROLE_ESCALATION_LADDER["参与"]
            if company:
                evidence_roles[("exp", company)] = max_level

        for proj in (source.get("projects") or []):
            if not isinstance(proj, dict):
                continue
            proj_name = str(proj.get("name") or "").strip()
            role_field = str(proj.get("role") or "").strip()
            desc = str(proj.get("description") or proj.get("details") or "")
            max_level = 0
            for m in _ROLE_VERB_RE.finditer(desc):
                verb = m.group(1)
                level = _ROLE_ESCALATION_LADDER.get(verb, 0)
                max_level = max(max_level, level)
            if role_field:
                if role_field in _ROLE_ESCALATION_LADDER:
                    max_level = max(max_level, _ROLE_ESCALATION_LADDER[role_field])
                else:
                    max_level = max(max_level, _ROLE_ESCALATION_LADDER["独立完成"])
            if max_level == 0:
                max_level = _ROLE_ESCALATION_LADDER["参与"]
            if proj_name:
                evidence_roles[("proj", proj_name)] = max_level

    for section, section_type in [("experience", "exp"), ("projects", "proj")]:
        items = args.get(section) or []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if section_type == "exp":
                name = str(item.get("company") or "").strip()
            else:
                name = str(item.get("name") or item.get("project") or "").strip()

            details = str(item.get("details") or item.get("description") or "")

            generated_level = 0
            matched_verb = ""
            for m in _ROLE_VERB_RE.finditer(details):
                verb = m.group(1)
                level = _ROLE_ESCALATION_LADDER.get(verb, 0)
                if level > generated_level:
                    generated_level = level
                    matched_verb = verb

            if not matched_verb or not name:
                continue

            evidence_key = (section_type, name)
            evidence_level = evidence_roles.get(evidence_key)

            if evidence_level is None:
                continue

            if generated_level > evidence_level:
                evidence_verb = next(
                    (v for v, l in _ROLE_ESCALATION_LADDER.items() if l == evidence_level),
                    "参与"
                )
                violations.append(
                    f"角色升级：「{name}」的档案角色是「{evidence_verb}」，不得写成「{matched_verb}」"
                )

    return violations


# ── Item attribution check ──────────────────────────────────────────────────

def _check_item_attribution(args: dict[str, Any], evidence_sources: list[Any]) -> list[str]:
    """条目归属校验：防止把项目 A 的数字安到项目 B 头上。"""
    violations: list[str] = []
    item_evidence: dict[tuple[str, str], dict[str, set[str]]] = {}

    for source in evidence_sources:
        if not isinstance(source, dict):
            continue

        for exp in (source.get("work_experiences") or source.get("experience") or []):
            if not isinstance(exp, dict):
                continue
            company = str(exp.get("company") or "").strip()
            if not company:
                continue
            desc = str(exp.get("description") or exp.get("details") or "")
            key = ("exp", company)
            if key not in item_evidence:
                item_evidence[key] = {"numbers": set(), "nouns": set()}
            for m in _re.finditer(r"\d[\d.,]*\s*[%万亿千百十人个次台条项年月天KkMmBb]", desc):
                item_evidence[key]["numbers"].add(m.group().strip())
            for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{2,}", desc):
                item_evidence[key]["nouns"].add(m.group().lower())

        for proj in (source.get("projects") or []):
            if not isinstance(proj, dict):
                continue
            proj_name = str(proj.get("name") or "").strip()
            if not proj_name:
                continue
            desc = str(proj.get("description") or proj.get("details") or "")
            key = ("proj", proj_name)
            if key not in item_evidence:
                item_evidence[key] = {"numbers": set(), "nouns": set()}
            for m in _re.finditer(r"\d[\d.,]*\s*[%万亿千百十人个次台条项年月天KkMmBb]", desc):
                item_evidence[key]["numbers"].add(m.group().strip())
            for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{2,}", desc):
                item_evidence[key]["nouns"].add(m.group().lower())

    for section, section_type in [("experience", "exp"), ("projects", "proj")]:
        items = args.get(section) or []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if section_type == "exp":
                name = str(item.get("company") or "").strip()
            else:
                name = str(item.get("name") or item.get("project") or "").strip()
            if not name:
                continue

            details = str(item.get("details") or item.get("description") or "")
            key = (section_type, name)
            local_evidence = item_evidence.get(key)

            if not local_evidence:
                continue

            for m in _re.finditer(r"\d[\d.,]*\s*[%万亿千百十人个次台条项年月天KkMmBb]", details):
                num = m.group().strip()
                if num not in local_evidence["numbers"]:
                    violations.append(f"条目归属：数字「{num}」不属于「{name}」的证据，可能是张冠李戴")

            _GENERIC_TECH = {"python", "java", "javascript", "typescript", "react", "vue", "node", "sql", "html", "css", "git", "docker", "linux", "api", "http", "rest", "json"}
            global_nouns: set[str] = set()
            for ev in item_evidence.values():
                global_nouns |= ev["nouns"]
            for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{3,}", details):
                word = m.group().lower()
                if word in _GENERIC_TECH:
                    continue
                if word not in local_evidence["nouns"] and word not in global_nouns:
                    violations.append(f"条目归属：技术词「{m.group()}」不属于「{name}」的证据，可能是张冠李戴")

    return violations[:20]


# ── Gap violations check ────────────────────────────────────────────────────

def _check_gap_violations(args: dict[str, Any], gap_keywords: list[str]) -> list[str]:
    """检查生成内容是否包含 JD GAP 关键词。"""
    if not gap_keywords:
        return []

    violations: list[str] = []
    resume_text_parts: list[str] = []
    for section in ("skills", "self_evaluation"):
        val = args.get(section)
        if val:
            resume_text_parts.append(str(val))

    for section in ("education", "experience", "projects"):
        items = args.get(section) or []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            for key in ("details", "description"):
                val = item.get(key)
                if val:
                    resume_text_parts.append(str(val))

    resume_text = " ".join(resume_text_parts).lower()

    for keyword in gap_keywords:
        kw_lower = keyword.lower()
        if kw_lower in resume_text:
            violations.append(f"GAP 项「{keyword}」不应出现在简历中（档案中没有相关依据）")

    return violations[:10]


# ── JD coverage check ───────────────────────────────────────────────────────

def _extract_keywords_from_text(text: str) -> set[str]:
    """从文本中提取关键词集合：英文技术词（≥3字符）+ 中文词（≥2字）。"""
    keywords: set[str] = set()
    for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{2,}", text):
        word = m.group()
        keywords.add(word.lower())
    for m in _re.finditer(r"[一-鿿]{2,6}", text):
        keywords.add(m.group())
    return keywords


def _check_jd_coverage(args: dict[str, Any], jd_text: str) -> dict[str, Any]:
    """确定性 JD 关键词覆盖率检查（纯代码，不依赖 LLM）。"""
    jd_keywords = _extract_keywords_from_text(jd_text)
    jd_keywords -= _JD_HINT_CJK
    jd_keywords = {k for k in jd_keywords if len(k) >= 3 or (len(k) >= 2 and _re.search(r"[A-Za-z]", k))}
    if len(jd_keywords) > 30:
        en_words = {k for k in jd_keywords if _re.search(r"[A-Za-z]", k)}
        cn_words = {k for k in jd_keywords if not _re.search(r"[A-Za-z]", k)}
        cn_sorted = sorted(cn_words, key=len, reverse=True)
        jd_keywords = en_words | set(cn_sorted[: max(0, 30 - len(en_words))])

    if not jd_keywords:
        return {"passed": True, "coverage_ratio": 1.0, "matched": [], "missing": [], "note": "JD 中未提取到有效关键词"}

    resume_text_parts: list[str] = []
    resume_text_parts.append(str(args.get("skills") or ""))
    resume_text_parts.append(str(args.get("self_evaluation") or ""))
    for section in ("experience", "projects", "education"):
        items = args.get(section) or []
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    for key in ("details", "description", "position", "company", "school", "name"):
                        val = item.get(key)
                        if val:
                            resume_text_parts.append(str(val))

    resume_text = " ".join(resume_text_parts)
    resume_keywords = _extract_keywords_from_text(resume_text)

    matched = jd_keywords & resume_keywords
    missing = jd_keywords - resume_keywords
    coverage_ratio = len(matched) / len(jd_keywords) if jd_keywords else 1.0

    result: dict[str, Any] = {
        "passed": coverage_ratio >= 0.15,
        "coverage_ratio": round(coverage_ratio, 3),
        "matched": sorted(matched)[:15],
        "missing": sorted(missing)[:15],
        "total_jd_keywords": len(jd_keywords),
        "total_matched": len(matched),
    }

    if coverage_ratio < 0.15:
        result["severity"] = "error"
        result["note"] = f"JD 关键词覆盖率 {coverage_ratio:.0%} 过低，简历未能覆盖岗位核心要求。"
    elif coverage_ratio < 0.3:
        result["severity"] = "warning"
        result["note"] = f"JD 关键词覆盖率 {coverage_ratio:.0%} 偏低，建议补充更多岗位相关关键词。"
    else:
        result["severity"] = "ok"

    return result


# _normalize_evidence was previously referenced from agent_runtime.py but is now
# inlined where needed (strips non-word chars for phrase matching).
