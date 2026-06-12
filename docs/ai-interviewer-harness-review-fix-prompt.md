# AI 面试官 Harness Loop 二次修复执行提示

> 将本文件完整交给下一个 AI 开发者。下一个 AI 必须严格按本文执行，不允许自行扩展无关功能，不允许凭空假设代码状态，不允许只做文字层面的优化。所有修改必须落到源码、测试和构建验证。

## 1. 背景

当前项目已经为 AI 面试官引入了 `backend/app/interview/harness.py`，并在 `backend/app/interview/service.py` 中把 `start_interview`、`submit_turn`、`generate_report` 接入了 `run_harnessed_json_generation(...)`。

这个方向是正确的：AI 面试官应该使用 **Harness 主导的受控式 Agentic Loop**，而不是自由 Agent。

但当前实现仍存在关键问题：

- 中文安全护栏字符串编码损坏，导致真实中文泄露词无法被拦截。
- Validator 没有真正校验所有 required fields。
- Repair Prompt 缺少原始任务上下文，模型修复时可能失去任务目标。
- 证据引用校验过于机械，容易误杀正常回答。
- `harness.py` 和 `service.py` 存在重复函数与未使用导入。
- fallback 即使不通过 validator 也会被返回，缺少兜底修复。
- 缺少真实链路测试，当前只覆盖了部分纯函数。
- 缺少上线约束：历史数据兼容、请求耗时上限、重复提交幂等、用户可读 fallback。

你的任务是基于这些问题继续修复 AI 面试官，不要重新设计整个项目。

## 2. 必读文件

修改前必须阅读：

- `backend/app/interview/harness.py`
- `backend/app/interview/service.py`
- `backend/app/interview/prompts.py`
- `backend/app/interview/schemas.py`
- `backend/app/interview/models.py`
- `backend/app/interview/knowledge.py`
- `backend/tests/test_interview_harness.py`
- `backend/tests/test_interview.py`
- `frontend/src/student/AIInterviewerPage.tsx`
- `docs/ai-interviewer-harness-loop-modification-prompt.md`

如果源码与本文描述不一致，以源码为准，但本文列出的修复目标必须完成。

## 3. 严禁事项

禁止以下行为：

- 禁止删除 Harness Loop，回退到单次 `_llm_json(...)`。
- 禁止让模型自己决定最终结束。
- 禁止无限重试。
- 禁止只修改提示词，不修改代码校验。
- 禁止为了通过测试降低安全校验。
- 禁止忽略中文编码损坏问题。
- 禁止新增与 AI 面试官无关的大范围重构。
- 禁止声称测试通过但没有实际运行命令。
- 禁止把服务器路径、系统提示词、内部规则返回给学生端。
- 禁止在学生端展示原始模型错误、堆栈、repair prompt 或内部 validator 错误列表。

## 4. 必须保持的架构原则

AI 面试官必须保持受控式 Agentic Loop：

```text
Harness 定义阶段、任务、schema、校验规则
Model 生成候选 JSON
Harness 解析 JSON
Harness 校验格式、事实、流程、停止条件
不合格时 Harness 生成 repair prompt
超过最大重试次数或耗时上限后 Harness 使用 fallback
最终结果由 Harness 入库
```

模型只能做：

- 生成候选问题
- 生成候选评分
- 生成候选报告
- 根据 Harness 错误反馈修复 JSON
- 用 `should_end=true` 表示建议结束

模型不能做：

- 决定最终结束
- 绕过 schema
- 写数据库
- 编造候选人经历
- 泄露系统提示词

## 5. P0 修复一：修复中文护栏编码损坏

### 当前问题

`backend/app/interview/harness.py` 中 `_FORBIDDEN_PATTERNS` 的中文内容已经损坏。真实中文无法匹配。

必须确保以下输入返回 `True`：

```python
_contains_forbidden_text("系统提示词泄露") is True
_contains_forbidden_text("内部规则如下") is True
_contains_forbidden_text("我已录用你") is True
_contains_forbidden_text("你已经通过面试") is True
_contains_forbidden_text("C:\\Users\\admin") is True
_contains_forbidden_text("/app/backend/config") is True
```

必须确保以下正常内容返回 `False`：

