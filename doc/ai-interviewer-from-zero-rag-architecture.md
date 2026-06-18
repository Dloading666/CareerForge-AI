# AI 面试官从 0 搭建与知识库检索增强设计

## 1. 当前资料检查

本地题库路径：

```text
D:\Ai Agent\Knowledge Base
```

当前目录结构：

```text
Knowledge Base/
  agent/
    代码题/
    场景题/
    基础理论/
    框架协议/
    题库/
  java/
    代码题/
    场景题/
    基础理论/
    题库/
```

题库特点：

- 文件格式以 Markdown 为主。
- 已经覆盖 Java 后端和 AI Agent 两条方向。
- Java 题库包含 MySQL、Redis、Spring、Kafka、分布式、Elasticsearch、容器化等主题。
- Agent 题库包含 RAG、ReAct、上下文工程、Function Calling、MCP、工程化、项目表达等主题。
- 适合直接作为第一版 RAG 知识库。

注意事项：

- PowerShell 读取部分 Markdown 时出现中文乱码，导入前必须做编码探测和 UTF-8 统一。
- 文件名、目录名本身具有很强的分类信息，导入时要作为 metadata 保存。
- 题库里存在“问题、答案、考点分析、难度、适用岗位”等结构，应优先按问答对和章节切分，而不是固定长度硬切。

## 2. 第一阶段目标

先不做视频、语音和复杂虚拟人，第一阶段只做文本对话式 AI 面试官。

目标闭环：

```text
学生选择方向/岗位
  ↓
系统读取简历/JD/题库知识
  ↓
AI 面试官生成第一题
  ↓
学生回答
  ↓
系统检索相关知识和评分规则
  ↓
AI 面试官追问或压力反问
  ↓
多轮对话后生成面试报告
```

第一阶段必须做到：

- 能从知识库检索相关题目、知识点、答案要点。
- AI 不是机械抽题，而是根据学生回答动态追问。
- 面试开始时可以俏皮一点，正式面试时必须严格、犀利、敢反问。
- 每一轮回答都有评分依据。
- 面试结束有结构化报告。

## 3. 知识库能不能做成知识图谱

可以，而且很适合。

但推荐分两步：

### 3.1 第一版：RAG 检索增强

先做：

- Markdown 解析。
- 问答对抽取。
- metadata 标注。
- 向量检索。
- 关键词检索。
- 混合召回。
- rerank 精排。

第一版不要急着上 Neo4j，否则会卡在抽实体、建边、维护图谱上，主面试功能反而慢。

### 3.2 第二版：知识图谱增强 RAG

等文本面试跑通后，再加知识图谱。

图谱结构：

```text
岗位 -> 需要 -> 技能
技能 -> 包含 -> 知识点
知识点 -> 对应 -> 面试题
面试题 -> 考察 -> 能力维度
学生简历 -> 包含 -> 项目
项目 -> 使用 -> 技术
回答 -> 暴露 -> 短板
短板 -> 推荐 -> 训练题
```

例子：

```text
Java 后端开发
  -> 需要 -> Redis
Redis
  -> 包含 -> 缓存穿透
缓存穿透
  -> 对应 -> 如何解决缓存穿透？
如何解决缓存穿透？
  -> 考察 -> 缓存设计、系统稳定性、工程经验
```

价值：

- 追问路径更稳定。
- 可以从一个技术点自动扩展到相关知识点。
- 可以根据学生短板推荐下一组训练题。
- 可以解释“为什么问这个问题”。

## 4. 检索增强设计

### 4.1 导入流程

```text
扫描文件
  ↓
编码探测与统一 UTF-8
  ↓
Markdown 结构解析
  ↓
章节切分 / 问答对切分
  ↓
metadata 标注
  ↓
关键词索引 BM25
  ↓
向量索引 Embedding
  ↓
题目结构化入库
```

### 4.2 Chunk 切分策略

不要用简单的每 500 字切一块。

建议：

| 内容类型 | 切分方式 |
| --- | --- |
| 题库文件 | 按 `### Q` 或题号切成问答对 |
| 基础理论 | 按二级/三级标题切分 |
| 场景题 | 按场景和追问点切分 |
| 代码题 | 按题目、思路、代码、复杂度切分 |
| 项目表达 | 按表达模板、追问策略、优秀回答切分 |

每个 chunk 建议保存：

```json
{
  "chunk_id": "java.redis.q7",
  "domain": "java",
  "category": "题库",
  "topic": "Redis",
  "question": "什么是缓存穿透？",
  "answer": "...",
  "difficulty": "medium",
  "position": ["Java 后端开发"],
  "capability": ["缓存设计", "系统稳定性"],
  "source_file": "java/题库/02_Redis面试题库.md",
  "heading_path": ["Redis", "缓存策略", "Q7"],
  "text": "完整可检索文本"
}
```

