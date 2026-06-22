# 数据库设计说明书

> 最后更新：2026-06-18
>
> 权威源头：`backend/app/*/models.py`（SQLAlchemy 模型定义）+ `backend/alembic/versions/*.py`（42 个迁移文件）
>
> 本文档只列结构总览，列级类型/约束/索引以代码为准。

## 1. 整体说明

### 1.1 数据库选型

- **生产环境**：MySQL 8.4（`docker-compose.yml` 中映射到宿主 3307）
- **本地开发**：SQLite（`backend/zhipei_auth.db`，`.gitignore` 已忽略）
- **ORM**：SQLAlchemy 2.x
- **迁移工具**：Alembic（`backend/alembic/versions/`，命名规范 `YYYYMMDD_NNNN_slug.py`）

### 1.2 关键设计约定

| 约定 | 说明 |
|---|---|
| **零外键（零 FK）** | 所有表关系由应用层保证一致性。**唯一例外**：`mcp_tool.service_id → mcp_service.id`（外键） |
| **多租户隔离** | 几乎所有业务表带 `tenant_id` 字段，查询时强制带上 `tenant_id` 过滤。**所有数据查询都按 `tenant_id` 隔离** |
| **软删除** | 多数业务表带 `is_deleted`（布尔）+ `deleted_at`（时间戳），查询默认过滤；不物理删除 |
| **时间戳** | 通过 `TimestampMixin` 统一加 `created_at` / `updated_at`，MySQL 默认值 `now()` |
| **API Key 存储** | `api_key_cipher` 字段经 `encrypt/decrypt_api_key`（Fernet 真加密）落库 |
| **agent_type 双类型** | `student_agent_session.agent_type` 字段，合法值 `"resume"`（默认）/ `"interviewer"` |

### 1.3 表总数与业务域分布

共 **约 30 张业务表**，按业务域分 5 个组（见 §3）。

## 2. 命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| 表名 | `snake_case` | `student_agent_session` |
| 字段名 | `snake_case` | `summarized_until_message_id` |
| 主键 | `id: int` 自增 | `id` |
| 外键 | **不显式建约束**，字段名以 `*_id` 结尾 | `student_id` / `session_id` |
| 时间戳 | `created_at` / `updated_at` / `deleted_at` | |
| 布尔 | `is_*` 或状态字段（`status` 等） | `is_deleted` / `open_to_student` |
| 加密字段 | `*_cipher` 后缀 | `api_key_cipher` |
| JSON 字段 | `*_json` 后缀 | `memory_json` / `score_json` |
| 哈希字段 | `*_hash` 后缀 | `password_hash` / `token_hash` |

## 3. 业务域分组

### 3.1 鉴权域

> 域路径：`backend/app/auth/models.py`
> 职责：管理员/学生账号、Token 存证、登录审计、邮箱验证码

| 表 | 关键字段 | 说明 |
|---|---|---|
| `admin_user` | username, email, password_hash, display_name, status, avatar_url | 管理员账号 |
| `student_user` | account, email, password_hash, name, **nickname**, college, major, grade, gender, age, avatar_url, banner_url, signature, birth_date | 学生账号（带个人档案字段） |
| `*_refresh_token` | token_hash, expires_at, revoked | refresh token 存证（admin/student 各一张） |
| `*_login_log` | ip, ua, result, reason | 登录审计日志 |
| `student_email_code` | email, scene, code_hash, expires_at, send_count, attempt_count | 邮箱验证码（scene 区分注册/重置密码） |

**设计要点**：
- `student_user` 把账号和基础个人档案合并到一张表（昵称/学院/专业/年级/头像/横幅/签名/生日）
- 完整个人档案明细（教育/工作/项目/技能/荣誉/证书）单独存到「学生端域」的 `student_*_detail` 表
- refresh token 仅存哈希，不存原文

### 3.2 管理域

> 域路径：`backend/app/admin/models.py` + `backend/app/admin/master_models.py`
> 职责：模型广场、主智能体配置、路由规则、子智能体、系统配置

| 表 | 关键字段 | 说明 |
|---|---|---|
| `model_config` | display_name, provider, base_url, **api_key_cipher**（Fernet 真加密）, model_identifier, capability, open_to_student, status | 模型广场条目 |
| `model_test_log` | model_id, success, latency_ms, error_message | 模型连接测试日志 |
| `system_config` | config_key, config_value | 键值对系统配置 |
| `agent` | name, category, model_config_id, system_prompt, temperature, use_dify, dify_api_key_cipher | 单体智能体（独立子智能体） |
| `master_agent_config` | model_id, system_prompt, temperature, max_iterations, permission_mode | 主智能体 Harness 全局配置 |
| `master_route_rule` | intent, target_agent_key, target_provider, provider_config_json | 子智能体路由规则（按意图分派） |
| `user_feedback` | student_id, description, category, screenshot_path, status | 学生反馈工单 |

**设计要点**：
- API Key 用 Fernet（`cryptography.fernet`）真加密，密钥从 `API_KEY_ENCRYPTION_KEY` 环境变量注入
- `model_config.open_to_student` 决定学生端是否可选该模型
- `capability` 枚举：`text` / `multimodal` / `chat`

### 3.3 学生端域

