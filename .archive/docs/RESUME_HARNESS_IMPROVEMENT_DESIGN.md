# 简历助手 Harness 质量提升与运行时解耦 — 产品设计文档

> CareerForge-AI · AI 简历助手子系统  
> 文档版本：v1.0  
> 最后更新：2026-06-10  
> 关联文档：`DESIGN.md`（系统总设计）、`AGENT_LOOP_AND_KB_DEV_PLAN.md`（Agentic 改造计划）、`CLAUDE.md`（架构速查）

---

## 1. 文档目的与范围

### 1.1 目的

本文档针对 AI 简历助手子系统当前存在的工程质量与产品体验问题，提出系统性改进方案。改进覆盖三个层面：

1. **事实校验与反幻觉防线的契约统一** — 解决校验规则、提示词、证据来源、旁路工具四者不对齐导致的误拒与绕过并存问题。
2. **简历产出质量的结构性提升** — 从"防编造"扩展到"防平庸"，引入素材访谈、质量闸门、事实/表达分离机制。
3. **运行时架构解耦** — 将智能体执行从页面 SSE 连接解耦为后台任务，支持断线重连、状态回看、并发控制。

### 1.2 范围

| 包含 | 不包含 |
|------|--------|
| `agent_runtime.py` 核心循环与工具实现 | AI 面试官子系统 |
| `run_manager.py` 运行时解耦 | 管理端功能 |
| `chatRuntimeStore.ts` 前端运行态管理 | 简历在线编辑器功能改造 |
| `AgentChatView.tsx` 对话界面集成 | 数据库 schema 变更（已有迁移除外） |
| 事实校验、质量闸门、证据池机制 | 向量检索、RAG 等重基础设施 |

---

## 2. 现状分析

### 2.1 系统架构概览

简历助手遵循 **Agent = Model + Harness** 架构原则：Model（LLM）只负责理解意图、规划步骤、生成内容；Harness（`agent_runtime.py`，约 4100 行）负责循环控制、工具调度、权限校验、事实核验、审计日志、错误恢复。

核心数据流：

```
学生输入 → _build_initial_messages → run_agent_loop（for iteration in range(max_iterations)）
  ├→ _stream_llm_turn（SSE 流式输出）
  │   ├→ _dispatch_tool（工具执行 + 审计）
  │   └→ 非工具回复 → break
  └→ 触顶 → 强制无工具收尾
```

### 2.2 已完成的改进（v1–v5）

以下改进已在前五轮迭代中落地并部署：

| 改进项 | 涉及模块 | 状态 |
|--------|----------|------|
| `SessionEvidencePool` 会话级证据池 | `agent_runtime.py` | ✅ 已部署 |
| `FactWhitelist` 实体级事实白名单 | `agent_runtime.py` | ✅ 已部署 |
| `_check_resume_quality` 确定性质量闸门 | `agent_runtime.py` | ✅ 已部署 |
| `_assess_evidence_quality` 素材质量评估 | `agent_runtime.py` | ✅ 已部署 |
| `_normalize_literal_escapes` 双重转义修复 | `agent_runtime.py` | ✅ 已部署（位置待修正） |
| HMAC 签名下载端点 + 路径穿越防护 + 用户隔离 | `router.py` + `main.py` | ✅ 已部署 |
| `httpx.AsyncClient` 异步网页工具 + PDF 线程池 | `agent_runtime.py` | ✅ 已部署 |
| `reasoning_effort` 保守白名单策略 | `agent_runtime.py` | ✅ 已部署 |
| `read_resume` session_id=0 过滤 | `agent_runtime.py` | ✅ 已部署 |
| `RunManager` + `StudentAgentRun`/`StudentAgentRunEvent` 表 | `run_manager.py` + `agent_models.py` | ✅ 已部署 |
| `chatRuntimeStore` 前端运行态管理 | `chatRuntimeStore.ts` | ✅ 已部署 |
| Alembic 迁移 `20260611_0018` | `alembic/versions/` | ✅ 已部署 |
| 死代码清理（`_MAX_INTERVIEW_ROUNDS`、`mark_export_attachment`、同步 `_export_resume_pdf_tool`） | `agent_runtime.py` | ✅ 已完成 |

