from __future__ import annotations

import json
import re
from typing import Any


def extract_keywords_from_text(text: str) -> list[str]:
    parts = re.split(r"[，,、。；;：:（）()\s/]+", text)
    return [p.strip() for p in parts if len(p.strip()) >= 2][:8]


# 简历章节标题：本身只是分类标签，不包含具体项目/经历名称
_SECTION_HEADER_PATTERNS = [
    r"^(#{1,4}\s*)?(项目经历|项目经验|工作经历|实习经历|在校经历|校园经历|教育背景|专业技能|技术栈|个人技能|技能|个人总结|自我介绍|自我评价|求职意向|获奖荣誉|证书资质|语言能力|基本信息|联系方式)[：:]?\s*$",
    r"^(#{1,4}\s*)?(PROJECTS?|EXPERIENCE|EDUCATION|SKILLS?|SUMMARY|PROFILE|CONTACT)[\s:：]*$",
]

# 简历中表示具体项目/经历的行通常包含这些特征词
_PROJECT_LINE_KEYWORDS = (
    "项目", "经历", "实习", "公司", "技术", "负责", "开发", "系统", "平台", "模块",
    "Agent", "RAG", "Redis", "Spring", "Kafka", "Docker", "MySQL",
    "构建", "设计", "实现", "优化", "架构", "重构", "部署", "上线",
)

# 个人特质/品质类描述词——不是具体项目经历，不应作为面试锚点
_TRAIT_PATTERNS = [
    r"^(学习|沟通|协作|表达|组织|领导|抗压|执行|创新|解决问题|时间管理|自我驱动|逻辑思维|批判性)(能力|热情|精神|兴趣|态度)",
    r"^(技术前瞻|技术视野|技术热情|职业规划|职业目标|兴趣爱好|个人特长|自我评价|自我介绍|个人总结|综合素质|性格特点)",
    r"^(团队|责任心|自驱|上进|进取|好学|踏实|认真|细致|严谨|诚信|正直)",
]


def _is_personal_trait_line(text: str) -> bool:
    """判断一行文本是否为个人特质/品质描述，而非具体项目经历。"""
    stripped = text.strip(" -•\t")
    return any(re.match(p, stripped) for p in _TRAIT_PATTERNS)




def _is_section_header(text: str) -> bool:
    """判断一行文本是否只是简历章节标题，不含具体内容。"""
    stripped = text.strip(" -•\t#")
    if len(stripped) > 15:  # 章节标题通常很短
        return False
    for pattern in _SECTION_HEADER_PATTERNS:
        if re.match(pattern, text, re.IGNORECASE):
            return True
    return False


