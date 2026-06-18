# 简历防造假三道防线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强简历事实闸门，防止程度词升级、跨条目张冠李戴、JD GAP 项混入简历

**Architecture:** 在现有 `_validate_resume_facts` 和 `_check_resume_quality` 基础上，新增三个独立校验函数，分别对应三道防线。防线1（程度词阶梯）和防线3（JD GAP 铁律）为确定性拦截，防线2（条目归属）先以 shadow mode 收集数据。

**Tech Stack:** Python, FastAPI, SQLAlchemy (backend/app/student/agent_runtime.py)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/app/student/agent_runtime.py` | 新增 `_check_role_escalation()`、`_check_item_attribution()`、`_check_gap_violations()` 函数；修改 `_harness_system_prompt()` 添加 GAP 铁律；在工具函数中调用新校验 |
| `backend/tests/test_fact_guard.py` | 新增三道防线的测试用例 |

---

### Task 1: 程度词阶梯检测

**Covers:** 防线1 - 程度词升级检测

**Files:**
- Modify: `backend/app/student/agent_runtime.py` (新增函数 + 调用点)
- Modify: `backend/tests/test_fact_guard.py` (新增测试)

- [ ] **Step 1: 定义程度词阶梯常量**

在 `_STRONG_VERBS` 定义之后（约 line 145）添加：

```python
# 程度词阶梯：用于检测角色升级造假
# 值越大，角色越核心。同一段经历中，生成内容的角色词等级不得超过证据中的等级。
_ROLE_ESCALATION_LADDER: dict[str, int] = {
    "协助": 1,
    "参与": 2,
    "负责": 3,
    "主导": 4,
    "独立完成": 5,
    "独立开发": 5,
    "从0到1搭建": 5,
    "从0到1": 5,
    "独自": 5,
}

# 角色词提取正则：匹配中文角色动词 + "了/着/过" 等助词
_ROLE_VERB_RE = _re.compile(
    r"(协助|参与|负责|主导|独立完成|独立开发|从0到1搭建|从0到1|独自)[了着过]?"
)
```

- [ ] **Step 2: 实现 `_check_role_escalation` 函数**

在 `_check_resume_quality` 函数之后（约 line 462）添加：

```python
def _check_role_escalation(args: dict[str, Any], evidence_sources: list[Any]) -> list[str]:
    """程度词阶梯检测：防止「参与」→「主导」的角色升级造假。

    策略：
    - 从证据中提取每段经历的角色词（如「参与」）
    - 从生成内容中提取对应经历的角色词
    - 若生成内容的角色词等级 > 证据中的等级，返回 violation
    """
    violations: list[str] = []

    # 1. 从证据中提取每段经历的角色词
    # key: (company/school, project_name) -> max role level from evidence
    evidence_roles: dict[tuple[str, str], int] = {}

    for source in evidence_sources:
        if not isinstance(source, dict):
            continue
        # 工作经历
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
            # 如果描述中没有角色词，默认为「参与」（最低可接受）
            if max_level == 0:
                max_level = _ROLE_ESCALATION_LADDER["参与"]
            if company:
                evidence_roles[("exp", company)] = max_level

        # 项目经历
        for proj in (source.get("projects") or []):
            if not isinstance(proj, dict):
                continue
            proj_name = str(proj.get("name") or "").strip()
            desc = str(proj.get("description") or proj.get("details") or "")
            max_level = 0
            for m in _ROLE_VERB_RE.finditer(desc):
                verb = m.group(1)
                level = _ROLE_ESCALATION_LADDER.get(verb, 0)
                max_level = max(max_level, level)
            if max_level == 0:
                max_level = _ROLE_ESCALATION_LADDER["参与"]
            if proj_name:
                evidence_roles[("proj", proj_name)] = max_level

    # 2. 从生成内容中提取角色词并与证据比对
    for section, section_type in [("experience", "exp"), ("projects", "proj")]:
        items = args.get(section) or []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            # 匹配键名
            if section_type == "exp":
                name = str(item.get("company") or "").strip()
            else:
                name = str(item.get("name") or item.get("project") or "").strip()

            details = str(item.get("details") or item.get("description") or "")

            # 提取生成内容中的角色词
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

            # 查找证据中对应经历的角色等级
            evidence_key = (section_type, name)
            evidence_level = evidence_roles.get(evidence_key)

            if evidence_level is None:
                # 证据中没有这段经历（已被 _validate_resume_facts 拦截，这里跳过）
                continue

            if generated_level > evidence_level:
                # 找到证据中对应等级的词
                evidence_verb = next(
                    (v for v, l in _ROLE_ESCALATION_LADDER.items() if l == evidence_level),
                    "参与"
                )
                violations.append(
                    f"角色升级：「{name}」的档案角色是「{evidence_verb}」，"
                    f"不得写成「{matched_verb}」"
                )

    return violations
