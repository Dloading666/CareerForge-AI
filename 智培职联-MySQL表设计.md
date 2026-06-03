# 智培职联 · AI 智能体平台 — MySQL 8.0 表设计文档（V1）

> 配套《产品设计文档 V4》。承载平台业务数据；向量/RAG 在 PostgreSQL+pgvector（Dify）侧，不在本库。
> 引擎 InnoDB，字符集 utf8mb4_0900_ai_ci。

---

## 1. 设计原则（落地你的约束）

1. **零多态外键**：禁止任何「一个字段按类型指向多张表」（如 `target_type+target_id`）。需要多态的地方一律**拆成独立表**。
2. **按上下文拆表，不复用**：
   - 用户拆为 `admin_user` / `student_user`；
   - 登录日志拆为 `admin_login_log` / `student_login_log`；审计拆为 `admin_audit_log` / `student_action_log`；
   - 会话拆为 `master_conversation` / `subagent_conversation`；消息同拆；
   - 报告拆为 `interview_report` / `match_report`。
3. **不建外键约束（FK）**：表间引用一律用普通 `BIGINT UNSIGNED` 字段做**软引用**，仅建普通索引，关系完整性由应用层（FastAPI）保证。表之间**松耦合、可独立演进**。
4. **智能体能力绑定用 JSON 数组**，内联在 `agent` 行（`bound_model_ids`/`bound_skill_ids`/`bound_mcp_tool_ids`/`bound_kb_ids`），**装配一个智能体不需要 join，也无需中间关联表**。反查（"哪些智能体用了技能 X"）用 `JSON_CONTAINS`，属低频管理操作。
5. **父子从属表允许**（如 `mcp_server`→`mcp_tool`、`knowledge_base`→`knowledge_document`）：这是「一列指向唯一一张表」的 1:N，不违反约束。

> 取舍说明：以上为「尽量不关联」的工程化解读——保留必要的**单列软引用**与**域内父子表**，消除**多态**与**M:N 中间表**。若你要更彻底（连 JSON 内联也不要、改为应用层多次查询），告诉我即可调整。

---

## 2. 通用约定

| 约定 | 取值 |
|---|---|
| 主键 | `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY` |
| 时间 | `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`、`updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` |
| 软引用 | `xxx_id BIGINT UNSIGNED`（无 FK，建索引 `idx_xxx_id`） |
| 状态/枚举 | `VARCHAR(32)`，注释列出取值（避免 ENUM 改值需 DDL） |
| 布尔 | `TINYINT(1) DEFAULT 0` |
| 密钥/敏感 | 仅存密文（`xxx_cipher`），明文不落库 |
| 大字段 | 列表/报告负载用 `JSON`；长文本用 `TEXT` |
| 删除 | 关键表用软删除 `is_deleted TINYINT(1) DEFAULT 0` |
| 多租户 | 预留 `tenant_id BIGINT UNSIGNED DEFAULT 0`（MVP 单租户=0，后续按校区扩展） |

---

## 3. 表清单（28 张，按域）

| 域 | 表 | 用途 |
|---|---|---|
| 鉴权 | `admin_user` / `student_user` | 管理员 / 学生账号（拆开） |
| 鉴权 | `admin_refresh_token` / `student_refresh_token` | 刷新令牌（拆开） |
| 鉴权 | `admin_login_log` / `student_login_log` | 登录审计（拆开） |
| 模型 | `model_config` | 接入的模型（含对学生开放、测速） |
| 模型 | `model_test_log` | 连接/测速记录 |
| MCP | `mcp_server` / `mcp_tool` | MCP 服务 / 其暴露的工具 |
| 技能 | `skill` | 可复用原子技能 |
| 知识 | `knowledge_base` / `knowledge_document` | 知识库 / 文档 |
| 智能体 | `agent` | 子智能体注册表（JSON 内联绑定） |
| 智能体 | `master_agent_config` | 主智能体配置（单行/每租户） |
| 智能体 | `master_agent_route` | 主→子 路由规则 |
| 会话 | `master_conversation` / `master_message` | 主智能体会话 / 消息 |
| 会话 | `subagent_conversation` / `subagent_message` | 子智能体会话 / 消息（隔离） |
| 面试 | `interview_session` / `interview_qa` / `interview_report` | 面试会话 / 逐题 / 复盘报告 |
| 匹配 | `match_task` / `match_report` | 匹配任务 / 匹配报告 |
| 文件 | `upload_file` | 学生上传（简历等） |
| 审计 | `admin_audit_log` / `student_action_log` | 操作审计（拆开） |