def is_contact_or_intent_line(text: str) -> bool:
    """联系方式、邮箱、求职意向等简历头部信息不能作为首问项目锚点。"""
    lowered = text.lower()
    # 章节标题也需要被过滤（由调用方通过 _is_section_header 处理）
    has_contact_label = any(label in text for label in ("电话", "手机", "微信", "邮箱", "联系方式", "求职意向"))
    has_phone = bool(re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", text))
    has_email = bool(re.search(r"[\w.+-]+@[\w.-]+\.\w+", lowered))
    return has_contact_label or has_phone or has_email


def extract_resume_anchors(resume_snapshot: str) -> list[dict[str, Any]]:
    text = (resume_snapshot or "").strip()
    if not text or "暂未" in text:
        return []

    anchors: list[dict[str, Any]] = []
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            for proj in (data.get("projects") or data.get("project") or [])[:5]:
                if not isinstance(proj, dict):
                    continue
                name = str(proj.get("name") or proj.get("title") or "").strip()
                desc = str(proj.get("description") or proj.get("detail") or proj.get("responsibility") or "").strip()
                tech = proj.get("tech_stack") or proj.get("technologies") or []
                keywords = [name] + (tech if isinstance(tech, list) else [str(tech)]) + extract_keywords_from_text(desc)
                if name or desc:
                    anchors.append({"type": "project", "name": name or desc[:40], "evidence": desc[:120], "keywords": [k for k in keywords if k][:8]})
            for work in (data.get("work_experience") or data.get("experience") or data.get("internships") or [])[:3]:
                if not isinstance(work, dict):
                    continue
                company = str(work.get("company") or work.get("organization") or "").strip()
                title = str(work.get("title") or work.get("position") or work.get("role") or "").strip()
                desc = str(work.get("description") or work.get("detail") or "").strip()
                name = f"{company} {title}".strip() or desc[:40]
                keywords = [company, title] + extract_keywords_from_text(desc)
                if name:
                    anchors.append({"type": "work", "name": name, "evidence": desc[:120], "keywords": [k for k in keywords if k][:8]})
            skills = data.get("skills") or data.get("technical_skills") or []
            if isinstance(skills, list) and skills:
                skill_strs = [str(s) for s in skills[:10] if s]
                anchors.append({"type": "skill", "name": "技能栈", "evidence": "、".join(skill_strs)[:120], "keywords": skill_strs})
            for honor in (data.get("honors") or data.get("awards") or [])[:3]:
                if not isinstance(honor, dict):
                    h_name = str(honor).strip()
                else:
                    h_name = str(honor.get("name") or honor.get("title") or "").strip()
                if h_name:
                    anchors.append({"type": "honor", "name": h_name, "evidence": h_name, "keywords": extract_keywords_from_text(h_name)[:5]})
            if anchors:
                return anchors[:8]
    except (ValueError, TypeError, AttributeError):
        pass

    for line in text.splitlines():
        item = line.strip(" -•\t")
        if not item or is_contact_or_intent_line(item) or _is_section_header(item) or _is_personal_trait_line(item):
            continue
        # 两条路径捕获：A) 包含项目关键词  B) 含日期范围（项目名行）
        is_project_line = any(key in item for key in _PROJECT_LINE_KEYWORDS)
        has_date = bool(re.search(r"\d{4}[./-]\d{1,2}\s*[-—~至]\s*", item))
        if is_project_line or has_date:
            keywords = extract_keywords_from_text(item)
            name = item[:60]
            # 日期型行去掉日期部分作为项目名
            if has_date and not is_project_line:
                name = item[:60]
                # 剥离 "YYYY/MM — YYYY/MM" 格式的完整日期范围
                name = re.sub(r"^\d{4}[./-]\d{1,2}\s*[-—~至]\s*\d{4}[./-]\d{1,2}", "", name).strip()
                # 剥离 "YYYY/MM — " 格式的起始日期
                name = re.sub(r"^\d{4}[./-]\d{1,2}\s*[-—~至]\s*", "", name).strip()
                # 剥离后置日期分隔（如 "| 2023/09 — 2024/06"）
                name = re.sub(r"\s*[\|｜]\s*\d{4}[./-]\d{1,2}\s*[-—~至]\s*.*$", "", name)[:60].strip()
                name = name.strip(" |｜")
                # 剥离日期后若无实质内容则跳过
                if len(name) < 3:
                    continue
            anchors.append({"type": "text", "name": name, "evidence": item[:150], "keywords": keywords[:5]})
        if len(anchors) >= 8:
            break
    return anchors


def select_opening_anchor(resume_anchors: list[dict[str, Any]]) -> dict[str, Any] | None:
    """选择最适合作为第一问锚点的简历条目。

    优先级：
    1. type="project" 的锚点（从 JSON 简历解析的结构化项目）
    2. 名称包含具体项目关键词（RAG/Agent/系统/平台/Redis/Spring 等）的锚点
    3. 名称长度 > 10 的锚点（更可能包含具体内容而非简短标签）
    """
    # 预处理：过滤掉本质上只是标签的锚点
    def _is_label_only(anchor: dict[str, Any]) -> bool:
        name = str(anchor.get("name") or "").strip(" -•\t#")
        evidence = str(anchor.get("evidence") or "").strip(" -•\t#")
        # 名称极短且无实质证据 → 很可能是标签
        return len(name) <= 10 and len(evidence) <= 20

    def _anchor_score(anchor: dict[str, Any]) -> int:
        """打分：越高越优先选为开场锚点。"""
        score = 0
        name = str(anchor.get("name") or "")
        evidence = str(anchor.get("evidence") or "")
        combined = f"{name} {evidence}"
        has_date = bool(re.search(r"\d{4}[./-]\d{1,2}\s*[-—~至]\s*\d{4}", evidence))
        name_len = len(name)

        # 最高权重：结构化项目类型
        if anchor.get("type") == "project":
            score += 200

        # 次高权重：带日期的行 → 极大概率为具体项目名称
        if has_date:
            score += 180

        # 技术关键词加分（有上限，避免描述行盖过项目名）
        keyword_bonus = 0
        for marker in ("合同", "审查", "RAG", "Agent", "MCP", "多智能体", "LLM", "LangChain"):
            if marker in combined:
                keyword_bonus += 25
        for marker in ("Redis", "Spring", "Kafka", "微服务", "高并发"):
            if marker in combined:
                keyword_bonus += 20
        for marker in ("项目", "平台", "系统", "开发", "构建", "设计", "架构"):
            if marker in combined:
                keyword_bonus += 10
        score += min(keyword_bonus, 80)  # 封顶 80，防止描述行靠关键词轰炸反超项目名

        # 名称长度（具体项目名通常 > 4 字，标签 ≤ 4 字）
        if name_len > 10:
            score += 15
        elif name_len >= 4:
            score += 5
        else:
            score -= 40  # 极短名称很可能是噪声

        if len(evidence) > 30:
            score += 10

        if _is_label_only(anchor):
            score -= 400
        return score

    scored = sorted(resume_anchors, key=_anchor_score, reverse=True)
    for anchor in scored:
        name = str(anchor.get("name") or "")
        evidence = str(anchor.get("evidence") or "")
        combined = f"{name} {evidence}"
        if is_contact_or_intent_line(combined):
            continue
        if _is_section_header(name.strip(" -•\t#")):
            continue
        # 必须有一定内容才选
        if len(name) >= 3:
            return anchor
    return None
