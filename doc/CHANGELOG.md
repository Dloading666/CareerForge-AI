## 2026-06-22 — 思考程度系统升级 + 品牌重命名

### 🔵 思考程度系统：从「软引导」到「真控制」

- 新增 `auto` 默认模式：`auto_classify_effort()` 根据消息内容自动判断难度（问候→low、简历操作→medium、JD分析→high、全面重写→xhigh）
- 六档可选：auto / low / medium / high / xhigh / max
- `get_model_effort_config()` 替代旧的 `_supports_reasoning_effort()`，按模型类型返回差异化配置：
  - Anthropic Claude：`thinking.budgetTokens`（4K~31K），temperature 强制 1.0
  - Google Gemini：`thinkingConfig.thinkingBudget`（4K~32K），temperature 强制 1.0
  - DeepSeek：不发送 reasoning_effort（推理始终开启）
  - OpenAI o1/o3/o4/gpt-5：原生 `reasoning_effort` API 参数
- `get_model_default_temperature()` 按模型 ID 设置默认温度（Qwen=0.55, Gemini=1.0, GLM=1.0 等）
- 模型列表 API 新增 `supported_efforts` 字段，前端据此动态过滤可选档位
- 切换模型时自动调整 effort 到新模型支持的档位

### 🟢 品牌重命名：智培职联 → CareerForge

- 全系统 16 处「智培职联」统一替换为「CareerForge」
- 涉及：config、system prompt、邮件标题、前端关于页、所有文档

## 2026-06-15 — 后端安全加固 + 性能优化 + 前后端改造

### 🔴 P0：AI 提供商 API Key 真加密（Fernet）

- 现状：`model_config.api_key_cipher` 和 `agent.dify_api_key_cipher` 都是 base64 假加密，数据库 dump 后明文可读。
- 改动：
  - 新增 `cryptography>=43.0.0` 依赖
  - 新增 `API_KEY_ENCRYPTION_KEY` 必填环境变量（Fernet 32-byte url-safe），启动时缺失直接 fail-at-startup
  - 核心函数 `encrypt_api_key / decrypt_api_key` 从 `admin/model_service.py` 迁到 `core/security.py`，实现改为 Fernet（AES-128-CBC + HMAC-SHA256）
  - `model_service.py` 改为 `from app.core.security import ...`（re-export，`agent_service.py` 不破）
  - 一次性迁移脚本 `scripts/reencrypt_api_keys.py`：同时覆盖 `model_config` + `agent` 两张表，干跑默认 dry-run，`--apply` 才提交

### 🟠 P1：后端性能 + 可观测性

- `test_batch` 改为 `asyncio.gather`，6 个模型的连接测试从最坏 3 分钟压到 30 秒；每个分支拿独立 `SessionLocal`（避免共享 session 并发 commit 冲突）
- `/healthz` 新增 MySQL ping（`SELECT 1`），任一依赖不通返回 503 + `status: degraded`
- 新增 alembic migration `20260615_0001_add_business_indexes.py`：6 个业务索引（agent / model_config / user_feedback ×2 / student_event / student_resume），对 `user_feedback` 表不存在场景防御性跳过，merge 依赖两个现 head

### 🟡 P2：运维加固 + 前端体验

- 全局 IP 限流中间件 `app/infra/rate_limit.py`：Redis 固定窗口计数，200 rps/IP/60s 默认，Redis 挂掉 fail-open 不阻塞业务，`/healthz` `/docs` `/openapi.json` `/redoc` `/data/` `/static/` `/uploads/` 豁免
- `attachment_router.upload_resume` 去 async 包装，`await file.read()` → `file.file.read()`（同步 SpooledTemporaryFile）；以前是 async def 包同步 IO，会饿死 event loop
- Docker：worker 补 healthcheck（查 `rq:workers:*` 中有 idle/busy worker）；5 个服务全部加 `logging: json-file max-size:10m max-file:5`
- Nginx：`/assets/*` 加 `Cache-Control: public, max-age=31536000, immutable`（Vite 哈希资源永不过期）；`/index.html` 反过来加 `no-cache, no-store, must-revalidate`（必须重新验证拿到新 hash 资源）
- 前端：
  - 新增 `useDebouncedValue` hook（300ms 延迟）
  - `AgentManagementPage` 接入 debounce + AbortController；原先的 `alive` flag 模式完全清除，连续输入会中止上一轮 in-flight 请求

### 🟢 P3：重构 + 前端动态错误防护

- 新增 `app/student/event_models.py` ORM 模型 `StudentEvent`
- `event_router.py` 6 处 raw SQL + f-string 拼列名全部改为 SQLAlchemy 2.0 ORM（`select` / `db.add` / `update` / `delete`），`text` 导入删除，跨 student 隔离由 WHERE 子句编码
- 新增 `ErrorBoundary` 组件包在 `<StrictMode>` 与 `<BrowserRouter>` 之间；任何子树抛错都会呈现中文错误面 + 两个按钮（刷新 / 恢复），不再是一片空白

### 迁移手手

生产环境升级前（依赖顺序不可反）：

1. 后端 - 拾起新增 env：复制 `.env.example` 的 `API_KEY_ENCRYPTION_KEY` + `API_RATE_LIMIT_RPS` + `API_RATE_LIMIT_WINDOW_SECONDS` 到 `.env.docker` / `.env`
2. 运行迁移脚本：`python scripts/reencrypt_api_keys.py`（dry-run） → 确认 → `python scripts/reencrypt_api_keys.py --apply`
3. 升级索引：`cd backend && alembic upgrade 20260615_0001`（不要用 `head`，仓库历史有重名的 `20260612_0024`，`alembic upgrade head` 会报 Multiple heads）
4. `docker compose up -d --build`，`docker ps` 应看到五个容器都 `(healthy)`

---
