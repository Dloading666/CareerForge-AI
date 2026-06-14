# AI 面试官执行逻辑与八项需求完成度审计

审计日期：2026-06-12

## 1. 用户提交简历后是否能直接针对简历提问

结论：部分可以，但“指定在线简历”没完成。

后端现状：

- 上传简历：前端上传文件到 `/api/v1/student/interviews/resume/extract`，后端解析 PDF/DOCX/TXT/MD。
- 在线简历：后端 `_latest_resume_snapshot(...)` 会优先读取 `visibility=True` 的在线简历，否则回退到最新保存简历。

相关代码：

- `backend/app/interview/service.py:207-228`
- `backend/app/interview/service.py:237-287`
- `frontend/src/student/AIInterviewerPage.tsx:311-329`

问题：

- 前端“在线简历”只是一个来源选项，没有列出简历中心已有简历。
- 后端 `InterviewStartRequest` 没有 `resume_id`。
- 后端只能按 `visibility=True` 或更新时间自动选，用户不能明确选择“这份简历”。

应改：

- 前端悬停/点击“在线简历”时请求 `/api/v1/student/resumes`。
- 弹出简历列表：标题、更新时间、是否智能体可读。
- 选中后将 `resume_id` 存入 state。
- 后端 `InterviewStartRequest` 增加 `resume_id: Optional[int]`。
- `start_interview(...)` 优先按 `resume_id + tenant_id + student_id` 读取简历。

## 2. 岗位信息和 JD 是否进行了分析处理

结论：有基础处理，但不是完整 JD 分析 Agent。

已完成：

- `job_description` 后端必填：`backend/app/interview/schemas.py:28-30`
- `start_interview(...)` 二次校验 JD：`backend/app/interview/service.py:802-805`
- 从 JD 提取技能关键词：`backend/app/interview/service.py:452-466`
- RAG 检索 query 包含目标岗位和 JD：`backend/app/interview/service.py:814-818`
- prompt 注入 JD、面试类型、风格、简历、题库结果：`backend/app/interview/service.py:857-870`

不足：

- 没有像简历助手 `analyze_jd_match` 那样形成 P0/P1/GAP 结构化矩阵。
- 岗位画像字段后端有，但前端没有公司、级别、技能标签输入。
- 报告中的岗位匹配主要依赖模型判断，没有独立程序化 JD 覆盖率校验。

## 3. 参考牛客执行流程后的建议流程

牛客公开资料强调：

- 解析岗位 JD。
- 根据 JD 生成针对性问题。
- 动态追问。
- 技能/情景评估。
- 生成结构化评估报告。

建议 CareerForge 面试官流程：

```text
选择简历
  -> 输入目标岗位和 JD
  -> Harness 解析 JD：硬性要求、核心技能、加分项、风险项
  -> 读取简历并做 JD-简历匹配
  -> 生成面试阶段计划
  -> 第一问围绕简历中最匹配或最高风险经历
  -> 每轮回答后：评分、证据引用、追问原因、下一题
  -> 达到结束条件后生成报告
  -> 报告给训练计划和下一场预设
```

当前完成度：

- 选择简历：40%
- 输入目标岗位和 JD：80%
- JD 解析：40%
- JD-简历匹配：40%
- 阶段计划：70%
- 动态追问：70%
- 报告：70%
- 训练闭环：50%

## 4. 是否有 Harness 护栏，是否 Agentic Loop，最大限制次数是多少

结论：有受控式 JSON Harness Loop，但不是简历助手那种 function-calling Agentic Loop。

已有 Harness：

- `run_harnessed_json_generation(...)`：模型输出 JSON -> 解析 -> validator -> repair prompt -> fallback。
- `validate_start_output(...)`
- `validate_followup_output(...)`
- `validate_report_output(...)`
- `harness_should_finish_interview(...)`

相关代码：

- `backend/app/interview/harness.py:197-337`
- `backend/app/interview/harness.py:343-654`
- `backend/app/interview/harness.py:659-700`

最大次数：

- 开场：`max_retries=2`，最多 3 次模型尝试。
- 追问：`max_retries=2`，最多 3 次模型尝试。
- 报告：`max_retries=3`，最多 4 次模型尝试。
- 默认总耗时上限：`max_total_seconds=30.0`，但报告调用没有显式传 45 秒，仍走默认 30 秒。

相关代码：

- `backend/app/interview/service.py:872-884`
- `backend/app/interview/service.py:1127-1140`
- `backend/app/interview/service.py:1384-1396`
- `backend/app/interview/harness.py:210-211`

面试轮次限制：

- `round_limit` 默认 8，schema 允许 3 到 20。
- 到达 `round_limit` 后 Harness 强制结束。

相关代码：

- `backend/app/interview/schemas.py:40-41`
- `backend/app/interview/harness.py:675-677`

不足：

- `validate_start_output` 未强校验所有 required fields。
- `validate_report_output` 对训练计划字段不是强制。
- 幻觉校验主要覆盖引用式追问和 evidence quote，不是完整事实一致性校验。
- 没有独立 `state_machine.py`，状态机仍散落在 `service.py`。

