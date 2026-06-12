# CareerForge-AI AI 面试官修改执行文档

适用项目：

```text
D:\Ai Agent\CareerForge-AI
```

## 0. LangGraph 使用结论

### 结论：本次不要引入 LangGraph

已经检查项目当前依赖和架构：

后端依赖文件：

```text
backend/requirements.txt
```

当前没有：

```text
langgraph
langchain
```

当前 AI 面试官架构是：

```text
FastAPI Router
  -> backend/app/interview/router_student.py
  -> backend/app/interview/service.py
  -> backend/app/interview/prompts.py
  -> backend/app/interview/knowledge.py
  -> SQLAlchemy models
```

当前面试流程已经是普通业务流：

```text
创建面试
  -> 读取简历
  -> 检索题库
  -> 生成第一问
  -> 用户回答
  -> 评分
  -> 生成下一问
  -> 达到轮次后生成报告
```

这个流程只需要“显式状态字段 + 后端阶段推进函数”，不需要 LangGraph。

### 为什么不使用 LangGraph

不要因为提到“状态机”就引入 LangGraph。这里的状态机不是复杂 Agent 图编排，而是业务状态机。

当前需求只需要：

```text
opening
self_intro
resume_deep_dive
technical_core
scenario
pressure
reverse_question
wrap_up
completed
```

这些阶段可以直接存入数据库字段，并由 `service.py` 控制推进。

如果引入 LangGraph，会带来：

1. 新依赖。
2. 新运行时模型。
3. 更高调试成本。
4. 和当前 FastAPI + SQLAlchemy service 风格不一致。
5. 对现阶段功能收益不明显。

### 什么时候才考虑 LangGraph

只有后续出现以下需求时，才考虑引入 LangGraph：

1. 多个独立 Agent 协作，例如面试官、评分官、题库检索官、简历审查官、训练计划官需要并行或条件编排。
2. 每轮面试存在复杂分支，例如代码题、系统设计题、行为面、压力面动态切换，并且需要可视化执行图。
3. 需要可恢复的长流程图执行、节点级重试、节点级观测。
4. 当前 `service.py` 中的流程函数已经明显失控，普通函数难以维护。

本次修改强制要求：

```text
不要引入 LangGraph。
不要引入 LangChain。
不要新增图编排依赖。
使用当前项目风格，在 service.py 内实现显式业务状态机。
```

## 1. 修改目标

把当前 AI 面试官从“能对话、能评分、能生成报告”的 MVP，升级为“岗位定制化面试训练闭环”。

必须优先保证：

1. 面试入口唯一。
2. 目标岗位必填。
3. 面试问题围绕岗位、JD、简历和题库。
4. 面试过程有明确阶段状态。
5. 每轮评分可解释、可追溯。
6. 报告生成后能继续训练。
7. 学生端不能触发知识库重载。
8. 多租户数据隔离必须正确。

## 2. 必须先阅读的文件

后端：

```text
backend/app/interview/router_student.py
backend/app/interview/service.py
backend/app/interview/prompts.py
backend/app/interview/knowledge.py
backend/app/interview/models.py
backend/app/interview/schemas.py
backend/app/student/agent_runtime.py
```

前端：

```text
frontend/src/student/AIInterviewerPage.tsx
frontend/src/student/StudentHomePage.tsx
frontend/src/student/AgentChatView.tsx
```

数据库迁移目录：

```text
backend/alembic/versions/
```

依赖文件：

```text
backend/requirements.txt
frontend/package.json
```

## 3. 强制修改范围

### 3.1 统一 AI 面试官入口

当前项目存在两套 AI 面试官：

第一套，旧版通用 Agent 面试官：

```text
backend/app/student/agent_runtime.py
agent_type="interviewer"
```

第二套，新版独立面试模块：

```text
backend/app/interview/*
frontend/src/student/AIInterviewerPage.tsx
/api/v1/student/interviews
/student/interviewer
```

必须以新版独立面试模块为唯一主入口。

#### 修改要求

1. `StudentHomePage.tsx` 中“面试官”入口必须继续指向：

```text
/student/interviewer
```

2. 不允许用户从 `AgentChatView agentType="interviewer"` 进入完整旧版面试流程。

3. 如果旧版 `agent_type="interviewer"` 仍被调用，必须返回明确引导文案：

```text
新版 AI 面试官已升级为岗位定制化训练房间，请前往 /student/interviewer 开始面试。
```