### 2.3 遗留问题清单

经全面审查，当前代码仍存在以下问题，按优先级排列：

#### P0 — 必须上线前修复（4 项）

| 编号 | 问题 | 影响 | 根因 |
|------|------|------|------|
| P0-1 | `_normalize_literal_escapes` 仅在 `_build_resume_doc`（保存时）调用，事实校验和质量闸门仍处理原始 `args` | 字面 `\\n` 导致正则提取出 `nAI` → 不在白名单 → 误报拦截 → 模型重试死循环 | 规范化函数调用位置晚于校验环节 |
| P0-2 | `update_resume_data` 的空章节检查会拦掉所有合法局部更新 | 模型只想改自我评价时，`args` 无 education/experience/projects → 误判章节为空 → 合法更新被拒 | `update` 是部分合并工具，不应要求章节完整 |
| P0-3 | `_extract_candidate_facts` 的 `proper_nouns` 集合从未被填充 | 模型编造中文公司名/学校名直接通过校验 | 提取逻辑遗漏了结构化字段遍历 |
| P0-4 | 日期格式检查对 `"2022.06 - 2024.12"` 误报（区间分隔符 `-` 被当作日期格式混用） | `generate` 被卡死，模型无法通过校验 | 未按范围分隔符拆分单个日期 token |

#### P1 — 下一轮迭代修复（5 项）

| 编号 | 问题 | 影响 |
|------|------|------|
| P1-1 | 白名单与候选的字符串比对缺少归一化（大小写、空格、分隔符差异） | `Python` vs `python`、`30%` vs `30 %` 误判为无来源 |
| P1-2 | 导出 PDF 的签名下载 URL 被模型写入消息正文，10 分钟后 token 过期 | 用户回看历史对话时链接失效 |
| P1-3 | 中文实体提取粒度过粗（连续汉字串整句匹配），等价于退回整行字面校验 | prompt 要求的强动词/STAR 改写仍会被拦 |
| P1-4 | `_run_detached` 端到端未经真实会话验证 | 延迟导入的函数若依赖 request-scoped 状态会崩溃 |
| P1-5 | `subscribe()` 不输出 `:seq` 注释，断线重连后 `afterSeq` 停在 0 | 重连时重放全部历史事件 |

#### P2 — 持续改进（6 项）

| 编号 | 问题 |
|------|------|
| P2-1 | `_ensure_attachment_text_async` 定义但未调用，`read_resume` 仍用同步版解析 PDF |
| P2-2 | skill 前置门槛 per-run 重置，跨轮"确认后保存"需重调 skill |
| P2-3 | 上下文无总预算控制，多轮对话 + 大工具结果可能超模型 context window |
| P2-4 | 同一 session 并发两条流无互斥 |
| P2-5 | `ask` 权限态实际等于拒绝（无确认回路） |
| P2-6 | 导出 PDF 的 section 关键词表不够全面（缺少"工作/实习/Experience"等） |

---

## 3. 改进方案

### 3.1 事实校验契约统一

#### 3.1.1 目标

消除"校验规则、提示词、证据来源、旁路工具"四者不对齐的问题，使同一套事实契约贯穿 generate → optimize → update → export 全链路。

#### 3.1.2 证据池（SessionEvidencePool）设计

**生命周期**：绑定到单次 `run_agent_loop` 调用，跨 turn 不持久。

**数据来源**：

| 来源 | 写入时机 | 内容 |
|------|----------|------|
| 学生个人档案 | `_dispatch_tool` 执行前无条件查询 | 姓名、学校、专业、技能、经历等结构化字段 |
| `read_resume` 读取结果 | `read_resume` 工具执行完成后 | 在线简历 JSON 或个人中心 PDF 文本 |
| 本轮附件文本 | `analyze_uploaded_file` 执行完成后 | 学生上传的 PDF/DOCX/图片 OCR 文本 |
| 学生对话内容 | 模型 tool call 参数中的 `source_resume_id` 对应简历 | 显式指定的简历版本 |

