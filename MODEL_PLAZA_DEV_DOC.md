# 模型广场 CRUD + 系统设置 — 开发文档

> 分支：`dev-lsm` | 日期：2026-06-04 | 基座：master `6fa0431`

---

## 1. 概述

为「智培职联」管理后台新增两大功能模块：

- **模型广场**：管理员接入、管理、测试 AI 模型，控制对学生的开放状态，完整 CRUD
- **系统设置**：平台名称、公告、维护模式等全局配置

前后端全栈实现：FastAPI + SQLAlchemy + MySQL + Arco Design + React + TypeScript。

---

## 2. 数据库

### 2.1 新增表

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| model_config | 模型配置存储 | display_name, provider, deploy_type, capability, protocols, base_url, api_key_cipher, model_identifier, dify_model_ref, context_length, default_temp, max_output, timeout_sec, open_to_student, status, is_deleted |
| model_test_log | 连接测试日志 | model_id, success, latency_ms, error_message, tested_at |
| system_config | 系统配置键值存储 | config_key, config_value, description |

### 2.2 设计要点

- 零 FK 约束（符合 MySQL 设计文档要求）
- is_deleted 软删除，不物理删除数据
- api_key_cipher 最大 1024 字符，预留加密空间
- system_config 不含默认值，首次读取由 Service 层返回硬编码默认值

### 2.3 迁移文件

| 文件 | 内容 |
|------|------|
| 20260604_0002_model_plaza.py | 创建 model_config + model_test_log |
| 20260604_0003_system_config.py | 创建 system_config |
---

## 3. 后端

### 3.1 文件结构

```
backend/app/admin/
├── __init__.py
├── models.py          # SQLAlchemy 模型
├── schemas.py         # Pydantic 校验
├── model_service.py   # 业务逻辑
└── router.py          # API 路由（10 个端点）
```

### 3.2 API 端点

#### 模型广场（8 个）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/v1/admin/models | 分页列表，支持过滤 |
| POST | /api/v1/admin/models | 创建模型 |
| GET | /api/v1/admin/models/{id} | 模型详情 |
| PUT | /api/v1/admin/models/{id} | 编辑模型 |
| DELETE | /api/v1/admin/models/{id} | 软删除 |
| POST | /api/v1/admin/models/{id}/test | 单模型连接测试 |
| POST | /api/v1/admin/models/test-batch | 批量测速 |
| PATCH | /api/v1/admin/models/{id}/open | 切换对学生开放 |

#### 系统设置（2 个）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/v1/admin/system/config | 读取全部配置 |
| PUT | /api/v1/admin/system/config | 批量更新配置 |

全部端点受 require_role("admin") 保护。

### 3.3 系统配置默认键值

| config_key | 默认值 | 说明 |
|------------|--------|------|
| platform_name | 智培职联 | 平台名称 |
| announcement | (空) | 公告内容 |
| announcement_enabled | false | 公告开关 |
| maintenance_mode | false | 维护模式 |
| maintenance_message | 系统维护中，请稍后再试 | 维护提示语 |

### 3.4 model_service.py 核心函数

| 函数 | 功能 |
|------|------|
| list_models | 多条件过滤 + 分页 |
| create_model | 创建，API Key 可选 |
| get_model_detail | 单条查询 |
| update_model | 部分更新 |
| delete_model | 软删除（is_deleted=True） |
| test_model_connection | httpx 探测 base_url，记录延迟 |
| test_batch | 批量测所有 active 模型 |
| toggle_open | 切换 open_to_student |
| get_all_config | 读取+默认值合并 |
| update_config | 逐条 upsert |
---

## 4. 前端

### 4.1 文件结构

```
frontend/src/admin/
├── AdminHomePage.tsx    # 管理主页（已修改）
├── ModelPlaza.tsx       # 模型广场组件（新增）
└── SystemSettings.tsx   # 系统设置组件（新增）

frontend/src/shared/
└── api.ts               # 请求封装（已增强）
```

### 4.2 AdminHomePage.tsx 改动

- 新增 `import { ModelPlaza } from './ModelPlaza'`
- 新增 `import { SystemSettings } from './SystemSettings'`
- 模型广场：`{activeNav === 'models' ? <ModelPlaza /> : null}`
- 系统设置：`<SystemSettings />` 嵌入 renderSettingsPage
- 移除废弃的 renderModelsPage 函数（~42 行）

### 4.3 ModelPlaza.tsx 功能

- 从 GET /api/v1/admin/models 加载真实数据
- 卡片展示：部署位置标签（颜色语义化）、模型名称、标识、供应商、协议标签、延迟、学生开放开关
- 添加/编辑抽屉：Arco Drawer 表单，字段对齐 ModelCreate
- 测试连接：卡片内按钮，显示延迟和状态
- 批量测速：顶部按钮，一次性测试所有模型
- 删除：Popconfirm 确认 + 软删除
- 使用 Alert 组件显示操作结果（回避 Arco Message 在 React 19 的兼容性问题）

### 4.4 SystemSettings.tsx 功能

- 调 GET/PUT /api/v1/admin/system/config
- 表单字段：平台名称、公告内容（含启用开关）、维护模式（含提示语）
- 维护模式开启时动态展示提示语输入框

### 4.5 api.ts 增强

- JWT Token 自动从 localStorage 附加到 Authorization 头
- FIELD_LABELS 映射：所有表单字段 -> 中文名
- ERROR_TYPES 映射：Pydantic 校验错误 -> 中文描述
- extractErrorMessage：422 响应拆解为字段级中文提示
---

## 5. Docker 部署

### 5.1 服务拓扑

| 容器 | 镜像 | 端口 |
|------|------|------|
| zhipei-mysql | mysql:8.4 | 3307 -> 3306 |
| zhipei-redis | redis:7-alpine | 6380 -> 6379 |
| zhipei-backend | Python 3.11 + uvicorn | 8000 |
| zhipei-frontend | nginx:1.29-alpine | 8080 -> 80 |

### 5.2 启动命令

```bash
docker compose up -d --build
```

### 5.3 已知问题修复

| 问题 | 原因 | 修复 |
|------|------|------|
| 模型列表 500 | model_config 表缺 dify_model_ref 列 | ALTER TABLE 添加列 |
| 迁移重复执行报错 | alembic_version 表为空 | alembic stamp head |

---

## 6. 技术约束

| 项 | 说明 |
|----|------|
| 数据库 | MySQL 8.4，零 FK 约束 |
| 软删除 | is_deleted 字段，查询默认过滤 |
| API Key 存储 | 当前明文，后续升级 AES |
| 连接测试 | httpx 发探活请求 |
| React | React 19，element.ref 警告可忽略 |
| Arco Message | 改用 Alert |
| 分页 | 管理端默认 size=100 |

---

## 7. 变更文件清单

### 新增（7 个）

- backend/app/admin/models.py
- backend/app/admin/model_service.py
- backend/app/admin/schemas.py
- backend/alembic/versions/20260604_0002_model_plaza.py
- backend/alembic/versions/20260604_0003_system_config.py
- frontend/src/admin/ModelPlaza.tsx
- frontend/src/admin/SystemSettings.tsx

### 修改（6 个）

- backend/app/admin/router.py — 新增 10 个端点
- backend/app/main.py — 导入 admin models
- backend/alembic/env.py — 导入 admin models
- frontend/src/admin/AdminHomePage.tsx — 接入 ModelPlaza + SystemSettings
- frontend/src/shared/api.ts — 422 字段级中文提示
- docker-compose.yml — 端口调整