4. 不要删除旧代码，避免影响历史数据和兼容性。

#### 禁止事项

```text
不要维护两个完整 AI 面试官体验。
不要让旧版 interviewer 继续执行 3-5 轮模拟面试。
不要破坏 AI 简历助手。
```

#### 验收标准

1. 学生端点击“面试官”只进入 `AIInterviewerPage`。
2. 页面中不存在两个不同的面试官入口。
3. 旧版 interviewer 不再作为主体验使用。

### 3.2 强制目标岗位必填

当前问题：

```text
backend/app/interview/schemas.py
InterviewStartRequest.target_role 默认允许空字符串
```

这是错误的。AI 面试官必须知道目标岗位。

#### 修改文件

```text
backend/app/interview/schemas.py
backend/app/interview/service.py
frontend/src/student/AIInterviewerPage.tsx
```

#### 后端要求

`target_role` 必须非空，并且必须去除首尾空格。

建议实现：

```python
target_role: str = Field(min_length=1, max_length=128)
```

同时增加校验：

```python
target_role = payload.target_role.strip()
if not target_role:
    raise HTTPException(status_code=400, detail="请填写目标岗位")
```

所有后续流程使用清洗后的 `target_role`。

#### 前端要求

点击“开始面试”前检查：

```ts
if (!targetRole.trim()) {
  Message.warning('请先填写目标岗位')
  return
}
```

#### 验收标准

1. 目标岗位为空时，前端不能创建面试。
2. 目标岗位只包含空格时，前端不能创建面试。
3. 直接调用 API 传空岗位时，后端返回 400 或 422。
4. 第一问、追问、报告都使用清洗后的岗位名称。

### 3.3 增加岗位画像

当前 AI 面试官只有 `target_role` 和 `job_description`，不够支撑重度用户训练。

必须增加岗位画像。

#### 修改文件

```text
backend/app/interview/models.py
backend/app/interview/schemas.py
backend/app/interview/service.py
backend/app/interview/prompts.py
frontend/src/student/AIInterviewerPage.tsx
backend/alembic/versions/
```

#### 数据库字段

在 `interview_sessions` 新增：

```text
company_name        nullable string
seniority_level     nullable string
job_skills_json     nullable text
job_profile_json    nullable text
```

#### 前端新增输入

在 `AIInterviewerPage.tsx` 的配置面板中增加：

```text
公司/组织，可选
岗位级别，可选
核心技能标签，可选
```

岗位级别建议选项：

```text
实习
校招
初级
中级
高级
```

核心技能标签允许用户手动输入或多选。

#### 技能提取要求

如果用户填写 JD，后端要从 JD 中提取基础技能标签。

不要调用外部服务。

先用本地关键词匹配。

建议关键词：

```text
Java
Spring
Spring Boot
MySQL
Redis
Kafka
Elasticsearch
JVM
Docker
Kubernetes
Linux
React
Vue
TypeScript
Python
Django
FastAPI
Flask
LLM
RAG
Agent
MCP
Function Calling
LangChain
LangGraph
数据结构
算法
系统设计
分布式
微服务
缓存
消息队列
数据库事务
```

如果用户手动填写技能标签，优先使用用户填写内容。

#### Prompt 注入要求

`START_USER_PROMPT` 和 `FOLLOWUP_USER_PROMPT` 必须注入：

```text
公司/组织
岗位级别
核心技能
岗位画像摘要
```

#### 验收标准

1. 创建面试后，数据库保存岗位画像。
2. 第一问能体现目标岗位、JD 或技能标签。
3. 报告中的岗位匹配维度不是泛泛而谈。
4. 用户不填公司和级别时，系统正常工作。

### 3.4 增加显式面试阶段状态机

本次状态机使用普通 Python 函数和数据库字段实现。

不要引入 LangGraph。

#### 阶段定义

必须使用以下阶段：

```text
opening           开场与目标确认
self_intro        自我介绍/项目总览
resume_deep_dive  简历项目深挖
technical_core    核心技术/岗位题
scenario          场景题/系统设计/业务题
pressure          压力追问
reverse_question  反问环节
wrap_up           收束与复盘
completed         已完成
```

#### 修改文件

```text
backend/app/interview/models.py
backend/app/interview/service.py
backend/app/interview/prompts.py
backend/app/interview/schemas.py
frontend/src/student/AIInterviewerPage.tsx
backend/alembic/versions/
```

#### 数据库字段

`interview_sessions` 新增：

