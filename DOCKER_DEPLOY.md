# Docker 部署说明

## 当前结构

项目内置的 `docker-compose.yml` 负责这 4 个服务：

- `frontend`
- `backend`
- `mysql`
- `redis`

Dify 建议使用官方 Docker 编排单独启动，这样更稳，也能避开你机器上已经存在的 Dify 容器。项目里已经补好了辅助脚本。

## 启动应用基础栈

在项目根目录执行：

```bash
docker compose up -d --build
```

或使用脚本：

```bash
./scripts/deploy_full_stack.sh
```

## 启动 Dify 官方栈

如果你还需要再拉起一套独立 Dify：

```bash
./scripts/deploy_dify_official.sh
```

脚本会做这些事：

- 克隆官方 `langgenius/dify`
- 切到 `1.14.2`
- 使用官方 `docker` 目录启动
- 把 Dify 端口改到 `18080/18443`，避免占用你当前机器上的 `80/443`

如果想一起启动，可执行：

```bash
DEPLOY_DIFY=1 ./scripts/deploy_full_stack.sh
```

## 访问地址

| 服务 | 地址 |
|------|------|
| 平台前端 | http://localhost:8080 |
| 平台后端 API | http://localhost:8000 |
| 后端 Swagger 文档 | http://localhost:8080/docs |
| MySQL | localhost:3306 |
| Redis | localhost:6379 |
| 独立 Dify（脚本启动时） | http://localhost:18080 |

## 默认账号

平台管理员：

- 账号：`admin`
- 密码：`123456`

## 服务说明

| 容器 | 镜像 | 说明 |
|------|------|------|
| `zhipei-frontend` | nginx | Vite 构建产物，反向代理 `/api` 到后端 |
| `zhipei-backend` | python:3.11-slim | FastAPI 登录雏形服务 |
| `zhipei-mysql` | mysql:8.4 | 平台鉴权数据库 |
| `zhipei-redis` | redis:7-alpine | 平台缓存与后续队列基础设施 |

## 数据持久化

- `mysql-data`：平台 MySQL 数据
- `redis-data`：平台 Redis 数据
- `.stack/`：Dify 官方仓库和其本地编排文件

## 常用命令

```bash
# 查看应用栈状态
docker compose ps

# 查看应用栈日志
docker compose logs -f backend
docker compose logs -f mysql
docker compose logs -f redis

# 停止应用栈
docker compose down

# 停止应用栈并带上独立 Dify
STOP_DIFY=1 ./scripts/stop_full_stack.sh

# 单独停止独立 Dify
./scripts/stop_dify_official.sh
```

## 环境配置

修改后端环境变量请编辑 [backend/.env.docker](/Users/wsr/agent/zhipei-agent-platform/backend/.env.docker)。

当前默认连接：

- MySQL：`mysql+pymysql://zhipei:zhipei123456@mysql:3306/zhipei_agent?charset=utf8mb4`
- Redis：`redis://:redis123456@redis:6379/0`

修改管理员账号、JWT 密钥或数据库连接后，重建后端即可：

```bash
docker compose up -d --build backend
```