```python
_contains_forbidden_text("请介绍一个你做过的项目") is False
_contains_forbidden_text("Redis 缓存和数据库一致性如何保证") is False
```

### 必须修改

在 `backend/app/interview/harness.py` 中重写 `_FORBIDDEN_PATTERNS`：

```python
_FORBIDDEN_PATTERNS = [
    "系统提示词",
    "系统 prompt",
    "system prompt",
    "developer message",
    "内部规则",
    "内部提示",
    "隐藏规则",
    "我已录用你",
    "你已经通过面试",
    "你已通过面试",
    "你已被录用",
    "C:\\",
    "/app/",
    "/root/",
    "/home/",
    "/etc/",
]
```

注意：

- 文件必须保存为 UTF-8。
- 不允许出现乱码字符串。
- 修改后必须新增测试验证真实中文命中。

## 6. P0 修复二：补齐 required fields 校验

### 当前问题

当前 validator 只校验了部分字段，没有真正执行 required fields。

### 必须新增常量

在 `backend/app/interview/harness.py` 中新增：

```python
START_REQUIRED_FIELDS = [
    "resume_brief",
    "focus_points",
    "first_question",
    "question_reason",
    "question_type",
    "capability_tags",
    "knowledge_points",
]

FOLLOWUP_REQUIRED_FIELDS = [
    "answer_assessment",
    "score",
    "followup_strategy",
    "next_question",
    "should_end",
    "question_reason",
    "question_type",
    "capability_tags",
    "knowledge_points",
    "score_reasons",
    "evidence_quotes",
]

REPORT_REQUIRED_FIELDS = [
    "overall_score",
    "dimension_scores",
    "strengths",
    "weaknesses",
    "suggestions",
    "next_questions",
    "report_text",
    "training_plan",
    "rewrite_examples",
    "next_session_preset",
]
```

### 必须新增辅助函数

```python
def _missing_required_fields(data: dict[str, Any], required: list[str]) -> list[str]:
    return [field for field in required if field not in data]
```

### 必须修改三个 validator

`validate_start_output(...)` 必须：

- 检查 `START_REQUIRED_FIELDS`。
- `resume_brief` 必须是非空字符串。
- `question_reason` 必须是非空字符串。
- `question_type` 必须是非空字符串。
- `capability_tags` 必须是字符串数组。
- `focus_points` 必须是 1 到 6 个字符串。
- `knowledge_points` 必须是字符串数组。

`validate_followup_output(...)` 必须：

- 检查 `FOLLOWUP_REQUIRED_FIELDS`。
- `followup_strategy` 必须是非空字符串。
- `question_reason` 必须是非空字符串。
- `question_type` 必须是非空字符串。
- `capability_tags` 必须是字符串数组。
- `knowledge_points` 必须是字符串数组。
- `score_reasons` 必须是对象。
- `evidence_quotes` 必须是数组。

`validate_report_output(...)` 必须：

- 检查 `REPORT_REQUIRED_FIELDS`。
- `training_plan` 必须是数组。
- `rewrite_examples` 必须是数组。
- `next_session_preset` 必须是对象。
- `strengths / weaknesses / suggestions / next_questions` 必须是字符串数组。

错误信息必须具体，例如：

```python
"missing required field: resume_brief"
"capability_tags must be a list of strings"
```

## 7. P0 修复三：修复 Repair Prompt 上下文不足

### 当前问题

`run_harnessed_json_generation(...)` 第二次及以后只给模型上一轮输出和错误列表，没有提供原始任务上下文。模型可能只是补字段，而不是按原任务修复。

### 必须修改函数签名

将：

```python
def _build_repair_prompt(task_name: str, previous_output: str, errors: list[str]) -> str:
```

修改为：

```python
def _build_repair_prompt(
    *,
    task_name: str,
    original_prompt: str,
    previous_output: str,
    errors: list[str],
) -> str:
```

### Repair Prompt 必须包含

- 任务名。
- Harness 错误列表。
- 原始任务上下文，最多截断到 4000 字。
- 上一次模型输出，最多截断到 2000 字。
- 明确要求只输出 JSON。
- 明确禁止 Markdown 和解释。

示例结构：