```text
current_stage      string
stage_plan_json    text
coverage_json      text
```

`interview_turns` 新增：

```text
stage              string
question_type      string
```

#### 后端实现要求

在 `service.py` 中新增纯函数：

```python
def _build_stage_plan(interview_type: str, round_limit: int, focus_tags: list[str]) -> list[dict]:
    ...
```

返回示例：

```json
[
  {"stage": "opening", "rounds": [1]},
  {"stage": "self_intro", "rounds": [2]},
  {"stage": "resume_deep_dive", "rounds": [3, 4]},
  {"stage": "technical_core", "rounds": [5, 6]},
  {"stage": "scenario", "rounds": [7]},
  {"stage": "wrap_up", "rounds": [8]}
]
```

新增：

```python
def _stage_for_turn(stage_plan: list[dict], turn_index: int) -> str:
    ...
```

新增：

```python
def _update_coverage(coverage: dict, stage: str, knowledge_points: list[str], score: dict) -> dict:
    ...
```

#### 强制规则

1. 创建面试时生成 `stage_plan_json`。
2. 创建第一轮时写入 `stage`。
3. 每次提交回答后，根据下一轮 `turn_index` 计算下一阶段。
4. 每个 `InterviewTurn` 必须保存 `stage`。
5. prompt 必须注入当前阶段和阶段目标。
6. 前端必须展示当前阶段。

#### 禁止事项

```text
不要只在 prompt 里说“当前阶段”。
不要让模型自由决定阶段。
不要每轮随机阶段。
不要引入 LangGraph。
```

#### 验收标准

1. 每个 session 有 `current_stage`。
2. 每个 turn 有 `stage`。
3. 前端显示“当前阶段：项目深挖/核心技术题/压力追问”等。
4. 报告能根据 `coverage_json` 指出哪些阶段覆盖不足。

### 3.5 增强题库检索解释性

当前 `knowledge.py` 已返回：

```text
title
topic
source_file
score
snippet
```

但前端展示不够。

#### 修改文件

```text
backend/app/interview/knowledge.py
backend/app/interview/service.py
backend/app/interview/schemas.py
frontend/src/student/AIInterviewerPage.tsx
```

#### 数据库字段

`interview_turns` 新增：

```text
question_reason
capability_tags_json
retrieval_query
retrieval_hit_count
top_sources_json
```

#### Prompt 输出要求

第一问必须返回：

```json
{
  "question_reason": "为什么问这个问题",
  "question_type": "resume_deep_dive",
  "capability_tags": ["项目证据", "岗位匹配"],
  "knowledge_points": ["Redis", "缓存设计"]
}
```

追问也必须返回：

```json
{
  "question_reason": "上一轮回答缺少量化指标，所以继续追问接口耗时和缓存 key 设计",
  "question_type": "project_deep_dive",
  "capability_tags": ["项目真实性", "技术细节", "量化结果"],
  "knowledge_points": ["Redis", "性能优化"]
}
```

#### 前端展示要求

每个 AI 问题下方展示：

```text
考察点
追问原因
题库命中来源
```

来源默认折叠，只展示 top 1-3：

```text
Redis面试题库.md / 缓存穿透 / score 0.92
```

不要默认展示长 snippet。

#### 无命中处理

如果没有 RAG 命中，前端显示：

```text
未命中题库，当前问题按简历和岗位要求自适应生成。
```

#### 验收标准

1. 用户能看到“为什么问我这个”。
2. 有 RAG 命中时显示来源。
3. 没有 RAG 命中时有明确说明。
4. 不暴露服务器绝对路径。

### 3.6 增强每轮评分可解释性

当前每轮反馈不够可信。

必须让用户知道为什么扣分。

#### 修改文件

```text
backend/app/interview/prompts.py
backend/app/interview/service.py
backend/app/interview/models.py
backend/app/interview/schemas.py
frontend/src/student/AIInterviewerPage.tsx
```

#### 数据库字段

`interview_turns` 新增：

```text
score_reasons_json
evidence_quotes_json
```

#### LLM 输出格式

`FOLLOWUP_USER_PROMPT` 必须要求：

