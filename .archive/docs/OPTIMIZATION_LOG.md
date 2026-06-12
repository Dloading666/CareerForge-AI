# 模型广场 & 系统设置 — 优化记录

> 分支：`master` | 日期：2026-06-05

---

## 1. 模型广场优化

### 1.1 能力类型精简

- 原 4 种（对话/嵌入/视觉/重排）→ **2 种（多模态/纯文本）**
- 卡片顶部部署位置旁标注能力类型标签（颜色语义化）
- 后端 `capability` 默认值 `chat` → `text`

### 1.2 表单优化

- 「模型标识」→「模型名称」
- 移除「上下文长度」字段
- `openAdd` + `openEdit` 统一为 `openForm(model?)`，编辑逻辑为主

---

## 2. 系统设置优化

### 2.1 布局重新设计

- 卡片式布局：`<Card>` 替代 `<section>`
- 主次分明：系统配置（左，宽 1fr）→ 账号信息（右，窄 320px）
- 移除无功能的假开关（操作审计、异常通知）

### 2.2 导航快捷入口

- 右上角齿轮图标 → 点击跳转系统设置页

---

## 3. 头像功能

### 3.1 后端

| 变量 | 文件 | 说明 |
|------|------|------|
| AdminUser 模型 | `backend/app/auth/models.py` | 新增 `avatar_url` 字段 |
| 上传接口 | `backend/app/auth/router.py` | `POST /api/v1/auth/avatar` |
| 个人资料 | `backend/app/auth/router.py` | `GET /me` / `PATCH /me` 返回 avatar_url |
| build_profile | `backend/app/auth/service.py` | 登录响应含 avatar_url |
| 静态文件 | `backend/app/main.py` | `/data/avatars/` 目录挂载 |
| 依赖 | `backend/requirements.txt` | python-multipart |

### 3.2 前端

| 变量 | 文件 | 说明 |
|------|------|------|
| 顶部头像 | `AdminHomePage.tsx` | `<Popover>` 点击显示账号 + 退出 |
| 设置页上传 | `AdminHomePage.tsx` | 账号卡片内 `+` 号上传按钮 |
| localStorage | `AdminHomePage.tsx` | 上传后同步写入 session |
| nginx 代理 | `frontend/nginx/default.conf` | `/data/` → backend 转发 |
| FormData 支持 | `frontend/src/shared/api.ts` | 跳过 Content-Type 设置 |

### 3.3 数据库

- `admin_user` 表新增 `avatar_url VARCHAR(512) NULL` 列

---

## 4. 文件变更

### 修改

| 文件 | 变更 |
|------|------|
| `frontend/src/admin/AdminHomePage.tsx` | 头像 Popover、设置页布局、头像上传、齿轮导航 |
| `frontend/src/admin/ModelPlaza.tsx` | 能力类型标签、表单统一、字段调整 |
| `frontend/src/admin/SystemSettings.tsx` | Card 组件包装、图标标题 |
| `frontend/src/shared/api.ts` | FormData 检测 |
| `frontend/nginx/default.conf` | `/data/` 代理 |
| `frontend/src/index.css` | settings-grid 列宽 |
| `backend/app/auth/models.py` | AdminUser.avatar_url |
| `backend/app/auth/router.py` | 上传/资料更新端点、avatar_url 返回 |
| `backend/app/auth/service.py` | build_profile 含 avatar_url |
| `backend/app/admin/models.py` | capability 默认值 |
| `backend/app/main.py` | StaticFiles 挂载 + os 导入 |
| `backend/requirements.txt` | python-multipart |

---

## 5. 已知问题 & 修复

| 问题 | 原因 | 修复 |
|------|------|------|
| 头像上传不显示 | nginx 未代理 /data/ | 添加 location /data/ |
| 退出后头像丢失 | AdminUser 模型缺 avatar_url | 添加字段 + DB ALTER TABLE |
| 后端启动报错 | python-multipart 缺失 | 添加依赖 |