```text
你的上一次输出没有通过平台 Harness 校验。

任务名称：
{task_name}

原始任务上下文：
{original_prompt[:4000]}

错误列表：
- ...

上一次输出：
{previous_output[:2000]}

请基于原始任务上下文修复输出。
只输出合法 JSON。
不要输出 Markdown 代码块。
不要输出解释。
不要新增 schema 之外的无关字段。
```

### 必须修改调用点

`run_harnessed_json_generation(...)` 中调用 `_build_repair_prompt(...)` 时必须传入 `original_prompt=user_prompt`。

## 8. P0 修复四：增加 Loop 耗时上限和成本边界

### 当前问题

Harness repair 会增加模型调用次数。如果模型连续输出不合格，用户等待时间和成本都会上升。

### 必须新增约束

`run_harnessed_json_generation(...)` 必须支持总耗时上限：

```python
max_total_seconds: float = 30.0
```

建议规则：

- `start_interview`：`max_retries=2`，`max_total_seconds=30`。
- `submit_turn`：`max_retries=2`，`max_total_seconds=30`。
- `generate_report`：`max_retries=3`，`max_total_seconds=45`。

执行要求：

- 每次模型调用前检查总耗时。
- 超过总耗时上限时停止重试并 fallback。
- `llm_meta["errors"]` 必须包含 `"harness loop timeout"` 或等价错误。
- 不允许无限等待模型修复。

## 9. P0 修复五：submit_turn 必须防重复提交

### 当前问题

真实用户可能重复点击提交，或者网络重试导致同一轮回答被提交两次。必须防止同一 session 同一待回答 turn 生成多个 next_turn。

### 必须修改

在 `submit_turn(...)` 中增加幂等/并发保护：

- 查询当前未回答 turn 后，写入前再次确认该 turn 仍未回答。
- 如果当前 turn 已经有 answer，不得再次生成 next_turn。
- 可以返回已有最新状态，或返回明确错误，但不能重复创建下一题。
- 同一个 `session_id + turn_index` 应只允许一次有效提交。

建议增加测试：

- 模拟同一 turn 已经有 answer，再调用 `submit_turn` 不应创建新 next_turn。

如果短期无法实现数据库锁，至少在应用层增加重复提交保护，并在文档中说明后续应加行级锁或唯一约束。

## 10. P1 修复六：改进单问题校验，避免乱码规则

### 当前问题

`_looks_like_single_question(...)` 中中文规则也有编码损坏，并且当前逻辑对真实中文的判断不可靠。

### 必须重写

建议实现：

```python
def _looks_like_single_question(text: str) -> bool:
    if not text or not text.strip():
        return False

    normalized = text.strip()
    question_marks = normalized.count("?") + normalized.count("？")
    if question_marks > 2:
        return False

    sequence_hits = sum(
        1
        for token in ("第一", "第二", "第三", "1.", "2.", "3.", "1）", "2）", "3）")
        if token in normalized
    )
    if sequence_hits >= 2 and question_marks >= 1:
        return False

    split_patterns = [
        "分别回答",
        "逐一回答",
        "同时回答",
        "同时说明",
        "从以下三个方面",
        "从 A、B、C",
        "请回答以下问题",
    ]
    if any(pattern in normalized for pattern in split_patterns):
        return False

    return True
```

注意：

- 不要过度严格。面试官可以要求候选人按“背景、职责、方案、结果”组织一个问题。
- 禁止把一个主问题中的回答结构误判成多个问题。

## 11. P1 修复七：改进 evidence_quotes 校验

### 当前问题

现在只是 `quote.lower() in answer.lower()`，太机械。模型轻微改写或标点不同就会失败。

### 必须修改

新增归一化函数：

```python
def _normalize_text_for_match(text: str) -> str:
    ...
```

要求：

- 转小写。
- 去除空白。
- 去除常见标点。
- 保留中文、英文、数字。

修改 `_filter_evidence_quotes(...)`：

- 完整 quote 归一化后能命中 answer，则保留。
- 如果完整 quote 过长，可取长度大于等于 6 的关键词片段进行匹配。
- 最多保留 3 条。
- 不允许保留完全找不到来源的 quote。

修改 `validate_followup_output(...)`：

- 不要直接用原始 substring 判断。
- 使用 `_filter_evidence_quotes(...)` 的结果。
- 如果模型提供了 quote，但过滤后数量变少，返回错误，要求模型修复为原文引用。
- 如果 quote 校验失败，不要直接让整轮接口 500；应该进入 repair 或 fallback。

