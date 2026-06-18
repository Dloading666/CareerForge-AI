# AI 面试官全面升级改造 — 实施计划

## 概述

按文档要求，将 AI 面试官从"能对话、能评分、能生成报告"的 MVP 升级为"岗位定制化面试训练闭环"。涉及后端模型/服务/Prompt、前端页面、数据库迁移共 10 个子任务。

---

## Phase 1: 数据库迁移 + 模型更新（3.3 + 3.4 + 3.5 + 3.6 + 3.7 + Section 5）

### 1.1 新建 Alembic 迁移

**文件**: `backend/alembic/versions/20260612_0022_interview_overhaul.py`

**interview_sessions 新增字段**:
- `company_name` String(128) nullable
- `seniority_level` String(32) nullable
- `job_skills_json` Text nullable — JSON array of skill tags
- `job_profile_json` Text nullable — JSON summary of job profile
- `current_stage` String(32) NOT NULL default="opening"
- `stage_plan_json` Text nullable — JSON array of stage plan
- `coverage_json` Text nullable — JSON dict of stage coverage

**interview_turns 新增字段**:
- `stage` String(32) nullable
- `question_type` String(64) nullable
- `question_reason` Text nullable
- `capability_tags_json` Text nullable
- `retrieval_query` Text nullable
- `retrieval_hit_count` Integer nullable
- `top_sources_json` Text nullable
- `score_reasons_json` Text nullable
- `evidence_quotes_json` Text nullable

**interview_reports 新增字段**:
- `training_plan_json` Text nullable
- `rewrite_examples_json` Text nullable
- `next_session_preset_json` Text nullable

所有新字段 nullable（兼容旧数据），使用 `_has_column()` 防御式检查。

### 1.2 更新 SQLAlchemy 模型

**文件**: `backend/app/interview/models.py`

在 `InterviewSession`、`InterviewTurn`、`InterviewReport` 三个模型中添加对应字段。

### 1.3 更新 Pydantic Schemas

**文件**: `backend/app/interview/schemas.py`

- `InterviewStartRequest.target_role`: `str = Field(min_length=1, max_length=128)`（去掉默认空字符串）
- 新增字段: `company_name`, `seniority_level`, `job_skills` (list[str])
- `InterviewSessionResponse`: 新增 `company_name`, `seniority_level`, `current_stage`, `job_skills`
- `InterviewTurnResponse`: 新增 `stage`, `question_type`, `question_reason`, `capability_tags`, `score_reasons`, `evidence_quotes`, `top_sources`
- `InterviewReportResponse`: 新增 `training_plan`, `rewrite_examples`, `next_session_preset`

---

## Phase 2: 后端服务逻辑（3.2 + 3.3 + 3.4 + 3.5 + 3.6 + 3.7 + 3.8）

### 2.1 强制目标岗位必填 (3.2)

**文件**: `backend/app/interview/service.py` — `start_interview()`

在 `start_interview()` 开头添加:
```python
target_role = (payload.target_role or "").strip()
if not target_role:
    raise HTTPException(status_code=400, detail="请填写目标岗位")
```

### 2.2 岗位画像处理 (3.3)

**文件**: `backend/app/interview/service.py`

新增函数 `_extract_job_skills(jd_text: str, user_skills: list[str]) -> list[str]`:
- 如果 `user_skills` 非空，直接使用
- 否则从 JD 中用关键词匹配提取技能标签（文档给的关键词列表）
- 返回去重后的技能列表

在 `start_interview()` 中:
- 提取技能标签，存入 `job_skills_json`
- 构建岗位画像摘要，存入 `job_profile_json`
- 将 `company_name`, `seniority_level` 存入 session

### 2.3 面试阶段状态机 (3.4)

**文件**: `backend/app/interview/service.py`

新增纯函数:
1. `_build_stage_plan(interview_type: str, round_limit: int, focus_tags: list[str]) -> list[dict]`
   - 根据面试类型和轮次生成阶段计划
   - 返回 `[{"stage": "opening", "rounds": [1]}, {"stage": "self_intro", "rounds": [2]}, ...]`

2. `_stage_for_turn(stage_plan: list[dict], turn_index: int) -> str`
   - 根据 turn_index 查找当前阶段

3. `_update_coverage(coverage: dict, stage: str, knowledge_points: list[str], score: dict) -> dict`
   - 更新阶段覆盖度统计

在 `start_interview()` 中:
- 生成 `stage_plan_json` 并存入 session
- 设置 `current_stage = "opening"`
- 第一个 turn 写入 `stage`

在 `submit_turn()` 中:
- 根据下一轮 turn_index 计算下一阶段
- 更新 `session.current_stage`
- 更新 `coverage_json`
- 每个 turn 保存 `stage`

### 2.4 增强题库检索解释性 (3.5)

**文件**: `backend/app/interview/service.py`

在 `start_interview()` 和 `submit_turn()` 中:
- 保存 `retrieval_query`, `retrieval_hit_count`, `top_sources_json` 到 turn
- `top_sources_json` 只保留 top 3 来源（title, topic, source_file, score）

### 2.5 增强评分可解释性 (3.6)

**文件**: `backend/app/interview/service.py`

新增纯函数:
1. `_normalize_score_reasons(raw: Any) -> dict[str, str]`
   - 缺少维度原因时填 "本轮未提供足够证据。"
   - 只保留 SCORE_KEYS 中的维度

2. `_filter_evidence_quotes(raw: Any, answer: str) -> list[dict]`
   - 最多保留 3 条
   - quote 必须是用户回答中的原文片段
   - 不在 answer 中的直接丢弃

在 `submit_turn()` 中:
- 解析 LLM 返回的 `score_reasons` 和 `evidence_quotes`
- 经过 `_normalize_score_reasons` 和 `_filter_evidence_quotes` 处理后存入 turn