```

- [ ] **Step 3: 在工具函数中调用 `_check_role_escalation`**

在 `_generate_resume_data_tool` 中（约 line 4563，`_validate_resume_facts` 之后）添加：

```python
    # 程度词阶梯检测
    role_escalation_violations = _check_role_escalation(args, evidence_sources)
    if role_escalation_violations:
        return _fact_guard_failure("generate_resume_data", role_escalation_violations, fact_whitelist)
```

同样在 `_optimize_resume_data_tool`（约 line 4693）、`_update_resume_data_tool`（约 line 4837）、`_export_resume_pdf_tool`（约 line 5060）的 `_validate_resume_facts` 调用之后添加相同的调用。

- [ ] **Step 4: 添加测试用例**

在 `backend/tests/test_fact_guard.py` 末尾添加：

```python
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
```

- [ ] **Step 5: 运行测试验证**

Run: `cd /Users/wsr/agent/zhipei-agent-platform/backend && source .venv/bin/activate && python -m pytest tests/test_fact_guard.py -v`
Expected: 所有测试 PASS

---

### Task 2: 条目归属校验 (Shadow Mode)

**Covers:** 防线2 - 张冠李戴检测

**Files:**
- Modify: `backend/app/student/agent_runtime.py` (新增函数 + shadow mode 调用)
- Modify: `backend/tests/test_fact_guard.py` (新增测试)

- [ ] **Step 1: 实现 `_check_item_attribution` 函数**

在 `_check_role_escalation` 函数之后添加：

```python
def _check_item_attribution(args: dict[str, Any], evidence_sources: list[Any]) -> list[str]:
    """条目归属校验：防止把项目 A 的数字安到项目 B 头上。

    策略：
    - 按条目粒度校验：bullet 中的数字/专名应出现在**对应经历**的证据中
    - 目前仅在 shadow mode 下运行，只记录不拦截
    """
    violations: list[str] = []

    # 构建每段经历的局部证据池
    # key: (type, name) -> set of numbers/proper nouns in that item's evidence
    item_evidence: dict[tuple[str, str], dict[str, set[str]]] = {}

    for source in evidence_sources:
        if not isinstance(source, dict):
            continue

        # 工作经历
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
            # 提取数字
            for m in _re.finditer(r"\d[\d.,]*\s*[%万亿千百十人个次台条项年月天KkMmBb]", desc):
                item_evidence[key]["numbers"].add(m.group().strip())
            # 提取专名（公司/学校/技术词）
            for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{2,}", desc):
                item_evidence[key]["nouns"].add(m.group().lower())

        # 项目经历
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

    # 检查生成内容中每条 bullet 的数字/专名是否属于对应条目的证据
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
                # 证据中没有这段经历，跳过（会被 _validate_resume_facts 拦截）
                continue

            # 检查数字
            for m in _re.finditer(r"\d[\d.,]*\s*[%万亿千百十人个次台条项年月天KkMmBb]", details):
                num = m.group().strip()
                # 全局白名单（允许使用简历级别的通用数字）
                global_nums = set()
                for ev in item_evidence.values():
                    global_nums |= ev["numbers"]
                if num not in local_evidence["numbers"] and num not in global_nums:
                    violations.append(
                        f"条目归属：数字「{num}」不属于「{name}」的证据，可能是张冠李戴"
                    )

            # 检查英文技术词（只检查明显的专有名词，不检查通用技术词）
            _GENERIC_TECH = {"python", "java", "javascript", "typescript", "react", "vue", "node", "sql", "html", "css", "git", "docker", "linux", "api", "http", "rest", "json"}
            for m in _re.finditer(r"[A-Za-z][A-Za-z0-9_.+#]{3,}", details):
                word = m.group().lower()
                if word in _GENERIC_TECH:
                    continue
                global_nouns = set()
                for ev in item_evidence.values():
                    global_nouns |= ev["nouns"]
                if word not in local_evidence["nouns"] and word not in global_nouns:
                    violations.append(
                        f"条目归属：技术词「{m.group()}」不属于「{name}」的证据，可能是张冠李戴"
                    )

    return violations[:20]