> 域路径：`backend/app/student/agent_models.py` + `resume_models.py` + `revision_models.py` + `profile_details_models.py` + `event_models.py`
> 职责：对话会话/消息/活动/附件/简历/日程/档案明细

| 表 | 关键字段 | 说明 |
|---|---|---|
| `student_agent_session` | tenant_id, student_id, title, status, **agent_type**, summary, **active_resume_id**, memory_json, summarized_until_message_id, jd_text, jd_analyzed_at | 对话会话（`agent_type` 双类型） |
| `student_agent_message` | session_id, role, content | 消息 |
| `student_agent_activity` | session_id, message_id, kind, name, status, summary, detail_json | 工具活动审计（每次工具调用落一条） |
| `student_agent_attachment` | session_id, message_id, original_name, stored_path, content_type, extracted_text, status | 附件/简历/PDF 存储 |
| `student_agent_run` | session_id, status, error_text | 后台运行实例（用于异步 SSE 模式） |
| `student_resume` | student_id, title, content_json, visibility, avatar_url | 在线简历 |
| `student_resume_revision` | resume_id, content_json, created_at | 简历快照（撤销用，每份最多 20 条） |
| `student_event` | student_id, title, date, ... | 日程事件 |
| `student_*_detail` | （profile_details_models.py） | 档案明细：教育/工作/项目/技能/荣誉/证书 |

**设计要点**：
- `student_agent_session` 是整个学生端最核心的表，承载两种 agent（简历助手 / 面试官）的会话
- `active_resume_id` 绑定当前工作简历
- `memory_json` 存会话级记忆（constraints / facts / preferences）
- `summarized_until_message_id` 是 D2 水位线，标识已被摘要压缩的旧消息边界
- 简历做快照式版本控制，最多 20 个快照

### 3.4 面试官域

> 域路径：`backend/app/interview/models.py`
> 职责：模拟面试会话、单轮问答、面试报告

| 表 | 关键字段 | 说明 |
|---|---|---|
| `interview_session` | student_id, interview_type, status, round_limit, focus_tags, resume_snapshot, jd_text | 面试会话 |
| `interview_turn` | session_id, turn_number, question, answer, score_json, followup, stage | 单轮问答 |
| `interview_report` | session_id, overall_score, dimension_scores_json, summary, strengths, weaknesses, training_plan | 面试报告 |

**设计要点**：
- `interview_type` 决定 8 阶段状态机裁剪（通用 / 技术 / HR / 压力面试）
- `score_json` 存 6 维度评分（technical_accuracy / project_evidence / problem_solving / communication / job_fit / pressure_handling）
- `resume_snapshot` 在面试开始时冻结一份简历快照，避免简历被改动后影响面试追问依据

### 3.5 Skill / MCP 域

> 域路径：`backend/app/skills/models.py` + `backend/app/mcp/models.py`
> 职责：Skill 资产、MCP 服务/MCP 工具/调用日志

| 表 | 关键字段 | 说明 |
|---|---|---|
| `skill_asset` | slug, name, description, version, category, status, file_path, content_hash | Skill（Markdown 资产） |
| `mcp_service` | slug, name, transport, endpoint, auth_type, status | MCP 服务 |
| `mcp_tool` | **service_id**（唯一外键）, name, description, risk, input_schema_json, enabled | MCP 工具（挂在某个 service 下） |
| `mcp_call_log` | service_name, tool_name, success, latency_ms | 调用日志 |

**设计要点**：
- **`mcp_tool.service_id → mcp_service.id` 是全库唯一的外键**（其他所有关系都靠应用层）
- `risk` 标识工具风险等级（Harness 用作权限裁决）
- `input_schema_json` 存 OpenAI function-calling 的 JSON Schema

## 4. 关键索引

来自 `backend/alembic/versions/20260615_0001_add_business_indexes.py`（按迁移日期排序的最显式索引迁移）：

| 表 | 索引 | 用途 |
|---|---|---|
| `student_agent_session` | (tenant_id, student_id, status, updated_at) | 学生会话列表 |
| `student_agent_message` | (session_id, id) | 消息按会话分页 |
| `interview_session` | (student_id, status, updated_at) | 面试列表 |
| `interview_turn` | (session_id, turn_number) | 面试单轮查询 |
| `mcp_call_log` | (created_at) | 调用日志按时间窗查询 |
| `user_feedback` | (status, created_at) | 反馈工单按状态分页 |

## 5. 迁移历史

`backend/alembic/versions/` 共 **42 个迁移文件**，命名规范 `YYYYMMDD_NNNN_slug.py`。从文件名能反推表结构演进：

- 最早：`20260603_0001_init_auth_mvp.py`（建 `admin_user` / `student_user`）
- 中期：按业务域叠加（模型广场 / agent / mcp / 简历 / 面试官 / 技能）
- 最新：`20260617_0001_interview_report_analysis.py`（面试报告分析）
- 中间穿插：`20260615_0001_add_business_indexes.py`（加 6 个业务索引）、`20260605_0008_seed_baseline_data.py`（种子数据：默认管理员 / 默认模型 / 默认智能体）

迁移在容器内的执行入口：`backend/entrypoint.sh`，对「有表无 alembic_version」的情况自动 `stamp` 再 `upgrade`。

## 6. 待补章节

- 列级类型 / 约束 / 索引完整列表（建议按 `models.py` 自动生成）
- ER 图（暂无）
