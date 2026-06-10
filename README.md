# CareerForge-AI · 智培职联

> 面向高校学生的 AI 就业辅助平台。学生端内置 **AI简历助手** 与 **AI面试官** 两个对话智能体，管理端负责配置模型、Skill 与系统参数。

---

## 功能概览

### 学生端
| 模块 | 说明 |
|------|------|
| **AI简历助手** | 基于 Agentic Loop 的对话式简历工作台，支持 AI 订制简历、简历优化（上传 PDF + JD）、在线编辑与 PDF 导出 |
| **AI面试官** | 一对一模拟面试智能体，读取个人档案定制问题，逐轮提问 + 专业点评 |
| **简历制作** | 在线简历编辑器，多模板切换、实时预览、数据持久化 |
| **个人中心** | 个人信息、求职意向、头像、密码管理 |
| **对话历史** | 两类智能体的历史会话分组展示，可拖拽调整侧边栏宽度 |

### 管理端
| 模块 | 说明 |
|------|------|
| **模型广场** | 接入任意 OpenAI 兼容模型，配置能力标签、学生可见性、API Key |
| **主智能体配置** | System Prompt、推理轮次、Temperature 等运行参数 |
| **Skill 广场** | 管理可供主智能体调用的工具函数 |
| **系统设置** | 公告、邮件 SMTP 等全局配置 |

---

## 技术栈

| 层 | 技术 |
|----|------|
| **后端** | Python 3.11 · FastAPI · SQLAlchemy 2 · Alembic · PyJWT · bcrypt |
| **AI 运行时** | 自研 Agentic Loop（OpenAI function-calling · SSE 流式输出） |
| **数据库** | MySQL 8.4（生产）/ SQLite（本地开发） |
| **缓存** | Redis 7（Token 吊销名单 · 验证码 · 登录限流） |
| **前端** | React 19 · TypeScript · Vite · Arco Design · React Router 7 |
| **部署** | Docker Compose · Nginx |

---

## 项目结构

```
.
├── backend/
│   ├── app/
│   │   ├── auth/          # 注册 / 登录 / JWT / 邮件验证码
│   │   ├── admin/         # 管理端 API（模型、智能体、Skill、主智能体配置）
│   │   ├── student/       # 学生端 API
│   │   │   ├── agent_runtime.py   # Agentic Loop 核心（Model + Harness）
│   │   │   ├── router.py          # 会话 / 消息 / 流式 SSE
│   │   │   └── attachment_router.py
│   │   ├── skills/        # Skill 广场 CRUD
│   │   ├── core/          # 配置 / 响应信封 / LLM 客户端
│   │   └── infra/         # DB / Redis
│   ├── alembic/           # 数据库迁移
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── student/       # 学生端（AgentChatView · ResumeCenterPage · ProfilePage）
│       ├── admin/         # 管理端
│       ├── resume/        # 简历编辑器
│       └── shared/        # AuthProvider · API 封装 · 路由守卫
├── docker-compose.yml
└── nginx/
```

---

## 快速部署（Docker）

### 1. 配置环境变量

```bash
cp backend/.env.example backend/.env.docker
```

至少修改以下字段：

```env
DATABASE_URL=mysql+pymysql://zhipei:你的密码@mysql:3306/zhipei_agent?charset=utf8mb4
REDIS_URL=redis://:你的密码@redis:6379/0
JWT_SECRET_KEY=替换为随机长字符串

# 管理员初始账号（首次启动自动创建）
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=你的管理员密码

# SMTP 邮件（学生注册验证码，可先留空）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USERNAME=你的邮箱
SMTP_PASSWORD=邮箱授权码
SMTP_FROM_EMAIL=你的邮箱
SMTP_USE_SSL=true
```

同步修改 `docker-compose.yml` 中 mysql / redis 的密码，确保与上述连接串一致。

### 2. 启动

```bash
docker compose up -d --build
```

首次约 1–2 分钟（拉取镜像 + 编译前端）。

### 3. 访问

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:8080 |
| 后端 API | http://localhost:8000 |
| Swagger 文档 | http://localhost:8000/docs |

默认管理员：`admin` / `123456`（可在 `.env.docker` 修改）

登录管理端后，在**模型广场**添加并开启一个对学生可见的模型，学生端即可开始对话。

---

## 本地开发

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # 默认使用 SQLite，无需 MySQL
alembic upgrade head
uvicorn app.main:app --reload    # http://localhost:8000
```

### 前端

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173，/api 自动代理到 :8000
```

构建与类型检查：

```bash
npm run build   # tsc + vite build
npm run lint    # eslint
```

---

## Agentic Loop 简介

学生端对话由 `student/agent_runtime.py` 驱动，核心是一个自研的 **Model + Harness** 循环：

1. **模型**（OpenAI function-calling）自主决定调用哪些工具
2. **Harness** 负责执行、校验、审计，并把结果回灌，直到模型给出最终答复或达到 `max_iterations`
3. 两类智能体工具池不同：AI简历助手拥有完整工具集（含简历生成/导出），AI面试官只读取学生信息，不操作简历

SSE 事件流：`message.saved` → `activity.started/completed/failed` → `message.delta` → `message.completed` → `done`

---

## 分支规范

| 分支 | 用途 |
|------|------|
| `main` | 生产，仅负责人合并 |
| `master` | 开发主线，功能完成后 PR 到此 |
| `dev-xxx` | 个人分支，从 `master` 切出 |

> `backend/.env.docker` 已加入 `.gitignore`，禁止提交真实密钥。

---

## License

MIT