**回声防护**：

- 本轮 `export_resume_pdf` 产出的附件不得进入证据池。
- 非 `session_id=0` 且来源不可追溯的历史 PDF 不能单独作为权威事实。

#### 3.1.3 事实/表达分离的校验粒度

将事实校验从"整行子串匹配"重构为**实体级白名单核验**：

**必须有据层（Hard Facts）** — 服务端从证据中提取，不允许无来源新增：

| 实体类型 | 提取方式 | 比对方式 |
|----------|----------|----------|
| 数字/指标 | 正则 `[0-9]+[.%]?` | 候选 ⊆ 白名单（归一化后） |
| 英文技术词 | 正则 `[A-Za-z][A-Za-z0-9_.+#]{1,}`（长度 ≥ 2） | 候选 ⊆ 白名单（casefold） |
| 时间段 | `_SINGLE_DATE_RE` + 范围分隔符拆分 | 候选 ⊆ 白名单（归一化） |
| 专名（公司/学校/项目名） | 结构化字段精确提取：`experience[].company`、`education[].school/major/degree`、`projects[].name/role`、`experience[].position` | 候选 ⊆ 白名单（精确匹配） |

**表达层（Soft Wording）** — 完全放开：

- 句式、动词、顺序、详略、STAR 重组均允许改写。
- 中文连续汉字串不参与校验（避免整句字面匹配回退）。

**归一化函数 `_norm_token`**：

```
输入 → casefold() → 去除所有内部空白 → 输出
```

所有白名单提取和候选比对环节统一应用。

#### 3.1.4 `_normalize_literal_escapes` 调用位置修正

当前仅在 `_build_resume_doc`（保存前）调用，导致事实校验和质量闸门处理原始 `args` 时仍遇到字面 `\\n`。

**修正方案**：在以下三个工具函数的 `_validate_resume_facts` 调用前，先执行 `args = _normalize_literal_escapes(args)`：

1. `_generate_resume_data_tool` 入口
2. `_optimize_resume_data_tool` 入口
3. `_update_resume_data_tool` 入口

`_build_resume_doc` 中的调用保留（兜底）。

规范化规则：

| 字面序列 | 替换为 |
|----------|--------|
| `\\n` | `\n` |
| `\\r\\n` | `\n` |
| `\\t` | `\t` |

### 3.2 简历产出质量提升

#### 3.2.1 素材访谈机制

**设计理念**：将反幻觉约束从"被动防御"转化为"主动引导"。当学生素材不足以产出高质量简历时，Harness 强制模型转向素材追问，而非勉强生成平庸内容。

**触发条件**：`_assess_evidence_quality(evidence_sources)` 返回 `status: "insufficient"`。

判定规则：

| 条件 | 阈值 | 结果 |
|------|------|------|
| `total_items == 0` | — | `insufficient` + 默认引导建议 |
| `items_with_numbers / total_items < 0.2` | 20% | `insufficient` + "请补充量化成果" |
| `items_with_results / total_items < 0.2` | 20% | `insufficient` + "请补充项目成果描述" |

**profile 兜底**：`_dispatch_tool` 中评估前无条件执行 `_query_student_profile` 并入证据池，避免跨轮场景下证据池为空导致误判。

**模型行为**：收到 `insufficient` 结果后，模型应逐条追问学生：

- "这个项目服务多少用户？上线后有什么可量化的效果？"
- "团队几个人，你的角色是什么？"

学生回答的内容进入证据池（本轮对话内容天然是合法事实来源），然后才允许动笔生成。

#### 3.2.2 确定性质量闸门

**函数**：`_check_resume_quality(args, *, require_sections=False)`

在 `generate`、`optimize`、`update` 三条路径的保存前执行。`error` 级别阻止保存，`warning` 级别追加到返回摘要。

