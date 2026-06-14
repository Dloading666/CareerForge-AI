# AI 面试官修复方案（基于 20260612-next-agent-prompt 审计）

## 审计结论

### 现状：双系统并存

| 组件 | 现状 | 问题 |
|------|------|------|
| `agent_runtime.py` INTERVIEWER_SYSTEM_PROMPT | 仅返回引导语，不运行面试 | 与文档要求的工具池架构不符 |
| `interview/service.py` | 完整实现，含阶段状态机/评分/报告 | 未与 agent runtime 连通 |
| `AIInterviewerPage.tsx` | 独立 REST 调用，无 SSE 流式 | 不使用 chatRuntimeStore，与文档架构不符 |
| `InterviewReportDrawer` | **不存在** | 文档提到的组件缺失 |
| `InterviewerChatInput` | **不存在** | 文档提到的组件缺失 |
| `chatRuntimeStore.ts` | 仅用于简历助手 | 面试官未接入 |
| `router_student.py` | 已实现完整 REST API | 可直接被工具函数调用 |

### 问题清单

1. **interview_transcript 为空**：`AIInterviewerPage` 不走 `chatRuntimeStore`，无消息流入 store
2. **summary 缺失字段**：turn 结果的 `answer_assessment` 结构不统一
3. **transcript 缺 role**：序列化时未包含 `role` 字段
4. **工具名不匹配**：当前 `INTERVIEWER_ACTIVE_TOOL_NAMES` 是旧版（`query_student_profile` 等），文档要求新工具名（`start_interview_session` 等）
5. **阶段推进**：面试服务已有完整阶段状态机，但 agent runtime 无法访问

---

## 修复方案

### 总体策略

采用**桥接架构**：在 `agent_runtime.py` 中添加面试工具包装函数，委托 `interview/service.py` 处理核心逻辑。`agent_runtime.py` 的 `run_agent_loop` 负责 SSE 流式输出，面试服务负责状态管理/评分/报告。前端通过 `chatRuntimeStore` 统一管理。

### 第一阶段：后端工具桥接（agent_runtime.py）

#### 1.1 添加面试工具名到白名单

**文件**：`backend/app/student/agent_runtime.py`

```python
INTERVIEWER_ACTIVE_TOOL_NAMES = (
    "query_student_profile",
    "start_interview_session",
    "submit_interview_answer",
    "get_interview_report",
    "finish_interview_session",
)
```

#### 1.2 实现面试工具函数

在 `agent_runtime.py` 的工具注册区域（`BUILTIN_TOOLS` 列表）添加 4 个新工具：

**`start_interview_session`**：
- 参数：`target_role`(必填)、`job_description`(必填)、`interview_type`、`interview_style`、`round_limit`、`company_name`、`seniority_level`、`job_skills`
- 实现：调用 `interview.service.start_interview()`
- 返回：session 信息 + 第一轮问题（含 question、turn_id、stage）

**`submit_interview_answer`**：
- 参数：`session_id`(必填)、`answer`(必填)、`turn_id`
- 实现：调用 `interview.service.submit_turn()`
- 返回：当前轮评分摘要 + 下一问 + 阶段信息 + `is_finished` 标志

**`get_interview_report`**：
- 参数：`session_id`(必填)
- 实现：调用 `interview.service.generate_report()` + `serialize_report()`
- 返回：完整报告数据（分数/优点/弱点/建议/训练计划）

**`finish_interview_session`**：
- 参数：`session_id`(必填)
- 实现：调用 `interview.service.generate_report()`
- 返回：报告摘要（与 get_interview_report 相同，区别在于语义：主动结束）

#### 1.3 重写 INTERVIEWER_SYSTEM_PROMPT

替换当前的引导语，改为完整的面试官 Agent 指令：

```
你是 CareerForge-AI 的 AI 面试官。你的职责是通过结构化面试验证候选人的岗位匹配度。

## 核心流程
1. 首轮：调用 start_interview_session 创建面试，呈现第一个问题
2. 候选人回答后：调用 submit_interview_answer 评分并获取下一问
3. 收到 is_finished=true 后：调用 get_interview_report 生成报告
4. 向候选人展示报告摘要（总分、维度分、优点、改进方向）

## 呈现规范
- 每轮只问一个问题，不要一次抛出多个问题
- 使用 [面试进度] 标签显示当前阶段和轮次
- 评分结果仅内部记录，不向候选人展示具体分数
- 面试结束后展示报告摘要和建议

## 禁止行为
- 不要自己编造面试问题，必须通过工具获取
- 不要跳过评分直接问下一问
- 不要修改面试服务返回的评分结果
```

#### 1.4 更新 `_harness_system_prompt()`

```python
def _harness_system_prompt(config, reasoning_effort, agent_type="resume"):
    if agent_type == "interviewer":
        return INTERVIEWER_SYSTEM_PROMPT  # 新的面试官 prompt
    # ... 简历助手逻辑不变
```