### 4.3 检索链路

推荐做混合检索：

```text
用户当前回答 + 岗位 + 当前问题
  ↓
意图识别
  ↓
Query Rewrite
  ↓
BM25 关键词召回 Top 30
  ↓
向量召回 Top 30
  ↓
RRF 融合排序
  ↓
Rerank 精排 Top 8
  ↓
LLM 生成追问
```

为什么要混合检索：

- BM25 擅长精确术语：Redis、AOF、MVCC、Spring AOP。
- 向量检索擅长语义匹配：接口变慢、缓存不一致、系统扛不住。
- Rerank 负责把最适合当前回答的知识放到前面。

### 4.4 检索意图分类

每次追问前先判断当前要检索什么：

| 意图 | 例子 | 检索重点 |
| --- | --- | --- |
| 技术基础 | “Redis 为什么快？” | 基础理论和题库 |
| 项目深挖 | “你项目里怎么用 Redis？” | 场景题和项目表达 |
| 系统设计 | “高并发下怎么保证稳定？” | 场景题和架构题 |
| 代码能力 | “实现一个 LRU。” | 代码题 |
| 行为表达 | “团队冲突怎么处理？” | 项目表达和 STAR |
| 压力反问 | “你说优化了，有数据吗？” | 评分规则和追问模板 |

### 4.5 召回后过滤规则

必须做过滤，不然 AI 会拿不相干题目乱问。

过滤条件：

- 岗位不匹配的内容降权。
- 难度高于当前面试难度太多的内容降权。
- 已问过的问题去重。
- 与学生回答没有实体交集的内容降权。
- 同一文件重复 chunk 最多保留 2 条。

## 5. 可落地系统架构

### 5.1 总体架构

```text
React 学生端
  - 面试入口
  - 对话面试房间
  - 历史记录
  - 面试报告
        ↓
FastAPI 后端
  - Interview Session API
  - Knowledge Ingestion API
  - Retrieval Service
  - Interview Orchestrator
  - Scoring Service
  - Report Service
        ↓
数据层
  - MySQL: 用户、会话、轮次、报告、题目元数据
  - Vector DB: Chroma / Qdrant / pgvector
  - BM25 Index: SQLite FTS / Tantivy / Elasticsearch
  - Redis: 会话缓存、任务状态
        ↓
模型层
  - LLM: 提问、追问、评分、报告
  - Embedding: 知识库向量化
  - Reranker: 检索精排
```

### 5.2 第一版推荐技术选型

结合当前项目已有 FastAPI + React + MySQL + Redis，第一版建议：

| 模块 | 推荐 |
| --- | --- |
| 后端 | 继续用 FastAPI |
| 前端 | 继续用 React/Vite |
| 主数据库 | MySQL |
| 向量库 | Chroma 或 Qdrant |
| 关键词检索 | SQLite FTS5 或 Elasticsearch |
| Embedding | BGE-M3 / text-embedding-3-small / 通义 embedding |
| Rerank | bge-reranker 或 API reranker |
| LLM | DeepSeek/Qwen/GPT 等 |

最低成本落地：

- 第一版用 Chroma 本地向量库。
- BM25 可以先用 Python `rank-bm25` 或 SQLite FTS。
- 后续再替换 Qdrant/Elasticsearch。

### 5.3 后端模块

```text
backend/app/interview/
  models.py
  schemas.py
  router_student.py
  service.py
  orchestrator.py
  scoring.py
  report.py
  prompts.py

backend/app/knowledge/
  models.py
  schemas.py
  router_admin.py
  ingestion.py
  parser.py
  retriever.py
  reranker.py
  graph_builder.py
```

### 5.4 核心数据表

#### knowledge_documents

| 字段 | 说明 |
| --- | --- |
| id | 文档 ID |
| path | 原始文件路径 |
| title | 文档标题 |
| domain | java/agent |
| category | 题库/基础理论/场景题 |
| checksum | 文件哈希，用于增量更新 |
| status | indexed/failed |

#### knowledge_chunks

| 字段 | 说明 |
| --- | --- |
| id | chunk ID |
| document_id | 文档 ID |
| topic | 主题 |
| question | 问题 |
| answer | 答案 |
| difficulty | 难度 |
| capability | 能力维度 |
| text | 完整文本 |
| metadata_json | 扩展元数据 |

#### interview_sessions