| 检查项 | 规则 | 级别 |
|--------|------|------|
| 空章节检查 | education + experience + projects 全空，且证据中有经历记录 | error |
| 强动词开头率 | bullet 中以强动词开头的比例低于 60%（对照动词表） | warning |
| 数字/量化覆盖率 | 含数字的 bullet 比例低于 30% | warning |
| bullet 长度 | 单条 bullet 超过 80 字符（约两行） | warning |
| 时间格式一致性 | 单个日期 token 内部不混用 `.` 和 `-`（区间分隔符不算混用） | error |
| 空话黑名单 | 出现"认真负责""吃苦耐劳"等无信息量短语 | warning |

**日期格式检查的正确实现**：

```
输入: "2022.06 - 2024.12"
→ 按范围分隔符（-、–、—、至、~）拆分 → ["2022.06", "2024.12"]
→ 分别检测每个 token 内部格式
→ "2022.06" 只有 "." → 格式一致 ✓
→ "2024.12" 只有 "." → 格式一致 ✓
→ 不报 error
```

```
输入: "2022.06-2023-04"
→ 拆分 → ["2022.06", "2023-04"]
→ "2022.06" 内部有 "." → dot 格式
→ "2023-04" 内部有 "-" → dash 格式
→ 两种格式共存 → 报 error "时间格式混用"
```

**`require_sections` 开关逻辑**：

- `generate`/`optimize`：当证据池中有经历记录（`_evidence_has_items=True`）时为 `True`。
- `update`：硬编码 `False`（部分合并工具，不检查章节完整性）。
- 空档案学生：`_evidence_has_items=False` → `require_sections=False` → 不卡死，由素材闸门引导追问。

#### 3.2.3 generate 路径的事实/表达分离

**当前问题**：`_profile_backed_resume_args` 丢弃模型提交的所有事实字段，从个人档案原样重建——模型润色过的文字全部被扔掉，"AI 生成"退化为"档案换排版"。

**改进方案**：

1. 服务端将"档案事实清单"（结构化字段：公司名、职位、时间段、技术栈、数字指标）作为锚点传给模型。
2. 模型在事实锚定下重写 details（允许改写表达、动词、STAR 重组）。
3. 回传后只校验事实层（Hard Facts 白名单），不校验表达层。
4. 个人档案的 `name`、`email`、`phone` 等基础信息仍由服务端强制覆盖（不信任模型）。

#### 3.2.4 update 路径的空章节检查修正

`update_resume_data` 是部分合并工具——`args` 中只提供要修改的字段，未提供的字段保留 `existing` 简历内容。因此：

- `if args.get("experience")` 为空（falsy）→ 保留原有 experience → 章节不会被清空。
- 对 `update` 强制要求章节完整毫无意义，且会拦掉所有合法局部更新。
- **修正**：`update` 路径的 `_check_resume_quality` 调用硬编码 `require_sections=False`。

### 3.3 运行时解耦

#### 3.3.1 设计目标

将智能体执行从"页面上挂着的一条 SSE 连接"解耦为后台任务，实现：

- 用户关闭页面后智能体继续执行
- 断线后可重连并回放已产出的事件
- 同一用户并发控制（每 session 最多 1 个运行中任务，每用户最多 2 个）
- 运行状态可查询、可取消

#### 3.3.2 数据模型

**`student_agent_run` 表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BIGINT PK | 自增主键 |
| `tenant_id` | INT | 租户隔离 |
| `student_id` | INT | 学生 ID |
| `session_id` | INT | 对话 session ID |
| `status` | VARCHAR(20) | `running` / `completed` / `failed` / `cancelled` |
| `assistant_message_id` | BIGINT NULL | 关联的助手消息 ID |
| `error_text` | TEXT NULL | 失败原因 |
| `created_at` | DATETIME | 创建时间 |
| `finished_at` | DATETIME NULL | 结束时间 |

索引：`(tenant_id, student_id)`、`(tenant_id, session_id)`、`(tenant_id, status)`

**`student_agent_run_event` 表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BIGINT PK | 自增主键 |
| `tenant_id` | INT | 租户隔离 |
| `run_id` | BIGINT | 关联 run |
| `seq` | INT | 事件序号（单调递增） |
| `event` | VARCHAR(50) | 事件类型 |
| `data_json` | TEXT | 事件 JSON 数据 |
| `created_at` | DATETIME | 创建时间 |