```

- [ ] **Step 2: 在工具函数中以 shadow mode 调用**

在每个工具函数的 `_check_role_escalation` 调用之后添加：

```python
    # 条目归属校验（shadow mode：只记录不拦截）
    attribution_violations = _check_item_attribution(args, evidence_sources)
    if attribution_violations:
        if FACT_GUARD_SHADOW_MODE:
            logger.warning("item_attribution shadow_mode violations tool=%s violations=%s", tool_name, attribution_violations[:10])
        else:
            # shadow mode 下不拦截，只记录日志
            logger.info("item_attribution shadow_mode violations (not blocking) tool=%s violations=%s", tool_name, attribution_violations[:10])
```

注意：`FACT_GUARD_SHADOW_MODE` 目前是 `False`（拦截模式），但条目归属校验应该有自己的 shadow mode 开关。建议新增：

```python
# 条目归属校验 shadow mode（独立于 FACT_GUARD_SHADOW_MODE）
# 开启时只记录日志不拦截，用于收集真实误报率
ITEM_ATTRIBUTION_SHADOW_MODE = True
```

然后使用这个独立的开关控制拦截行为。

- [ ] **Step 3: 添加测试用例**

在 `backend/tests/test_fact_guard.py` 末尾添加：

```python
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
```

- [ ] **Step 4: 运行测试验证**

Run: `cd /Users/wsr/agent/zhipei-agent-platform/backend && source .venv/bin/activate && python -m pytest tests/test_fact_guard.py -v`
Expected: 所有测试 PASS

---

### Task 3: JD GAP 铁律 - Prompt 层

**Covers:** 防线3 - JD GAP 禁入简历 (prompt 铁律)

**Files:**
- Modify: `backend/app/student/agent_runtime.py` (`_harness_system_prompt` 函数)

- [ ] **Step 1: 在行动准则中添加 GAP 铁律**

在 `_harness_system_prompt` 函数的行动准则部分（约 line 2325，"- 行动准则" 之后）添加：

```python
        "- JD 匹配铁律：\n"
        "  ▸ JD 匹配分析中标记为 GAP 的项（缺失能力/技能/经历），**禁止以任何形式写入简历正文**；\n"
        "  ▸ GAP 项只能出现在给用户的差距分析说明中，并建议用户补充相关经历或学习计划；\n"
        "  ▸ 若用户坚持要求写入 GAP 项，明确告知风险：「这部分在你的档案中没有依据，写入简历后在面试中可能被追问」；\n"
        "  ▸ 违反此规则等同于简历造假。\n"
```

- [ ] **Step 2: 运行测试验证**

Run: `cd /Users/wsr/agent/zhipei-agent-platform/backend && source .venv/bin/activate && python -m pytest tests/test_fact_guard.py -v`
Expected: 所有测试 PASS（此步骤不涉及新功能，只是确保没有破坏现有逻辑）

---

### Task 4: JD GAP 铁律 - Fact Guard 层

**Covers:** 防线3 - JD GAP 禁入简历 (fact guard 拦截)

**Files:**
- Modify: `backend/app/student/agent_runtime.py` (新增 `_check_gap_violations` 函数 + 调用点)
- Modify: `backend/tests/test_fact_guard.py` (新增测试)

- [ ] **Step 1: 在 `SessionEvidencePool` 中添加 GAP 关键词存储**

在 `SessionEvidencePool.__init__` 中（约 line 88）添加：

```python
        self.gap_keywords: list[str] = []  # JD 分析中标记为 GAP 的关键词
```

添加 setter 方法：

```python
    def set_gap_keywords(self, gap_keywords: list[str]) -> None:
        self.gap_keywords = gap_keywords