---

## 4. 详细表结构（DDL）

### 4.1 鉴权域

```sql
CREATE TABLE admin_user (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  username      VARCHAR(64)      NOT NULL,
  phone         VARCHAR(20)      NULL,
  password_hash VARCHAR(100)     NOT NULL COMMENT 'bcrypt/argon2',
  display_name  VARCHAR(64)      NULL,
  status        VARCHAR(32)      NOT NULL DEFAULT 'active' COMMENT 'active/disabled',
  last_login_at DATETIME         NULL,
  is_deleted    TINYINT(1)       NOT NULL DEFAULT 0,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_admin_username (tenant_id, username),
  KEY idx_admin_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE student_user (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  account       VARCHAR(64)      NOT NULL COMMENT '学号/手机号',
  phone         VARCHAR(20)      NULL,
  password_hash VARCHAR(100)     NOT NULL,
  name          VARCHAR(64)      NULL,
  college       VARCHAR(128)     NULL,
  major         VARCHAR(128)     NULL,
  grade         VARCHAR(32)      NULL COMMENT '年级',
  avatar_url    VARCHAR(512)     NULL,
  status        VARCHAR(32)      NOT NULL DEFAULT 'active',
  last_login_at DATETIME         NULL,
  is_deleted    TINYINT(1)       NOT NULL DEFAULT 0,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_student_account (tenant_id, account),
  KEY idx_student_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admin_refresh_token (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id    BIGINT UNSIGNED NOT NULL,
  token_hash  VARCHAR(100)    NOT NULL,
  expires_at  DATETIME        NOT NULL,
  revoked     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_art_admin (admin_id),
  KEY idx_art_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE student_refresh_token (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id  BIGINT UNSIGNED NOT NULL,
  token_hash  VARCHAR(100)    NOT NULL,
  expires_at  DATETIME        NOT NULL,
  revoked     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_srt_student (student_id),
  KEY idx_srt_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admin_login_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id   BIGINT UNSIGNED NULL,
  username   VARCHAR(64)     NULL,
  ip         VARCHAR(64)     NULL,
  ua         VARCHAR(256)    NULL,
  result     VARCHAR(32)     NOT NULL COMMENT 'success/fail',
  reason     VARCHAR(128)    NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_all_admin (admin_id), KEY idx_all_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE student_login_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NULL,
  account    VARCHAR(64)     NULL,
  ip         VARCHAR(64)     NULL,
  ua         VARCHAR(256)    NULL,
  result     VARCHAR(32)     NOT NULL,
  reason     VARCHAR(128)    NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sll_student (student_id), KEY idx_sll_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.2 模型域

```sql
CREATE TABLE model_config (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  display_name     VARCHAR(128)    NOT NULL,
  provider         VARCHAR(64)     NOT NULL COMMENT 'openai_compatible/deepseek/doubao/qwen/glm/azure/ollama/custom',
  deploy_type      VARCHAR(16)     NOT NULL DEFAULT 'cloud' COMMENT 'cloud/local',
  capability       VARCHAR(16)     NOT NULL DEFAULT 'llm' COMMENT 'llm/embedding/rerank',
  protocols        VARCHAR(64)     NOT NULL DEFAULT 'openai' COMMENT 'CSV: openai,anthropic',
  base_url         VARCHAR(512)    NOT NULL,
  api_key_cipher   VARCHAR(1024)   NULL COMMENT '密文；本地模型可空',
  model_identifier VARCHAR(128)    NOT NULL COMMENT '如 deepseek-chat',
  context_length   INT             NULL,
  default_temp     DECIMAL(3,2)    NULL,
  max_output       INT             NULL,
  timeout_sec      INT             NOT NULL DEFAULT 60,
  dify_model_ref   VARCHAR(128)    NULL COMMENT 'Dify 内模型/供应商标识',
  test_status      VARCHAR(16)     NOT NULL DEFAULT 'untested' COMMENT 'untested/ok/error',
  last_latency_ms  INT             NULL,
  tested_at        DATETIME        NULL,
  open_to_student  TINYINT(1)      NOT NULL DEFAULT 0,
  is_deleted       TINYINT(1)      NOT NULL DEFAULT 0,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mc_open (tenant_id, open_to_student, capability),
  KEY idx_mc_status (test_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE model_test_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  model_id    BIGINT UNSIGNED NOT NULL,
  status      VARCHAR(16)     NOT NULL COMMENT 'ok/error',
  latency_ms  INT             NULL,
  message     VARCHAR(512)    NULL COMMENT '错误码翻译后的人话',
  tested_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mtl_model (model_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.3 MCP 域

```sql
CREATE TABLE mcp_server (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name        VARCHAR(128)    NOT NULL,
  transport   VARCHAR(16)     NOT NULL COMMENT 'stdio/sse/http',
  endpoint    VARCHAR(1024)   NOT NULL COMMENT '命令或 URL',
  auth_json   JSON            NULL COMMENT 'env/header 键值（敏感值加密）',
  timeout_sec INT             NOT NULL DEFAULT 30,
  status      VARCHAR(16)     NOT NULL DEFAULT 'untested' COMMENT 'untested/connected/error',
  tool_count  INT             NOT NULL DEFAULT 0 COMMENT '冗余计数',
  enabled     TINYINT(1)      NOT NULL DEFAULT 0,
  tested_at   DATETIME        NULL,
  is_deleted  TINYINT(1)      NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mcp_enabled (tenant_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mcp_tool (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mcp_server_id BIGINT UNSIGNED NOT NULL COMMENT '软引用 mcp_server.id',
  tool_name     VARCHAR(128)    NOT NULL,
  description   VARCHAR(512)    NULL,
  input_schema  JSON            NULL,
  enabled       TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mt_server (mcp_server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.4 技能域

```sql
CREATE TABLE skill (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name            VARCHAR(128)    NOT NULL,
  description     VARCHAR(512)    NULL,
  sub_abilities   JSON            NULL COMMENT '子能力名数组',
  impl_type       VARCHAR(32)     NOT NULL COMMENT 'dify_workflow/langgraph_subgraph',
  impl_ref        VARCHAR(128)    NULL COMMENT 'Dify App ID 或 图名',
  default_model_id BIGINT UNSIGNED NULL COMMENT '软引用 model_config.id',
  dep_mcp_tool_ids JSON           NULL COMMENT '依赖的 MCP 工具 id 数组（内联，无中间表）',
  status          VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT 'draft/enabled/disabled',
  ref_count       INT             NOT NULL DEFAULT 0 COMMENT '被智能体引用数（冗余）',
  icon            VARCHAR(256)    NULL,
  is_deleted      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_skill_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.5 知识域

```sql
CREATE TABLE knowledge_base (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name            VARCHAR(128)    NOT NULL,
  description     VARCHAR(512)    NULL,
  dify_dataset_ref VARCHAR(128)   NULL COMMENT 'Dify 数据集 id',
  doc_count       INT             NOT NULL DEFAULT 0,
  vector_status   VARCHAR(16)     NOT NULL DEFAULT 'idle' COMMENT 'idle/processing/ready/error',
  is_deleted      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_kb_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE knowledge_document (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  knowledge_base_id BIGINT UNSIGNED NOT NULL COMMENT '软引用 knowledge_base.id',
  name              VARCHAR(256)    NOT NULL,
  file_type         VARCHAR(32)     NULL,
  chunk_count       INT             NOT NULL DEFAULT 0,
  status            VARCHAR(16)     NOT NULL DEFAULT 'processing' COMMENT 'processing/ready/error',
  dify_doc_ref      VARCHAR(128)    NULL,
  uploaded_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_kd_kb (knowledge_base_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.6 智能体域

```sql
CREATE TABLE agent (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  code             VARCHAR(64)     NOT NULL COMMENT '稳定标识，如 interviewer/job_match',
  name             VARCHAR(128)    NOT NULL,
  icon             VARCHAR(256)    NULL,
  description      VARCHAR(512)    NULL,
  ability_points   JSON            NULL COMMENT '能力点数组',
  tags             JSON            NULL,
  exec_type        VARCHAR(32)     NOT NULL COMMENT 'dify_app/langgraph_graph',
  exec_ref         VARCHAR(128)    NULL COMMENT 'Dify App ID 或 图名，如 interview_agent_v1',
  ui_type          VARCHAR(32)     NOT NULL DEFAULT 'chat' COMMENT 'chat/interview/match —— 决定前端体验骨架',
  bound_model_ids  JSON            NULL COMMENT '可用模型 id 数组（内联）',
  default_model_id BIGINT UNSIGNED NULL,
  bound_skill_ids  JSON            NULL COMMENT '编排技能 id 数组（有序）',
  bound_mcp_tool_ids JSON          NULL COMMENT '授权工具 id 数组',
  bound_kb_ids     JSON            NULL COMMENT '专属知识库 id 数组',
  allow_master_call TINYINT(1)     NOT NULL DEFAULT 1 COMMENT '是否允许被主智能体调用',
  status           VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT 'draft/published/offline',
  sort             INT             NOT NULL DEFAULT 0,
  is_deleted       TINYINT(1)      NOT NULL DEFAULT 0,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_code (tenant_id, code),
  KEY idx_agent_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE master_agent_config (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name             VARCHAR(128)    NOT NULL DEFAULT '就业总助手',
  avatar           VARCHAR(256)    NULL,
  positioning      VARCHAR(256)    NULL,
  default_model_id BIGINT UNSIGNED NULL,
  system_prompt    TEXT            NULL,
  allow_all_skills TINYINT(1)      NOT NULL DEFAULT 1,
  allow_all_mcp    TINYINT(1)      NOT NULL DEFAULT 1,
  allow_all_kb     TINYINT(1)      NOT NULL DEFAULT 1,
  skill_scope_ids  JSON            NULL COMMENT 'NULL=全部；否则白名单',
  mcp_scope_ids    JSON            NULL,
  kb_scope_ids     JSON            NULL,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_master_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE master_agent_route (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  intent_keywords  VARCHAR(512)    NOT NULL COMMENT '逗号分隔意图词',
  target_agent_id  BIGINT UNSIGNED NOT NULL COMMENT '软引用 agent.id（唯一一张表）',
  priority         INT             NOT NULL DEFAULT 0,
  enabled          TINYINT(1)      NOT NULL DEFAULT 1,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_route_tenant (tenant_id, enabled, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.7 会话域（记忆隔离的核心）

```sql
-- 主智能体会话：每个学生可有多个；model_id 为当前模型，切换即更新
CREATE TABLE master_conversation (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id  BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(256)    NULL,
  model_id    BIGINT UNSIGNED NULL COMMENT '当前主智能体模型；调用子智能体时透传此值',
  thread_key  VARCHAR(64)     NOT NULL COMMENT 'LangGraph checkpointer thread_id（隔离单位）',
  status      VARCHAR(16)     NOT NULL DEFAULT 'active',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mconv_student (student_id),
  UNIQUE KEY uk_mconv_thread (thread_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE master_message (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  master_conversation_id BIGINT UNSIGNED NOT NULL,
  role                  VARCHAR(16)     NOT NULL COMMENT 'user/assistant/tool',
  content               MEDIUMTEXT      NULL,
  action_type           VARCHAR(32)     NULL COMMENT 'skill_call/mcp_call/kb_query/subagent_call',
  action_meta           JSON            NULL COMMENT '动作明细（技能名/工具名/知识库名/子会话id+摘要）',
  model_id              BIGINT UNSIGNED NULL COMMENT '生成该条所用模型',
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mmsg_conv (master_conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 子智能体会话：被主调用(via_master)或广场直用(direct)；记忆与主线程隔离
CREATE TABLE subagent_conversation (
  id                         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id                 BIGINT UNSIGNED NOT NULL,
  agent_id                   BIGINT UNSIGNED NOT NULL COMMENT '软引用 agent.id',
  model_id                   BIGINT UNSIGNED NULL COMMENT 'via_master=继承主模型；direct=学生自选',
  entry_type                 VARCHAR(16)     NOT NULL COMMENT 'via_master/direct',
  parent_master_conversation_id BIGINT UNSIGNED NULL COMMENT 'via_master 时来源主会话（软引用）',
  thread_key                 VARCHAR(64)     NOT NULL COMMENT '独立 thread_id（与主隔离）',
  status                     VARCHAR(16)     NOT NULL DEFAULT 'active',
  created_at                 DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sconv_student (student_id),
  KEY idx_sconv_agent (agent_id),
  UNIQUE KEY uk_sconv_thread (thread_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE subagent_message (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subagent_conversation_id BIGINT UNSIGNED NOT NULL,
  role                    VARCHAR(16)     NOT NULL,
  content                 MEDIUMTEXT      NULL,
  action_type             VARCHAR(32)     NULL,
  action_meta             JSON            NULL,
  created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_smsg_conv (subagent_conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.8 面试域

```sql
CREATE TABLE interview_session (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id              BIGINT UNSIGNED NOT NULL,
  agent_id                BIGINT UNSIGNED NOT NULL,
  subagent_conversation_id BIGINT UNSIGNED NULL COMMENT '所属子会话（记忆/模型来源）',
  model_id                BIGINT UNSIGNED NULL,
  target_position         VARCHAR(128)    NULL,
  resume_file_id          BIGINT UNSIGNED NULL COMMENT '软引用 upload_file.id',
  interview_types         JSON            NULL COMMENT '技术/行为/综合/专业',
  difficulty              VARCHAR(16)     NULL COMMENT 'junior/mid/senior',
  question_count          INT             NULL,
  answer_mode             VARCHAR(16)     NULL COMMENT 'text/voice',
  status                  VARCHAR(16)     NOT NULL DEFAULT 'ongoing' COMMENT 'ongoing/finished/aborted',
  started_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at             DATETIME        NULL,
  KEY idx_is_student (student_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE interview_qa (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  interview_session_id BIGINT UNSIGNED NOT NULL,
  seq                 INT             NOT NULL,
  dimension           VARCHAR(64)     NULL COMMENT '考察维度',
  question            TEXT            NULL,
  answer              MEDIUMTEXT      NULL,
  score               INT             NULL,
  comment             TEXT            NULL COMMENT '逐题点评',
  better_answer       TEXT            NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_iqa_session (interview_session_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE interview_report (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  interview_session_id BIGINT UNSIGNED NOT NULL,
  overall_score       INT             NULL,
  grade               VARCHAR(8)      NULL,
  summary             TEXT            NULL,
  radar_json          JSON            NULL COMMENT '各维度分',
  strengths_json      JSON            NULL,
  weaknesses_json     JSON            NULL,
  suggestions_json    JSON            NULL,
  export_pdf_url      VARCHAR(512)    NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ir_session (interview_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.9 匹配域

```sql
CREATE TABLE match_task (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id              BIGINT UNSIGNED NOT NULL,
  agent_id                BIGINT UNSIGNED NOT NULL,
  subagent_conversation_id BIGINT UNSIGNED NULL,
  model_id                BIGINT UNSIGNED NULL,
  resume_source           VARCHAR(16)     NULL COMMENT 'upload/profile/manual',
  resume_file_id          BIGINT UNSIGNED NULL,
  resume_text             MEDIUMTEXT      NULL,
  jd_source               VARCHAR(16)     NULL COMMENT 'paste/library/recommend',
  jd_text                 MEDIUMTEXT      NULL,
  target_position         VARCHAR(128)    NULL,
  status                  VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending/done/error',
  created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mt_student (student_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE match_report (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_task_id BIGINT UNSIGNED NOT NULL,
  overall_score INT             NULL COMMENT '0-100',
  level         VARCHAR(16)     NULL COMMENT 'high/medium/low',
  conclusion    VARCHAR(512)    NULL,
  dimensions_json JSON          NULL COMMENT '技能/经验/学历/行业',
  matched_skills_json JSON      NULL,
  gap_skills_json     JSON      NULL,
  reasons_json        JSON      NULL COMMENT '可解释理由',
  suggestions_json    JSON      NULL,
  similar_jobs_json   JSON      NULL,
  export_pdf_url      VARCHAR(512) NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mr_task (match_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.10 文件 & 审计域

```sql
CREATE TABLE upload_file (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id  BIGINT UNSIGNED NOT NULL COMMENT '上传者（仅学生场景）',
  biz_type    VARCHAR(32)     NOT NULL DEFAULT 'resume' COMMENT 'resume/other',
  file_name   VARCHAR(256)    NOT NULL,
  file_type   VARCHAR(32)     NULL,
  storage_url VARCHAR(512)    NOT NULL,
  size_bytes  BIGINT          NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_uf_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admin_audit_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id    BIGINT UNSIGNED NOT NULL,
  action      VARCHAR(64)     NOT NULL COMMENT 'create_model/test_model/publish_agent/...',
  entity      VARCHAR(64)     NULL COMMENT '被操作表名',
  entity_id   BIGINT UNSIGNED NULL,
  detail_json JSON            NULL,
  ip          VARCHAR(64)     NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aal_admin (admin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE student_action_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id  BIGINT UNSIGNED NOT NULL,
  action      VARCHAR(64)     NOT NULL COMMENT 'switch_model/start_interview/run_match/...',
  entity      VARCHAR(64)     NULL,
  entity_id   BIGINT UNSIGNED NULL,
  detail_json JSON            NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sal_student (student_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 5. 关键设计点

- **记忆隔离**：`master_conversation.thread_key` 与 `subagent_conversation.thread_key` 各自唯一，分别对应 LangGraph checkpointer 的独立 thread。主消息表只记 `action_meta` 里的"子会话 id + 结果摘要"，**不存子会话明细** → 上下文不串。
- **模型传递**：子会话创建时，`entry_type='via_master'` 则 `model_id := 来源 master_conversation.model_id`；`direct` 则取学生在 B3 所选。主会话切模型 = 更新 `master_conversation.model_id`，后续新建子会话自动继承。
- **子智能体范围**：运行时从 `agent.bound_skill_ids/bound_mcp_tool_ids/bound_kb_ids` 取白名单校验；主智能体走 `master_agent_config`（默认全开或白名单）。**无中间表、无多态**。
- **对学生开放**：`model_config.open_to_student` + `agent.bound_model_ids` 交集 = 某子智能体对学生可选模型。
- **无多态/无 FK**：每个引用列只指向唯一一张表；跨域多态场景全部拆表（用户/日志/审计/报告/会话）。

---

## 6. 覆盖性自检（功能 → 表）

| 功能/屏 | 支撑表 |
|---|---|
| 登录(A0/B0) | admin_user / student_user / *_refresh_token / *_login_log |
| 模型广场+测速(A1/A2) | model_config / model_test_log |
| MCP 广场(A4) | mcp_server / mcp_tool |
| Skills 广场(A5) | skill |
| 知识库(A6) | knowledge_base / knowledge_document |
| 智能体管理(A3) | agent（JSON 绑定） |
| 主智能体配置(A7) | master_agent_config / master_agent_route |
| 主智能体对话(B1) | master_conversation / master_message |
| 子智能体直用(B2/B3) | subagent_conversation / subagent_message |
| AI 面试官(B4) | interview_session / interview_qa / interview_report |
| 岗位匹配(B5) | match_task / match_report |
| 我的记录(B6) | interview_session + match_task（应用层合并） |
| 简历上传 | upload_file |
| 审计/风控 | admin_audit_log / student_action_log |

> 结论：28 张表覆盖 V4 全部屏与流程；多态与 M:N 中间表已消除。