```json
{
  "score": {
    "technical_accuracy": 3,
    "project_evidence": 2,
    "problem_solving": 3,
    "communication": 3,
    "job_fit": 3,
    "pressure_handling": 3
  },
  "score_reasons": {
    "technical_accuracy": "技术解释有方向，但没有展开关键边界",
    "project_evidence": "提到负责优化，但没有说明个人动作和量化结果",
    "problem_solving": "能描述问题，但没有拆解方案",
    "communication": "表达基本连贯，但结构不够清晰",
    "job_fit": "提到 Redis，和后端岗位相关",
    "pressure_handling": "被追问时没有回避，但证据不足"
  },
  "evidence_quotes": [
    {
      "quote": "我负责优化接口性能",
      "reason": "这句话说明有项目线索，但缺少具体方案和指标"
    }
  ]
}
```

#### 后端兜底要求

新增函数：

```python
def _normalize_score_reasons(raw: Any) -> dict[str, str]:
    ...
```

规则：

1. 缺少维度原因时填：

```text
本轮未提供足够证据。
```

2. 只保留 `SCORE_KEYS` 中的维度。

新增函数：

```python
def _filter_evidence_quotes(raw: Any, answer: str) -> list[dict]:
    ...
```

规则：

1. 最多保留 3 条。
2. `quote` 必须是用户回答中的原文片段。
3. 如果 quote 不在 answer 中，直接丢弃。
4. 不允许模型编造用户原话。

#### 前端展示

每轮反馈展示：

```text
维度小分
扣分原因
关键证据引用
```

#### 验收标准

1. 每轮反馈解释为什么扣分。
2. 证据引用必须来自用户回答原文。
3. 模型编造的 quote 会被后端丢弃。
4. 旧数据没有这些字段时页面不崩溃。

### 3.7 报告后增加训练闭环

当前报告只是复盘，不够形成用户留存。

必须增加复练计划。

#### 修改文件

```text
backend/app/interview/models.py
backend/app/interview/service.py
backend/app/interview/prompts.py
backend/app/interview/schemas.py
frontend/src/student/AIInterviewerPage.tsx
backend/alembic/versions/
```

#### 数据库字段

`interview_reports` 新增：

```text
training_plan_json
rewrite_examples_json
next_session_preset_json
```

#### 报告输出格式

`REPORT_USER_PROMPT` 必须要求：

```json
{
  "overall_score": 78,
  "dimension_scores": {
    "technical_accuracy": 78,
    "project_evidence": 70,
    "problem_solving": 76,
    "communication": 82,
    "job_fit": 80,
    "pressure_handling": 74
  },
  "strengths": [],
  "weaknesses": [],
  "suggestions": [],
  "next_questions": [],
  "training_plan": [
    {
      "day": 1,
      "focus": "项目证据",
      "tasks": ["补充项目背景", "准备量化指标", "练习 2 道追问题"],
      "expected_output": "一段 2 分钟项目介绍"
    }
  ],
  "rewrite_examples": [
    {
      "original_answer": "我负责优化接口性能",
      "better_answer": "在 XX 项目中，我负责订单查询接口优化，先通过日志定位到 MySQL 慢查询，再增加组合索引和 Redis 缓存，接口 P95 从 800ms 降到 230ms。",
      "why_better": "新回答补充了场景、个人动作、技术方案和量化结果"
    }
  ],
  "next_session_preset": {
    "target_role": "Java 后端开发工程师",
    "interview_type": "second_round",
    "interview_style": "strict",
    "focus_tags": ["resume_project", "technical_principle"]
  },
  "report_text": "完整复盘"
}
```

#### 后端兜底要求

如果 LLM 没有返回训练计划，后端必须生成 fallback：

```json
[
  {
    "day": 1,
    "focus": "最低分维度",
    "tasks": ["复盘本轮最低分问题", "准备一个具体项目案例", "补充量化指标"],
    "expected_output": "一段结构化回答"
  }
]
```

#### 前端展示

报告区增加：

```text
训练计划
回答改写示例
按此计划再练一场
```

点击“按此计划再练一场”：

1. 自动填充下一场面试配置。
2. 不要自动开始。
3. 让用户确认后点击“开始面试”。

#### 验收标准

1. 报告不是终点，而是下一场训练入口。
2. 用户能看到至少一个训练任务。
3. 用户能看到至少一个回答改写示例。
4. 旧报告缺少字段时页面不崩溃。

### 3.8 修复租户隔离和知识库重载权限

当前问题：

`_get_session` 只校验 `student_id`，必须加 `tenant_id`。

学生端目前可以调用：

```text
POST /api/v1/student/interviews/knowledge/reload
```

这是不安全的。

#### 修改文件

```text
backend/app/interview/service.py
backend/app/interview/router_student.py
frontend/src/student/AIInterviewerPage.tsx
```