```

- [ ] **Step 2: 实现 `_check_gap_violations` 函数**

在 `_check_item_attribution` 函数之后添加：

```python
def _check_gap_violations(args: dict[str, Any], gap_keywords: list[str]) -> list[str]:
    """检查生成内容是否包含 JD GAP 关键词。

    策略：
    - 从 args 的 skills/details/description/self_evaluation 中提取关键词
    - 与 GAP 关键词列表比对
    - 若命中，返回 violation
    """
    if not gap_keywords:
        return []

    violations: list[str] = []

    # 从生成内容中提取关键词
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

    # 检查 GAP 关键词是否出现在简历中
    for keyword in gap_keywords:
        kw_lower = keyword.lower()
        if kw_lower in resume_text:
            violations.append(f"GAP 项「{keyword}」不应出现在简历中（档案中没有相关依据）")

    return violations[:10]
```

- [ ] **Step 3: 在工具函数中调用 `_check_gap_violations`**

在每个工具函数的 `_check_role_escalation` 调用之后，`_check_item_attribution` 之前添加：

```python
    # JD GAP 铁律：GAP 项禁止进入简历
    if evidence_pool and evidence_pool.gap_keywords:
        gap_violations = _check_gap_violations(args, evidence_pool.gap_keywords)
        if gap_violations:
            return _fact_guard_failure(tool_name, gap_violations, fact_whitelist)
```

注意：需要确保在调用 `analyze_jd_match` 工具时，将 GAP 关键词存入 `evidence_pool.gap_keywords`。需要找到 `analyze_jd_match` 的实现并添加存储逻辑。

- [ ] **Step 4: 在 `analyze_jd_match` 工具中存储 GAP 关键词**

找到 `analyze_jd_match` 工具的实现（在 `_dispatch_tool` 中），在返回结果时将 GAP 项存入 evidence_pool：

```python
    # 在 analyze_jd_match 返回前，将 GAP 项存入 evidence_pool
    if evidence_pool and analysis_result:
        gap_items = [
            item.get("keyword") or item.get("name")
            for item in (analysis_result.get("items") or [])
            if item.get("status") == "GAP"
        ]
        if gap_items:
            evidence_pool.set_gap_keywords(gap_items)
```

- [ ] **Step 5: 添加测试用例**

在 `backend/tests/test_fact_guard.py` 末尾添加：

```python
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
```

- [ ] **Step 6: 运行测试验证**

Run: `cd /Users/wsr/agent/zhipei-agent-platform/backend && source .venv/bin/activate && python -m pytest tests/test_fact_guard.py -v`
Expected: 所有测试 PASS

---

### Task 5: 集成测试与验证

**Covers:** 全部三道防线

**Files:**
- Modify: `backend/tests/test_fact_guard.py` (集成测试)

- [ ] **Step 1: 添加集成测试**

在 `backend/tests/test_fact_guard.py` 末尾添加：

```python
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
```

- [ ] **Step 2: 运行全部测试**

Run: `cd /Users/wsr/agent/zhipei-agent-platform/backend && source .venv/bin/activate && python -m pytest tests/test_fact_guard.py -v`
Expected: 所有测试 PASS

- [ ] **Step 3: 启动后端验证**

Run: `cd /Users/wsr/agent/zhipei-agent-platform/backend && source .venv/bin/activate && uvicorn app.main:app --reload`
Expected: 服务启动成功，无报错

- [ ] **Step 4: 提交代码**

```bash
cd /Users/wsr/agent/zhipei-agent-platform
git add backend/app/student/agent_runtime.py backend/tests/test_fact_guard.py
git commit -m "feat: 增强简历防造假三道防线

1. 防线1: 程度词阶梯检测（参与→主导 角色升级拦截）
2. 防线2: 条目归属校验（shadow mode，防止张冠李戴）
3. 防线3: JD GAP 铁律（prompt 铁律 + fact guard 双保险）"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** 三道防线均有对应 Task
- [x] **Placeholder scan:** 无 TBD/TODO
- [x] **Type consistency:** 函数签名一致（`args: dict[str, Any]`, `evidence_sources: list[Any]`）
- [x] **测试覆盖:** 每个防线都有独立测试 + 集成测试