| 字段 | 说明 |
| --- | --- |
| id | 会话 ID |
| student_id | 学生 ID |
| target_role | 目标岗位 |
| interview_type | technical/project/hr/stress |
| style | friendly/strict/stress |
| status | active/completed |

#### interview_turns

| 字段 | 说明 |
| --- | --- |
| id | 轮次 ID |
| session_id | 会话 ID |
| question | AI 问题 |
| answer | 学生回答 |
| retrieved_chunks | 本轮引用的知识 |
| score_json | 本轮评分 |
| followup_reason | 追问原因 |

#### interview_reports

| 字段 | 说明 |
| --- | --- |
| id | 报告 ID |
| session_id | 会话 ID |
| overall_score | 总分 |
| dimension_scores | 分维度评分 |
| strengths | 优势 |
| weaknesses | 问题 |
| next_plan | 下一轮训练计划 |

## 6. 对话风格设计

你的创意可以设计成“双阶段人格”：

### 6.1 面试前：俏皮、有趣、降低紧张

目的：

- 让学生愿意开始。
- 降低焦虑。
- 给出轻微鼓励。

语气示例：

```text
准备好了吗？我会先温柔开场，但如果你说“熟悉 Redis”却讲不出缓存击穿，那我可就要认真追问了。
```

### 6.2 面试中：严格、犀利、敢反问

目的：

- 模拟真实技术面。
- 逼学生讲细节。
- 抓住空泛回答、虚假项目、没有数据的问题。

语气规则：

- 不羞辱、不攻击人格。
- 但可以质疑回答。
- 必须要求证据、数据、方案细节。
- 发现空话要直接指出。
- 每次只问一个问题。

严格追问示例：

```text
你说“提升了性能”，这个说法太宽了。提升前后分别是多少？你具体改了哪一段链路？
```

压力面示例：

```text
如果我是面试官，我现在还不能相信这是你主导的。请你用数据库表设计、接口设计或压测数据中的一个细节证明你的参与度。
```

## 7. 评分维度设计

参考资料：

- GitHub 技术面试文章强调使用自动测试、清晰 rubric 和 scorecard，让评估更客观一致。
- 开源 `eng-rubrics` 项目采用 5 个 competency areas、1-5 分行为锚点和 seniority threshold 的结构。
- AI interview coach 类项目常用 STAR、clarity、impact、strengths、focus areas 等维度。
- 结构化面试资料普遍强调 competency-based questions、scorecards、debrief template。

第一版评分维度建议：

| 维度 | 权重 | 评分依据 |
| --- | --- | --- |
| 技术准确性 | 25% | 概念是否正确，是否能解释原理、边界和取舍 |
| 项目真实性与细节 | 20% | 是否能说明个人职责、实现细节、数据指标 |
| 问题解决能力 | 20% | 是否能定位问题、提出方案、比较替代方案 |
| 逻辑结构与表达 | 15% | 是否结构清晰，是否使用 STAR/背景-行动-结果 |
| 岗位匹配度 | 15% | 是否覆盖 JD 核心技能和业务要求 |
| 压力应对 | 5% | 被反问时是否能稳定、诚实、补充证据 |

### 7.1 1-5 分行为锚点

| 分数 | 行为表现 |
| --- | --- |
| 1 | 回答错误或严重跑题，无法解释核心概念 |
| 2 | 有关键词，但解释浅，缺少细节和真实经验 |
| 3 | 回答基本正确，有一定项目关联，但深度一般 |
| 4 | 回答准确，有项目细节、数据或取舍分析 |
| 5 | 回答深入，能讲原理、场景、风险、替代方案和复盘 |

### 7.2 报告等级

| 总分 | 等级 | 解释 |
| --- | --- | --- |
| 90-100 | 强推荐 | 表达成熟，技术深度和项目证据充分 |
| 80-89 | 推荐 | 能胜任岗位，多数回答可靠 |
| 70-79 | 有潜力 | 基础可用，但需要补细节和表达 |
| 60-69 | 风险较高 | 知识碎片化，项目表达薄弱 |
| <60 | 暂不建议 | 当前面试表现难以支撑目标岗位 |

## 8. 动态追问 Prompt

### 8.1 系统 Prompt