索引：`(run_id, seq)`、`(tenant_id, run_id)`

#### 3.3.3 RunManager

**设计**：进程级单例，管理所有活跃 run 的生命周期。

**核心接口**：

| 方法 | 说明 |
|------|------|
| `start_run(session, identity, ...) → run_id` | 创建 run 记录，启动后台任务 |
| `subscribe(run_id, after_seq) → AsyncIterator[str]` | 订阅事件流（DB 回放 + 实时推送） |
| `cancel(run_id) → bool` | 标记 run 为 cancelled |
| `get_active_runs(student_id) → list[run_id]` | 查询当前活跃 run |

**事件双写**：

- 非 heartbeat 事件 → 写入 DB（`student_agent_run_event` 表）+ 推送给订阅者 Queue。
- heartbeat 事件 → 仅实时推送，不落库。

**并发守卫**：

- 同一 session 同时只能有 1 个 `running` 状态的 run。
- 同一用户同时最多 2 个 `running` 状态的 run。
- 超限返回 HTTP 409 Conflict。

**孤儿清理**：应用启动时（lifespan），将超过 10 分钟仍为 `running` 状态的 run 标记为 `failed`。

#### 3.3.4 API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `POST` | `/api/v1/student/master/sessions/{sid}/runs` | 启动 run，返回 `{run_id}` | JWT + 租户 |
| `GET` | `/api/v1/student/master/runs/{run_id}/events?after_seq=` | SSE 事件流 | JWT + 租户 + 归属校验 |
| `POST` | `/api/v1/student/master/runs/{run_id}/cancel` | 取消 run | JWT + 租户 + 归属校验 |
| `GET` | `/api/v1/student/master/runs/active` | 查询当前用户的活跃 run | JWT + 租户 |

**SSE 事件格式**：

```
event: message.delta
data: {"content": "根据您的简历..."}

:seq 42

event: runtime.status
data: {"phase": "tool", "tool_name": "generate_resume_data"}

:seq 43
```

`:seq N` 注释用于断线重连时的断点定位——前端解析后更新 `afterSeq`，重连时传入 `?after_seq=N`。

#### 3.3.5 前端集成

**`chatRuntimeStore`**：模块级单例（React 组件生命周期无关），管理运行态。

| 方法 | 说明 |
|------|------|
| `startRun(sessionId, message)` | POST `/runs` → 获取 `run_id` → 开始 SSE 订阅 |
| `subscribe(listener)` | 注册状态变更回调 |
| `getState()` | 获取当前运行态快照 |
| `isRunning()` | 是否有活跃 run |
| `abort()` | 取消当前 run |
| `abortSession(sessionId)` | 取消指定 session 的 run |

**状态同步**：`AgentChatView` 通过 `useEffect` + `storeTick` 计数器订阅 store 变更，同步到组件 state 驱动渲染。

**旧端点兼容**：`/messages/stream` 端点保留作为回退，前端优先使用 `/runs` 端点。

---

## 4. 安全改进

### 4.1 文件下载鉴权

**移除**：`main.py` 中 `app.mount("/data", StaticFiles(...))` 的静态挂载。

**替换为**：带鉴权的下载端点 `GET /api/v1/student/files/download`。

**安全措施**：

| 措施 | 实现 |
|------|------|
| 身份校验 | HMAC-SHA256 签名 token，包含 `tenant_id:user_id:path:exp` |
| 时效控制 | token 有效期 10 分钟 |
| 路径穿越防护 | `Path.resolve()` + `relative_to()` 确认在预期目录内，拒绝含 `..` 的路径 |
| 用户隔离 | 前缀校验到 `agent_uploads/{tenant_id}/{user_id}/`，同租户不同用户不可互访 |
| 永久链接兼容 | 前端文件 chip 每次加载时重新签名，正文内不嵌入带 token 的 URL |

### 4.2 read_resume 会话过滤