#### 后端要求

`_get_session` 必须同时校验：

```python
session.student_id == identity.user_id
session.tenant_id == identity.tenant_id
```

`list_interviews` 必须加：

```python
InterviewSession.tenant_id == identity.tenant_id
```

`_build_report_comparison` 查询历史报告也必须加 tenant 条件。

#### 知识库 reload

学生端不得触发知识库重载。

处理方式二选一：

方案 A，删除学生端 reload 路由。

方案 B，将 reload 路由改成 admin 权限。

推荐方案 A：

```text
删除或禁用 /student/interviews/knowledge/reload
```

前端必须移除：

```text
重新索引知识库
```

按钮。

#### knowledge status 安全

`knowledge_status()` 不要向学生返回服务器绝对路径。

当前返回中有：

```text
root
```

学生端接口不要返回绝对路径。

可以返回：

```json
{
  "document_count": 10,
  "chunk_count": 200,
  "retriever": "local_sparse_vector",
  "vector_ready": true,
  "errors": []
}
```

#### 验收标准

1. 不同 tenant 学生不能互相访问面试 session。
2. 学生不能调用知识库 reload。
3. 前端不显示“重新索引知识库”。
4. 学生端接口不泄露服务器本地绝对路径。

## 4. Prompt 修改要求

修改文件：

```text
backend/app/interview/prompts.py
```

### 4.1 START_USER_PROMPT 输出格式

必须要求模型返回：

```json
{
  "resume_brief": "基于简历和岗位的候选人画像摘要",
  "focus_points": ["最需要验证的点1", "最需要验证的点2"],
  "first_question": "第一轮问题",
  "question_reason": "为什么第一轮问这个",
  "question_type": "resume_deep_dive",
  "capability_tags": ["项目证据", "岗位匹配"],
  "knowledge_points": ["Redis", "接口性能"]
}
```

### 4.2 FOLLOWUP_USER_PROMPT 输出格式

必须要求模型返回：

```json
{
  "answer_assessment": {
    "summary": "对上一轮回答的简短评价",
    "is_vague": true,
    "risk_points": ["缺少量化指标"],
    "positive_points": ["提到了 Redis 缓存"]
  },
  "score": {
    "technical_accuracy": 3,
    "project_evidence": 2,
    "problem_solving": 3,
    "communication": 3,
    "job_fit": 3,
    "pressure_handling": 3
  },
  "score_reasons": {
    "technical_accuracy": "原因",
    "project_evidence": "原因",
    "problem_solving": "原因",
    "communication": "原因",
    "job_fit": "原因",
    "pressure_handling": "原因"
  },
  "evidence_quotes": [
    {
      "quote": "用户回答中的原文短句",
      "reason": "为什么这句话影响评分"
    }
  ],
  "followup_strategy": "追问缓存设计细节和指标",
  "interviewer_tone": "strict",
  "next_question": "下一轮问题",
  "question_reason": "为什么继续这样追问",
  "question_type": "project_deep_dive",
  "capability_tags": ["项目真实性", "技术细节"],
  "knowledge_points": ["Redis", "缓存设计"],
  "should_end": false
}
```

### 4.3 REPORT_USER_PROMPT 输出格式

必须要求模型返回：

```json
{
  "overall_score": 78,
  "dimension_scores": {
    "technical_accuracy": 78,
    "project_evidence": 70,
    "problem_solving": 76,
    "communication": 82,
    "job_fit": 80,
    "pressure_handling": 74
  },
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["最薄弱问题必须放第1条"],
  "suggestions": ["针对最低分维度的训练动作必须放第1条"],
  "next_questions": ["下一轮训练题1", "下一轮训练题2"],
  "training_plan": [],
  "rewrite_examples": [],
  "next_session_preset": {},
  "report_text": "完整复盘"
}
```

### 4.4 Prompt 硬性规则

必须写入 prompt：

```text
禁止编造用户没说过的经历。
禁止根据姓名、学校、年级、邮箱推断能力。
评分必须基于回答文本、简历、JD、题库检索。
evidence_quotes.quote 必须来自用户回答原文。
每轮只问一个主问题。
如果问题有多个回答点，必须 Markdown 编号列表，每个编号单独换行。
不要直接给标准答案，除非当前是报告或复盘阶段。
```

## 5. Alembic 迁移要求

必须新增 migration。

新增字段至少包括：

### interview_sessions