## 12. P1 修复八：统一 service 与 harness 的重复逻辑

### 当前问题

`backend/app/interview/harness.py` 中有 `_filter_evidence_quotes(...)`，`backend/app/interview/service.py` 中也有同职责逻辑。当前 `service.py` 实际调用自己的版本。

### 必须处理

推荐做法：

- 从 `harness.py` 导入 `_filter_evidence_quotes`。
- 删除或废弃 `service.py` 中重复函数。
- `submit_turn(...)` 使用 Harness 里的证据引用过滤逻辑。
- 测试覆盖这个统一入口。

如果不删除重复函数，必须重命名并明确只保留一个入口，不允许两个同职责函数长期并存。

## 13. P1 修复九：处理未使用导入和未使用 fallback builder

### 当前问题

`service.py` 导入了：

```python
SCORE_KEYS as HARNESS_SCORE_KEYS
build_fallback_report
```

但当前没有使用。

### 必须处理

二选一：

1. 如果不需要，删除未使用导入。
2. 如果要使用，则把 `generate_report(...)` 中手写 fallback 报告替换为 `build_fallback_report(...)`，并保证字段完整。

推荐做法：

- 短期删除未使用导入，避免误导。
- 如果要统一 fallback，再单独重构。

## 14. P1 修复十：fallback 必须最终结构可用且用户可读

### 当前问题

`run_harnessed_json_generation(...)` fallback 即使没有通过 validator 也会返回。这作为最后手段可以接受，但必须确保不会返回破结构。

### 必须修改

新增：

```python
def _coerce_fallback_for_task(task_name: str, fallback: dict[str, Any]) -> dict[str, Any]:
    ...
```

最低要求：

- `start_interview` fallback 必须补齐 `START_REQUIRED_FIELDS`。
- `submit_turn` fallback 必须补齐 `FOLLOWUP_REQUIRED_FIELDS`。
- `generate_report` fallback 必须补齐 `REPORT_REQUIRED_FIELDS`。

在 fallback 返回前：

```python
fallback = _coerce_fallback_for_task(task_name, fallback)
fallback_errors = validator(fallback, ctx)
```

如果仍有错误：

- 不要抛 500。
- 返回结构完整的极简 fallback。
- `llm_meta["errors"]` 必须包含 fallback 校验错误。

用户可读要求：

- fallback 文案必须明确、专业、不中断流程。
- fallback 不得暴露模型失败原因、validator 错误、repair prompt、堆栈。
- 学生端最多展示“本次使用本地 Rubric 兜底生成”这类温和提示。

## 15. P1 修复十一：历史数据兼容

### 当前问题

线上或本地已有旧的 `InterviewTurn.answer_assessment`、`score_json`、`InterviewReport.comparison_json`，其中不一定包含新增字段：

- `attempts`
- `repaired`
- `fallback_used`
- `finish_reason`
- `score_reasons`
- `evidence_quotes`
- `top_sources`

### 必须保证

- 序列化旧记录时字段缺失不得报错。
- 前端读取旧报告时不得崩溃。
- 新增字段必须有默认值。
- 不得要求旧数据迁移后才能打开历史面试记录。

建议：

- 后端 `_json_loads(..., default)` 必须覆盖所有新增字段。
- 前端展示新增字段时必须使用可选链和默认值。

## 16. P1 修复十二：把 Harness trace 写入结果，方便前端和审计

当前 `llm_meta` 已包含：

```python
used
model
usage
attempts
repaired
errors
fallback_used
```

必须确保：

- `start_interview` 的 `answer_assessment.llm` 保留这些字段。
- `submit_turn` 的 `answer_assessment.llm` 保留这些字段，并加入 `finish_reason`。
- `generate_report` 的 `comparison.scoring` 至少包含：
  - `mode`
  - `model`
  - `usage`
  - `attempts`
  - `repaired`
  - `fallback_used`

不要把内部错误完整暴露给学生端。如果前端展示错误，只展示概括状态，例如“已使用本地兜底评分”。

## 17. P2 优化：前端用户体验

检查 `frontend/src/student/AIInterviewerPage.tsx`。