- 历史 PDF 仅读 `session_id=0` 的附件（个人中心保存的简历）。
- 排除本轮 assistant 产出的 `export_resume_pdf` 文件（防止自我回声）。
- 与文档中 `session_id=0` 规则一致。

---

## 5. 提示词对齐

### 5.1 校验规则与提示词的契约声明

在 system prompt 中新增关键约束：

```
【事实校验契约】
- 允许改写表达、动词、STAR 重组
- 不允许新增无来源经历、技术栈、指标
- generate/optimize/update/export 共享同一套事实契约
- 当提示词中的写作建议与工具层事实校验冲突时，以工具层为准
```

### 5.2 export 工具的提示更新

- 模型不要在消息正文内嵌下载链接（token 10 分钟后失效）。
- 提示学生查看下方文件卡片（前端文件 chip 每次加载时重新签名）。
- export 返回值增加 `model_hint` 字段强化此提示。

### 5.3 素材访谈引导

当 `_assess_evidence_quality` 返回 `insufficient` 时，工具返回结构化提示：

```json
{
  "status": "insufficient",
  "suggestions": [
    "当前量化成果不足（10%），请引导学生补充具体数字指标",
    "请逐条询问学生：项目服务多少用户？上线后效果如何？团队规模？"
  ]
}
```

---

## 6. 实施计划

### 6.1 修复优先级排序

```
Phase 1（P0 修复，立即执行）
├── P0-1: _normalize_literal_escapes 调用位置前移
├── P0-2: update 路径 require_sections=False
├── P0-3: 专名候选提取补全结构化字段
└── P0-4: 日期格式检查按范围分隔符拆分

Phase 2（P1 修复，下一轮迭代）
├── P1-1: 归一化函数统一应用
├── P1-2: 下载链接方案确定（稳定路径 + 前端现签 或 禁止正文内嵌）
├── P1-3: 中文实体提取粒度调整 + shadow mode
├── P1-4: _run_detached 端到端验证
└── P1-5: :seq 注释补全

Phase 3（P2 改进，持续迭代）
├── P2-1: 异步 PDF 解析接入 read_resume
├── P2-2: skill 门槛跨轮持久化
├── P2-3: 上下文总预算控制
├── P2-4: session 并发互斥
├── P2-5: ask 权限态确认回路
└── P2-6: section 关键词表扩展
```

### 6.2 测试策略

#### 后端关键场景

| 场景 | 预期结果 |
|------|----------|
| `read_resume` → `optimize`（不传 `source_resume_id`） | 证据核验通过（read_resume 结果进入证据池） |
| `optimize` 无来源新增经历/指标 | 返回 `failed` + 明确错误 |
| `export` 含无来源新增公司/项目/学历 | 返回 `failed` |
| `read_resume` 不回读本轮 `export` 产出 | 不包含在证据中 |
| `/data/...` 直接访问 | 返回 401 |
| 签名下载端点正常访问 | 返回文件内容 |
| 模型不支持 `reasoning_effort` | 不发送该参数，不触发 400 降级 |
| 已输出 delta 后流式中断 | 直接报错，不重复输出 |
| `update` 局部更新（仅 self_evaluation） | 正常保存，不被空章节检查拦截 |
| 日期 `"2022.06 - 2024.12"` | 不触发格式混用 error |
| 字面 `\\n` 在 args 中 | 规范化后不提取出 `nAI` |
| 公司名"字节跳动"在 args 中 | `proper_nouns` 包含该值，无来源新增被拦截 |
| `Python` vs `python` 归一化 | 不报 violation |
| 质量闸门接入 `optimize` | 强动词率不足时返回 warning |
| `_assess_evidence_quality([])` | 返回 `insufficient` + 默认引导建议 |
| 断线重连 `?after_seq=N` | 从 seq N+1 开始回放，不重复 |

#### 前端关键场景