### 2.6 训练闭环 (3.7)

**文件**: `backend/app/interview/service.py`

新增函数 `_build_fallback_training_plan(weakest_dim: str) -> list[dict]`:
- 当 LLM 未返回训练计划时生成 fallback

在 `generate_report()` 中:
- 解析 LLM 返回的 `training_plan`, `rewrite_examples`, `next_session_preset`
- 如果 LLM 未返回 training_plan，用 `_build_fallback_training_plan` 兜底
- 存入 report 的新字段

### 2.7 租户隔离修复 + 知识库权限 (3.8)

**文件**: `backend/app/interview/service.py`

- `_get_session()`: 添加 `InterviewSession.tenant_id == identity.tenant_id` 条件
- `list_interviews()`: 添加 `InterviewSession.tenant_id == identity.tenant_id` 条件
- `_build_report_comparison()`: 添加 `tenant_id` 条件

**文件**: `backend/app/interview/router_student.py`

- 删除或注释掉 `reload_knowledge` 路由（方案 A）
- `knowledge_status()`: 不返回 `root` 字段（绝对路径）

---

## Phase 3: Prompt 修改 (Section 4)

### 3.1 更新 Prompt 模板

**文件**: `backend/app/interview/prompts.py`

**START_USER_PROMPT** — 更新输出格式要求:
- 新增 `question_reason`, `question_type`, `capability_tags` 字段
- 注入公司/组织、岗位级别、核心技能、岗位画像摘要

**FOLLOWUP_USER_PROMPT** — 更新输出格式要求:
- 新增 `score_reasons`（每个维度的扣分原因）
- 新增 `evidence_quotes`（用户原话引用）
- 新增 `question_reason`, `question_type`, `capability_tags`
- 注入当前阶段和阶段目标

**REPORT_USER_PROMPT** — 更新输出格式要求:
- 新增 `training_plan`, `rewrite_examples`, `next_session_preset`
- 注入阶段覆盖度信息

**INTERVIEW_SYSTEM_PROMPT** — 新增硬性规则:
- 禁止编造用户没说过的经历
- evidence_quotes.quote 必须来自用户回答原文
- 每轮只问一个主问题
- 多回答点用 Markdown 编号列表

**新增**: `STAGE_DEFINITIONS` 常量 — 9 个阶段的中文名称和目标描述

---

## Phase 4: 前端修改 (Section 6)

### 4.1 目标岗位必填校验

**文件**: `frontend/src/student/AIInterviewerPage.tsx`

- `startInterview()` 开头检查 `targetRole.trim()`，为空时 `Message.warning` 并 return

### 4.2 新增岗位画像输入

- 增加"公司/组织"输入框
- 增加"岗位级别"下拉选择（实习/校招/初级/中级/高级）
- 增加"核心技能标签"多选输入
- 在 API 请求中传入 `company_name`, `seniority_level`, `job_skills`

### 4.3 展示当前面试阶段

- 在面试房间 header 或问题区域显示当前阶段（如"当前阶段：项目深挖"）
- 从 session 或 turn 的 `stage` 字段读取
- 新增 `STAGE_LABELS` 常量映射 stage 到中文

### 4.4 每轮问题展示增强

- 展示考察点（`capability_tags`）
- 展示追问原因（`question_reason`）
- 展示题库命中来源（`top_sources`），默认折叠，只显示 top 1-3
- 无命中时显示"未命中题库，当前问题按简历和岗位要求自适应生成"

### 4.5 每轮反馈展示增强

- 展示维度小分（已有，确认完整）
- 展示扣分原因（`score_reasons`）
- 展示证据引用（`evidence_quotes`）

### 4.6 报告区展示增强

- 展示训练计划（`training_plan`）
- 展示回答改写示例（`rewrite_examples`）
- 展示下一场预设（`next_session_preset`）
- "按此计划再练一场"按钮：自动填充配置，不自动开始

### 4.7 移除知识库重载按钮

- 删除"重新索引知识库"按钮及其相关函数

### 4.8 通话面试视觉权重降低

- 将"通话面试"选项设为 disabled 或降低视觉权重

---

## Phase 5: 测试 (Section 7)

**文件**: `backend/tests/test_interview.py` (新建)

纯函数测试:
- `_build_stage_plan` — 不同面试类型和轮次
- `_stage_for_turn` — 正确映射 turn_index 到 stage
- `_normalize_score_reasons` — 缺失维度兜底
- `_filter_evidence_quotes` — 不在 answer 中的 quote 被丢弃
- `_extract_job_skills` — 关键词提取
- `_build_fallback_training_plan` — fallback 生成

---

## 修改文件清单

| 文件 | 操作 |
|------|------|
| `backend/alembic/versions/20260612_0022_interview_overhaul.py` | 新建 |
| `backend/app/interview/models.py` | 修改（新增字段） |
| `backend/app/interview/schemas.py` | 修改（新增字段 + target_role 校验） |
| `backend/app/interview/service.py` | 修改（大量业务逻辑） |
| `backend/app/interview/prompts.py` | 修改（Prompt 模板更新） |
| `backend/app/interview/router_student.py` | 修改（删除 reload 路由 + knowledge_status 脱敏） |
| `frontend/src/student/AIInterviewerPage.tsx` | 修改（大量 UI 变更） |
| `backend/tests/test_interview.py` | 新建 |

## 执行顺序

Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → 验证构建

## 禁止事项确认

- ❌ 不引入 LangGraph / LangChain
- ❌ 不删除旧数据表
- ❌ 不破坏简历助手
- ❌ 不让学生端触发知识库重载
- ❌ 不泄露服务器绝对路径