## 5. 在线简历悬停显示简历中心简历

结论：未完成。

已有可复用接口：

- `GET /api/v1/student/resumes` 返回当前学生所有在线简历 summary。
- `backend/app/student/resume_router.py:532-546`

简历助手已有类似选择器：

- `frontend/src/student/AgentChatView.tsx:291-425`

AI 面试官现状：

- 只有“在线简历 / 本次上传简历”两个来源选项。
- 没有加载简历列表。
- 没有 `resume_id`。

相关代码：

- `frontend/src/student/AIInterviewerPage.tsx:649-720`

建议：

- 抽一个 `InterviewResumePicker`。
- 鼠标悬停或点击“在线简历”时加载简历列表。
- 若没有简历，显示“去简历中心创建”。
- 选中后传 `resume_id` 给后端。

## 6. 面试类型只显示初面和二面

结论：未完成。

前端目前显示 8 个选项：

- 一面
- 二面
- 技术面试
- 项目深挖
- HR 面
- 总经理面试
- 终面
- 压力面

位置：`frontend/src/student/AIInterviewerPage.tsx:131-140`

后端也支持更多类型：

- `backend/app/interview/prompts.py:116-156`

建议：

- 前端 `INTERVIEW_TYPE_OPTIONS` 只保留：
  - `first_round`
  - `second_round`
- 默认值从 `technical` 改为 `first_round`：
  - 当前默认：`frontend/src/student/AIInterviewerPage.tsx:214`
- 后端保留旧值兼容历史数据，但 `InterviewStartRequest` 新请求只允许 `first_round/second_round`。

## 7. 语音输入功能和 Mimo v2.5

结论：当前没有真正接入 Mimo v2.5 语音能力。

当前前端使用浏览器 Web Speech API：

- `SpeechRecognition`
- `webkitSpeechRecognition`

位置：`frontend/src/student/AIInterviewerPage.tsx:472-514`

当前没有：

- `MediaRecorder`
- 音频上传接口
- `/turns/voice`
- 服务端 ASR
- TTS 回复
- Mimo v2.5 音频输入适配

检索结果显示后端/前端没有面试语音接口：

- 未发现 `turns/voice`
- 未发现 `voice/transcribe`
- 未发现 `MediaRecorder`
- 未发现面试 TTS 接口

正确实现方式：

```text
MediaRecorder 录音
  -> POST /student/interviews/{id}/turns/voice
  -> 后端调用 ASR 或 Mimo 音频转写
  -> transcript 进入 submit_turn(...)
  -> 同一套 Harness 校验
  -> 返回 next_turn
  -> 可选 TTS 只朗读已入库的 next_turn.question
```

注意：不能把浏览器语音输入辅助说成“多模态语音面试”。

## 8. 结束报告生成显示报告不存在

结论：这是明确 bug。

前端按钮：

- 文案：结束并生成报告
- 实现：调用 `loadReport()`
- `loadReport()` 实际请求 `GET /report`

位置：

- `frontend/src/student/AIInterviewerPage.tsx:573-590`
- `frontend/src/student/AIInterviewerPage.tsx:1002-1004`

后端 `GET /report` 只查询，不生成：

- `backend/app/interview/service.py:1492-1503`

如果当前 session 没有自动完成，也没有调用 `/finish`，就会返回“报告不存在”。

应改：

- 点击“结束并生成报告”调用 `POST /api/v1/student/interviews/{session_id}/finish`。
- 成功后 setReport。
- 再刷新历史列表。
- 如果报告已存在，后端 `generate_report(...)` 会返回 existing，不会重复生成。

## 9. docs 中的 AI 面试官完成度

综合现有 docs 和源码，完成度如下：

| 模块 | 完成度 | 说明 |
|---|---:|---|
| 独立面试 API | 80% | `/student/interviews` 已成主入口 |
| 目标岗位和 JD 必填 | 85% | 前后端基本完成 |
| 读取简历 | 60% | 上传/自动在线读取有，指定在线简历无 |
| JD 画像 | 50% | 后端关键词提取有，前端画像输入少 |
| Harness Loop | 70% | 有 JSON Loop 和 retry，但 required fields 不完整 |
| 阶段状态机 | 60% | 有阶段字段和推进函数，但未抽控制器 |
| 题库 RAG | 65% | 有检索和来源字段，前端展示不充分 |
| 每轮评分解释 | 60% | 后端字段有，前端展示有限 |
| 报告生成 | 65% | 后端可生成，前端按钮链路错误 |
| 训练闭环 | 45% | 字段和 fallback 有，展示和复练弱 |
| 流式输出 | 20% | 只有前端模拟状态，无面试 SSE |
| 语音输入 | 20% | 只有浏览器语音输入辅助 |
| 真正语音对话 | 0% | 无服务端 ASR/TTS/音频接口 |
| 面试类型只保留初面二面 | 0% | 前后端仍有多类型 |
| 在线简历悬停列表 | 0% | 未接入 |

总体完成度：约 55% 到 65%。基础面试闭环能跑，但距离你 docs 里规划的“岗位定制化训练闭环 + 语音 + 类牛客流程”还有明显缺口。