| 场景 | 预期结果 |
|------|----------|
| 生成简历后 assistant 消息可点击"打开简历编辑器" | 正常跳转 |
| `attachment.created` 事件后 PDF 下载入口展示 | 文件 chip 可点击下载 |
| 优化失败时提示文案 | 具体错误信息，非通用失败 |
| SSE 断线后自动重连 | 从上次 seq 继续，不重复内容 |
| 关闭页面后重新进入 | 运行中的任务状态正确恢复 |

### 6.3 评测闭环（长期）

1. 收集 10–20 套真实"学生档案 + JD"作为评测集。
2. 每次改动后用确定性指标（代码）+ LLM-as-judge 打分（rubric）对比。
3. 找 1–2 位真 HR 对基线版和改进版做盲评。
4. Shadow Mode 先行：违规只写 activity 日志、不拦截，收集真实误报率后再决定拦截强度。

---

## 7. 风险评估与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 事实校验规则变化导致正常优化失败率上升 | 中 | 高 | 先做实体级 hard facts 校验，不卡表达改写；shadow mode 收集数据 |
| 静态文件鉴权切换导致前端旧链接失效 | 低 | 中 | 前端文件 chip 每次加载重新签名；正文链接引导查看文件卡片 |
| 异步改造引入新并发问题 | 低 | 中 | 只改 web/pdf 重操作为异步，不动主循环骨架 |
| `_run_detached` 延迟导入失败 | 中 | 高 | 端到端集成测试验证；保留旧 `/messages/stream` 作为回退 |
| 质量闸门误拦导致用户反复重试 | 中 | 中 | error 级别仅用于明确违规（空章节、日期格式），其余为 warning |

---

## 8. 成功指标

| 指标 | 基线（当前） | 目标 |
|------|-------------|------|
| 简历生成成功率（非空章节） | — | ≥ 95% |
| 事实校验误拒率（shadow mode） | — | ≤ 5% |
| 简历内容含量化指标的条目占比 | — | ≥ 40% |
| 强动词开头率 | — | ≥ 60% |
| JD 关键词覆盖率 | — | ≥ 50% |
| SSE 断线重连成功率 | — | ≥ 99% |
| 文件下载 401 率（签名过期） | — | ≤ 1%（正文不嵌 token） |

---

## 附录 A：关键代码映射

| 功能 | 文件 | 行号范围 |
|------|------|----------|
| 证据池 | `agent_runtime.py` | 76–119 |
| 事实白名单 | `agent_runtime.py` | 121–171 |
| 归一化函数 | `agent_runtime.py` | 3218–3224 |
| 素材质量评估 | `agent_runtime.py` | 299–362 |
| 质量闸门 | `agent_runtime.py` | 364–478 |
| 事实校验 | `agent_runtime.py` | 3226–3283 |
| 字面转义规范化 | `agent_runtime.py` | 2912–2926 |
| 专名候选提取 | `agent_runtime.py` | 245–297 |
| generate 工具 | `agent_runtime.py` | 3317–3414 |
| optimize 工具 | `agent_runtime.py` | 3416–3531 |
| update 工具 | `agent_runtime.py` | 3533–3672 |
| export 工具 | `agent_runtime.py` | 3715–3788 |
| RunManager | `run_manager.py` | 1–497 |
| run API 端点 | `router.py` | — |
| 前端运行态 store | `chatRuntimeStore.ts` | 1–493 |
| AgentChatView 集成 | `AgentChatView.tsx` | 1–1487 |

## 附录 B：术语表

| 术语 | 定义 |
|------|------|
| Hard Facts | 必须有据可查的事实实体（数字、技术词、时间段、专名） |
| Soft Wording | 允许自由改写的表达层（句式、动词、详略） |
| 证据池（Evidence Pool） | 单次 run 内的事实来源集合，由 profile/简历/附件/对话内容填充 |
| 质量闸门（Quality Gate） | 保存前的确定性检查，区分 error（阻止保存）和 warning（提示改进） |
| 素材访谈 | 证据不足时 Harness 强制模型转向追问学生补充素材的机制 |
| Shadow Mode | 违规只记日志不拦截的观察模式，用于收集真实误报率 |
| RunManager | 进程级单例，管理后台 run 的生命周期、事件双写、并发守卫 |