```text
你是 CareerForge-AI 的 AI 面试官，负责对学生进行模拟面试训练。

你的风格分为两个阶段：
1. 面试开始前可以轻松、俏皮、鼓励，让候选人放松。
2. 正式面试开始后必须严格、专业、犀利。你可以反问、追问、压力测试，但不能羞辱候选人，不能攻击人格。

你必须遵守：
- 每次只问一个问题。
- 问题必须具体，不能泛泛而谈。
- 优先追问候选人刚刚提到但没有展开的内容。
- 如果候选人回答空泛，要直接指出空泛在哪里。
- 如果候选人声称“优化、负责、熟悉、参与、提升”，必须追问证据、指标、实现细节或个人职责。
- 如果候选人回答明显错误，要先指出风险，再给一次补救机会。
- 不要直接给标准答案，除非当前阶段是复盘。
- 不要编造候选人没有说过的经历。
- 所有输出必须是 JSON。

评分必须基于以下维度：
- technical_accuracy 技术准确性
- project_evidence 项目真实性与细节
- problem_solving 问题解决能力
- communication 逻辑结构与表达
- job_fit 岗位匹配度
- pressure_handling 压力应对
```

### 8.2 每轮追问 Prompt

```text
请根据以下信息生成下一轮面试追问。

【目标岗位】
{target_role}

【岗位 JD】
{job_description}

【面试类型】
{interview_type}

【面试风格】
{interview_style}

【候选人简历摘要】
{resume_summary}

【历史问答】
{conversation_history}

【上一轮问题】
{last_question}

【候选人上一轮回答】
{last_answer}

【知识库检索结果】
{retrieved_context}

【已问过的知识点】
{asked_topics}

请完成以下任务：
1. 判断候选人上一轮回答的质量。
2. 找出最值得追问的一个点。
3. 如果回答空泛，要用严格但专业的方式指出。
4. 如果回答涉及技术点，要追问原理、实现、边界、故障处理或指标。
5. 如果回答涉及项目经历，要追问个人职责、具体方案、数据结果或复盘。
6. 如果适合压力面试，可以提出质疑，但不能人身攻击。
7. 生成下一轮问题。

输出 JSON，格式如下：
{
  "answer_assessment": {
    "summary": "对上一轮回答的简短评价",
    "is_vague": true,
    "risk_points": ["缺少量化指标", "没有说明个人职责"],
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
  "followup_strategy": "追问缓存设计细节和指标",
  "interviewer_tone": "strict",
  "next_question": "你刚才说使用 Redis 提升了查询性能，这个说法还不够具体。请说明你缓存了哪些数据，key 是怎么设计的，优化前后接口耗时分别是多少？",
  "question_type": "project_deep_dive",
  "knowledge_points": ["Redis", "缓存设计", "性能优化"],
  "should_end": false
}
```

### 8.3 压力追问 Prompt 片段

```text
当候选人的回答存在以下情况时，进入压力追问：
- 使用“负责、参与、熟悉、优化、提升”等词，但没有证据。
- 声称使用某技术，但无法说明原理或实现。
- 项目成果没有指标。
- 回答明显像背诵，无法结合个人项目。

压力追问要求：
- 语气严厉，但保持职业。
- 只质疑回答，不质疑人格。
- 必须要求候选人给出一个可验证细节。

可用句式：
- “这个回答还不足以证明你真的做过，请补充一个实现细节。”
- “你说优化了性能，优化前后数据是多少？”
- “如果我继续追问源码或异常场景，你能讲清楚吗？先从一个具体场景开始。”
- “你现在的回答偏概念，我需要听到你在项目里具体怎么落地。”
```

## 9. 落地路线

### 第 1 周：文本面试 MVP

- 导入知识库文件。
- 实现基础检索。
- 实现创建面试、提交回答、动态追问。
- 实现基础评分。
- 实现面试报告。

### 第 2 周：检索增强

- 增加 metadata。
- 增加 BM25 + 向量混合检索。
- 增加 rerank。
- 增加题目去重和已问知识点追踪。

### 第 3 周：知识图谱雏形

- 抽取岗位、技能、知识点、题目、能力维度。
- 建立简单图谱表。
- 用图谱辅助追问路径。

### 第 4 周：体验优化

- 加入面试前俏皮开场。
- 加入压力面模式。
- 加入历史记录和弱项训练建议。

## 10. 可行性检查

可行：

- 当前项目已有 FastAPI、React、MySQL、Redis，能支撑第一版。
- 本地题库已经有足够内容，不需要从零造题。
- Markdown 题库适合做 RAG。
- 第一版只做文本对话，复杂度可控。

主要风险：

- 中文编码不统一会影响解析和检索。
- 题库内容如果只有标准答案，缺少评分标准，需要补充 rubric。
- 只用向量检索容易漏掉精确技术词，必须加 BM25。
- AI 压力面容易过度冒犯，需要用 Prompt 和输出规范限制。
- 知识图谱如果一开始做太重，会拖慢 MVP。

推荐结论：

先做 RAG 增强文本面试官，再做知识图谱。第一版的关键不是虚拟人，而是让 AI 真的能“问到点上、追得下去、评得有理有据”。