#### 1.5 更新 get_session_context 工具

在 `get_session_context` 的返回中，当 `agent_type="interviewer"` 时注入面试会话状态：
- 当前面试 session_id
- 当前阶段 (current_stage)
- 已完成轮次 / 总轮次
- 候选人目标岗位

### 第二阶段：interview/service.py 小改

#### 2.1 统一 answer_assessment 输出结构

在 `submit_turn()` 返回值中确保 `answer_assessment` 包含：
```python
{
    "summary": "...",        # 必填：本轮回答评估摘要
    "is_vague": true/false,
    "risk_points": [...],
    "positive_points": [...],
    "score": {...},          # 6维评分
    "score_reasons": {...},
}
```

#### 2.2 serialize_turn 增加 role 字段

```python
def serialize_turn(turn):
    return {
        ...
        "role": "interviewer" if not turn.answer else "candidate",
    }
```

### 第三阶段：前端组件

#### 3.1 InterviewerChatInput（新组件）

**文件**：`frontend/src/components/student/InterviewerChatInput.tsx`

**职责**：
- **Setup 阶段**：显示面试配置表单
  - 目标岗位（必填）
  - 岗位 JD（必填，textarea）
  - 面试类型（技术/HR/压力/综合，select）
  - 面试风格（严格/友好/高压，select）
  - 轮数（3-20，number input）
  - 公司名称（选填）
  - 级别（选填）
  - 开始面试按钮
- **Interview 阶段**：显示文本输入框 + 发送按钮
  - placeholder: "请输入你的回答..."
  - 回车发送

**接口**：
```tsx
interface InterviewerChatInputProps {
  phase: 'setup' | 'interview' | 'completed'
  onStartInterview: (params: InterviewStartParams) => void
  onSendMessage: (content: string) => void
  disabled?: boolean
}
```

#### 3.2 InterviewReportDrawer（新组件）

**文件**：`frontend/src/components/student/InterviewReportDrawer.tsx`

**职责**：抽屉式展示面试报告
- 总分 + 六维雷达图（CSS/SVG）
- 优势 / 不足 / 建议分组列表
- 训练计划时间线
- 改写示例对比（如果有）
- 下次面试预设信息
- 历史对比（如果有 previous report）

**接口**：
```tsx
interface InterviewReportDrawerProps {
  visible: boolean
  onClose: () => void
  report: InterviewReportData | null
  loading?: boolean
}
```

#### 3.3 修改 AIInterviewerPage

**文件**：`frontend/src/student/AIInterviewerPage.tsx`

**改动**：
1. 接入 `chatRuntimeStore`：
   - `phase='setup'` → 显示 `InterviewerChatInput`（setup 模式）
   - `phase='interview'` → 使用 chatRuntimeStore 管理消息和 SSE 流
   - `phase='completed'` → 激活报告查看按钮
2. 使用 `InterviewerChatInput` 替换现有的 `textarea` + 自定义 input
3. 添加 `InterviewReportDrawer`，面试完成后可通过按钮打开
4. 保留 `interviewList` 侧栏，点击可加载历史面试

#### 3.4 修改 chatRuntimeStore.ts

- 添加 `InterviewActivity` 类型（用于面试工具活动）
- `categorizeActivity()` 增加面试工具分类（`start_interview_session` → "面试设置"，`submit_interview_answer` → "评分中"）
- 添加面试报告状态字段（可选）

### 第四阶段：集成验证

- [ ] 后端：`/docs` 验证新工具可被正确调用
- [ ] 后端：agent_type="interviewer" session 创建后，LLM 能正确调用 start_interview_session
- [ ] 后端：submit_interview_answer 返回完整评估
- [ ] 后端：interview_transcript 包含 role 字段
- [ ] 前端：Setup 表单 → 开始面试 → SSE 流式对话
- [ ] 前端：面试完成后 InterviewReportDrawer 正确展示报告
- [ ] 前端：历史面试列表可加载和查看

---

## 实施顺序

1. **agent_runtime.py**：添加工具定义 + 系统 prompt + 工具函数（后端核心）
2. **interview/service.py**：serialize_turn 加 role + assessment 统一
3. **InterviewerChatInput.tsx**：新组件
4. **InterviewReportDrawer.tsx**：新组件
5. **AIInterviewerPage.tsx**：重构接入 chatRuntimeStore + 新组件
6. **chatRuntimeStore.ts**：面试工具分类

## 风险说明

- `agent_runtime.py` 是项目最复杂的文件（260KB+），改动需谨慎
- 面试服务的阶段状态机逻辑保持不变，仅通过工具包装接入
- LLM 需要正确解析 setup 参数并调用工具，system prompt 质量是关键
- SSE 流式 + 面试 REST 的桥接需要保证幂等性