要求：

- 当报告 `comparison.scoring.mode === "local_fallback"` 时，展示温和提示：`本次报告使用本地 Rubric 兜底生成`。
- 如果 `fallback_used` 为 true，不要展示内部错误列表。
- 如果 `attempts > 1`，可显示“已完成结构校验”之类的非技术提示。
- 前端不得因缺少 `score_reasons`、`evidence_quotes`、`top_sources` 崩溃。

不要在学生界面展示：

- system prompt
- developer message
- 服务器路径
- 原始模型错误堆栈

## 18. 测试要求

必须新增或修改测试。

### 必须新增测试点

在 `backend/tests/test_interview_harness.py` 中新增：

1. 中文 forbidden patterns 有效：

```python
self.assertTrue(_contains_forbidden_text("系统提示词泄露"))
self.assertTrue(_contains_forbidden_text("内部规则如下"))
self.assertTrue(_contains_forbidden_text("我已录用你"))
self.assertFalse(_contains_forbidden_text("请介绍一个你做过的项目"))
```

2. `validate_start_output` 缺 `resume_brief` 时失败。

3. `validate_start_output` 缺 `question_reason` 时失败。

4. `validate_followup_output` 缺 `followup_strategy` 时失败。

5. `validate_followup_output` 缺 `score_reasons` 时失败。

6. `validate_report_output` 缺 `training_plan` 时失败。

7. repair prompt 包含原始任务上下文。

8. fallback 不通过 validator 时，会被 coerce 成结构完整结果。

9. `_looks_like_single_question("第一，请说背景？第二，请说结果？")` 返回 False。

10. `_looks_like_single_question("请围绕一个项目，按背景、职责、方案、结果说明你的贡献")` 返回 True。

11. evidence quote 标点或空格轻微差异时能匹配。

12. service 中不再使用重复的 evidence quote 函数。

13. Harness Loop 超过 `max_total_seconds` 时会 fallback。

14. 历史数据缺少新增字段时，序列化和前端类型处理不崩溃。

15. 重复提交同一 turn 不会生成重复 next_turn。

### 必须运行

```bash
cd backend
python -m compileall -f app/interview
python -m pytest tests/test_interview_harness.py -q
```

如果环境依赖齐全，再运行：

```bash
python -m pytest tests -q
```

前端必须运行：

```bash
cd frontend
npm run build
```

如果完整后端测试因为缺少 `reportlab` 失败，必须明确说明，不允许说全部测试通过。

## 19. 验收标准

完成后必须满足：

- `harness.py` 中没有中文乱码护栏词。
- 真实中文 forbidden patterns 能被检测。
- 三个 validator 都检查 required fields。
- Repair Prompt 带原始任务上下文。
- 每个 Harness Loop 有最大重试次数和总耗时上限。
- `submit_turn` 不会因重复提交生成重复 next_turn。
- `should_end` 仍由 Harness 最终判定。
- evidence quote 校验不再只依赖原始 substring。
- service 与 harness 不存在重复证据过滤入口。
- fallback 返回结构完整、用户可读，不导致接口 500。
- 历史数据缺字段时前后端不崩溃。
- Harness 单测通过。
- 前端构建通过。

## 20. 最终回复必须包含

下一个 AI 完成修改后的最终回复必须包含：

- 修改了哪些文件。
- 修复了哪些 P0/P1/P2 问题。
- Agentic Loop 的职责边界是否保持。
- 中文护栏验证结果。
- Validator required fields 覆盖情况。
- Loop 耗时上限和 retry 策略。
- 重复提交保护方式。
- fallback 用户可读策略。
- 测试和构建命令结果。
- 未完成事项和原因。

## 21. 最重要的判断标准

最终代码必须满足：

```text
AI 面试官不是自由 Agent。
AI 面试官是 Harness 主导的受控式 Agentic Loop。
模型只生成候选 JSON。
Harness 校验后才允许入库。
模型 should_end=true 只是建议。
Harness 判定结束才真正结束。
中文安全护栏必须对真实中文有效。
每个 Loop 必须有 retry 和耗时上限。
重复提交不能生成重复下一题。
历史数据缺少新增字段也不能崩溃。
模型输出失败时用户仍能获得结构完整、专业可读的 fallback 结果。
```

