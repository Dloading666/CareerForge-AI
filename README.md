# 智培职联 AI 智能体平台

> CareerForge-AI — 面向高校学生的 AI 就业辅助平台，支持学生与管理员双角色独立入口。

---

## 分支规范

| 分支 | 用途 |
|------|------|
| `main` | 生产服务器，只有负责人能合并 |
| `master` | 团队开发主线，功能完成后 PR 到此 |
| `dev-xxx` | 个人开发分支，从 `master` 切出 |

**工作流**：从 `master` 切自己的分支 → 开发完成提 PR 到 `master` → 负责人审批合并 → `master` 由负责人部署到 `main`

> ⚠️ `backend/.env.docker` 已加入 `.gitignore`，不要提交真实密钥，用 `backend/.env.docker.example` 作为模板。

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **学生端** | 邮箱验证码注册 → 邮箱+密码登录 → 就业总助手首页 |
| **管理端** | 账号+密码登录 → 模型广场 / 系统管理控制台 |
| **鉴权** | JWT 双 Token（access 30 min / refresh 7 days），Redis 存储吊销名单 |
| **Docker 部署** | 一条命令启动 MySQL · Redis · FastAPI · Nginx 全栈 |

---

## 技术栈

**后端**
- Python 3.11 · FastAPI 0.115 · SQLAlchemy 2 · Alembic
- PyJWT · passlib[bcrypt] · Redis 5
- MySQL 8.4（生产）/ SQLite（本地开发）

**前端**
- React 19 · TypeScript · Vite 8
- Arco Design 2.66 · React Router 7

**基础设施**
- Docker Compose · Nginx 1.29 · MySQL 8.4 · Redis 7

---

## 项目结构

```
.
├── backend/                  # FastAPI 后端
│   ├── app/
│   │   ├── auth/             # 鉴权模块（注册/登录/Token/邮件）
│   │   ├── admin/            # 管理员路由
│   │   ├── student/          # 学生路由
│   │   ├── core/             # 配置 / 响应封装 / 安全工具
│   │   └── infra/            # 数据库 / Redis 客户端
│   ├── alembic/              # 数据库迁移
│   ├── .env.example          # 环境变量示例
│   └── requirements.txt
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── auth/             # 登录/注册页
│   │   ├── student/          # 学生首页
│   │   ├── admin/            # 管理员首页
│   │   └── shared/           # AuthProvider / API 封装 / 路由守卫
│   ├── .env.example
│   └── Dockerfile
├── docker/
│   └── mysql/init/           # MySQL 初始化 SQL
├── docker-compose.yml        # 一键部署配置
└── nginx/                    # Nginx 扩展配置
```

---

## 快速部署（Docker）

### 1. 准备环境变量

```bash
cp backend/.env.example backend/.env.docker
```

编辑 `backend/.env.docker`，至少修改以下字段：

```env
DATABASE_URL=mysql+pymysql://zhipei:你的密码@mysql:3306/zhipei_agent?charset=utf8mb4
REDIS_URL=redis://:你的密码@redis:6379/0
JWT_SECRET_KEY=修改为随机长字符串

# 管理员初始账号
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=你的管理员密码

# SMTP 邮件（用于学生邮箱验证码，可先留空）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USERNAME=你的邮箱
SMTP_PASSWORD=邮箱授权码
SMTP_FROM_EMAIL=你的邮箱
SMTP_USE_SSL=true
```

同步修改 `docker-compose.yml` 中 mysql / redis 的密码，确保与 `DATABASE_URL` / `REDIS_URL` 一致。

### 2. 一键启动

```bash
docker compose up -d --build
```

首次启动约 1-2 分钟（拉取镜像 + 构建前端）。

### 3. 访问

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:8080 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |

**默认管理员账号**：`admin` / `123456`（可在 `.env.docker` 中修改）

---

## 本地开发

### 后端

```bash
cd backend

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 复制并配置环境变量（默认使用 SQLite，无需 MySQL）
cp .env.example .env

# 运行数据库迁移
alembic upgrade head

# 启动开发服务器
uvicorn app.main:app --reload
```

后端运行在 http://localhost:8000，Swagger 文档在 http://localhost:8000/docs

### 前端

```bash
cd frontend

# 安装依赖
npm install

# 复制环境变量（本地通过 Vite proxy 转发 /api 到 :8000）
cp .env.example .env

# 启动开发服务器
npm run dev
```

前端运行在 http://localhost:5173

---

## 主要 API 端点

```
POST /api/v1/auth/student/email/send-code   # 发送邮箱验证码
POST /api/v1/auth/student/register          # 学生注册
POST /api/v1/auth/student/login             # 学生登录
POST /api/v1/auth/admin/login               # 管理员登录
GET  /api/v1/auth/me                        # 获取当前用户信息
POST /api/v1/auth/refresh                   # 刷新 access token
POST /api/v1/auth/logout                    # 退出登录（吊销 refresh token）

GET  /healthz                               # 健康检查
```

---

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `sqlite:///./zhipei_auth.db` | 数据库连接串 |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接串 |
| `JWT_SECRET_KEY` | `change-me-in-production` | JWT 签名密钥，生产必须修改 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | access token 有效期（分钟） |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | refresh token 有效期（天） |
| `ADMIN_BOOTSTRAP_USERNAME` | `admin` | 管理员用户名 |
| `ADMIN_BOOTSTRAP_PASSWORD` | `123456` | 管理员密码 |
| `SMTP_HOST` | — | SMTP 服务器（留空则跳过邮件发送） |
| `SMTP_USE_SSL` | `false` | 是否使用 SSL（QQ 邮箱等需设为 true） |

---

## 角色与权限

```
student   — 学生，通过邮箱验证码注册，访问学生端首页
admin     — 管理员，通过 .env 初始化，访问管理控制台
```

两个角色共享同一登录页（Tab 切换），登录后根据 `role` 字段自动跳转至对应界面。未登录访问受保护路由时自动重定向到登录页。

---

## 开发路线图

- [x] Phase 1 — 双角色鉴权 · JWT Token · 登录/注册页 · 学生/管理首页框架
- [ ] Phase 2 — Dify 智能体接入 · 对话界面
- [ ] Phase 3 — 简历解析 · 岗位匹配 · 面试模拟
- [ ] Phase 4 — 数据统计 · 管理后台完整功能

---

## License

MIT
