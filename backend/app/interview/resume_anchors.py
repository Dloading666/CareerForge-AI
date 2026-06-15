from __future__ import annotations

import json
import re
from typing import Any


def extract_keywords_from_text(text: str) -> list[str]:
    parts = re.split(r"[，,、。；;：:（）()\s/]+", text)
    return [p.strip() for p in parts if len(p.strip()) >= 2][:8]


def is_contact_or_intent_line(text: str) -> bool:
    """联系方式、邮箱、求职意向等简历头部信息不能作为首问项目锚点。"""
    lowered = text.lower()
    has_real_project_marker = any(marker in text for marker in ("项目：", "项目:", "项目经历", "项目经验"))
    if has_real_project_marker:
        return False
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
        if not item or is_contact_or_intent_line(item):
            continue
        if any(key in item for key in ("项目", "经历", "实习", "公司", "技术", "负责", "开发", "系统", "平台")):
            keywords = extract_keywords_from_text(item)
            anchors.append({"type": "text", "name": item[:40], "evidence": item[:120], "keywords": keywords[:5]})
        if len(anchors) >= 5:
            break
    return anchors


def select_opening_anchor(resume_anchors: list[dict[str, Any]]) -> dict[str, Any] | None:
    for anchor in resume_anchors:
        name = str(anchor.get("name") or "")
        evidence = str(anchor.get("evidence") or "")
        combined = f"{name} {evidence}"
        if is_contact_or_intent_line(combined):
            continue
        if anchor.get("type") == "project" or any(marker in combined for marker in ("项目", "平台", "系统", "开发", "RAG", "Agent", "Redis")):
            return anchor
    return None