```text
company_name
seniority_level
job_skills_json
job_profile_json
current_stage
stage_plan_json
coverage_json
```

### interview_turns

```text
stage
question_type
question_reason
capability_tags_json
retrieval_query
retrieval_hit_count
top_sources_json
score_reasons_json
evidence_quotes_json
```

### interview_reports

```text
training_plan_json
rewrite_examples_json
next_session_preset_json
```

### 迁移要求

1. 兼容已有数据。
2. 新字段优先 nullable。
3. 对 `current_stage` 可以设置默认值：

```text
opening
```

4. 旧报告和旧 turn 在前端展示时不能崩溃。

## 6. 前端修改要求

修改文件：

```text
frontend/src/student/AIInterviewerPage.tsx
```

必须完成：

1. 目标岗位为空时阻止开始。
2. 增加公司/组织输入。
3. 增加岗位级别选择。
4. 增加核心技能标签输入。
5. 展示当前面试阶段。
6. 每轮问题展示：
   - 考察点
   - 追问原因
   - 题库命中来源
7. 每轮反馈展示：
   - 维度小分
   - 扣分原因
   - 证据引用
8. 报告区展示：
   - 训练计划
   - 回答改写示例
   - 下一场预设
9. 移除学生端“重新索引知识库”按钮。
10. “通话面试”如果不可用，降低视觉权重，不要让用户误以为已上线。

### 禁止事项

```text
不要重写整个页面。
不要引入新 UI 框架。
不要破坏历史记录加载。
不要破坏语音输入。
不要破坏现有报告展示。
```

## 7. 后端测试要求

必须新增或修改测试。

目录：

```text
backend/tests/
```

至少覆盖：

1. 空目标岗位会被拒绝。
2. 只包含空格的目标岗位会被拒绝。
3. `_get_session` 不能访问其他 tenant 的 session。
4. `list_interviews` 只返回当前 tenant 数据。
5. 普通学生不能调用知识库 reload。
6. 每轮评分缺少字段时会兜底补齐。
7. `evidence_quotes` 不在用户回答中时会被丢弃。
8. 报告缺少训练计划时会生成 fallback training plan。
9. 阶段计划能根据轮次返回正确 stage。

建议把以下函数写成纯函数并测试：

```python
_build_stage_plan
_stage_for_turn
_normalize_score_reasons
_filter_evidence_quotes
_extract_job_skills
_build_fallback_training_plan
```

## 8. 禁止事项总表

严禁：

```text
不要引入 LangGraph。
不要引入 LangChain。
不要只改 prompt，不改数据库结构。
不要只改前端展示，不存数据库。
不要假装已经接入向量数据库。
不要假装已经接入视频通话或数字人。
不要新增无法运行的依赖。
不要删除旧数据表。
不要破坏简历助手。
不要让学生端触发知识库重载。
不要泄露服务器本地绝对路径。
不要让 AI 面试官生成、修改或导出简历。
不要让评分引用用户没有说过的话。
```

## 9. 最终验收流程

完成修改后必须验证：

1. 后端测试通过。
2. 前端能正常构建。
3. 创建一场目标岗位为：

```text
Java 后端开发工程师
```

的面试。

4. 粘贴一段包含 Redis、MySQL、Spring Boot 的 JD。
5. 第一问必须体现岗位、JD、简历或技能标签。
6. 用户回答一句空泛内容：

```text
我负责优化接口性能，也熟悉 Redis。
```

7. 系统必须指出：
   - 回答空泛
   - 缺少个人动作
   - 缺少量化指标
   - 需要继续追问技术细节

8. 本轮反馈必须显示：
   - 维度分
   - 扣分原因
   - 来自用户回答原文的证据引用

9. 结束并生成报告。
10. 报告必须显示：
    - 综合评分
    - 最低分维度
    - 训练计划
    - 回答改写示例
    - 下一场面试预设

11. 学生端不能看到“重新索引知识库”按钮。
12. 普通学生直接请求：

```text
POST /api/v1/student/interviews/knowledge/reload
```

必须失败或路由不存在。

## 10. 最终回复要求

修改完成后，最终回复必须说明：

1. 修改了哪些文件。
2. 新增了哪些数据库字段。
3. 是否新增 migration。
4. 是否新增测试。
5. 测试是否通过。
6. 是否引入 LangGraph。

LangGraph 结论必须写：

```text
未引入 LangGraph。本次状态机是业务阶段状态机，已用数据库字段和 service.py 纯函数实现，符合当前项目架构。
```
