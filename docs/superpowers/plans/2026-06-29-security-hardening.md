# 安全与体验加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 GPT5.5 代码审查中**经核实成立、且在单租户下仍有实际风险**的安全与体验缺陷。

**Architecture:** 本平台长期单租户(单一学校)部署,因此 GPT5.5 提的"跨学校数据隔离"类问题(模型配置/反馈表/润色选模型的 tenant_id 过滤)**不在本计划范围**——单租户下 tenant_id 恒为 0,无跨校数据可泄漏,加过滤属过度设计。本计划聚焦三类真实风险:① 运维故障(entrypoint 假成功)、② 认证安全(登录防爆破绕过、job 越权下载)、③ 前端体验(简历切换不回滚、删对话不停 AI、排队丢失、会话切换竞态)。

**Tech Stack:** FastAPI + SQLAlchemy(后端)、React 19 + Zustand(前端 chatRuntimeStore)、Alembic(迁移)、RQ(后台任务)。

---

## 已核实结论(本计划的事实依据)

| # | 断言 | 核实结论 | 本计划处理 |
|---|------|---------|-----------|
| 1 | 管理员跨校看/改模型配置 | 代码缺陷存在,但单租户下 tenant_id 恒 0,无泄漏 | **不修复(单租户)①** |
| 2 | 反馈跨管理员混杂 | 同上 | **不修复(单租户)①** |
| 3 | 润色误用他校模型 | 同上 | **不修复(单租户)①** |
| 4 | job_id 下载他人简历 | ⚠️ 部分成立 — UUID 不可枚举,但泄露后可越权 | **修复(任务5)** |
| 5 | 停用账号仍能登录 | 代码缺陷存在,但当前无停用入口 | **不修复(无入口)②** |
| 6 | 登录防爆破可绕过 | ✅ 成立 — IP 取自可伪造的 X-Forwarded-For | **修复(任务4)** |
| 7 | DB 升级失败伪装成功 | ✅ 成立 — `entrypoint.sh:51` stamp 后继续启动 | **修复(任务3)** |
| 8 | 简历切换失败仍显示已切换 | ✅ 成立 — `AgentChatView.tsx:1459` 失败不回滚 | **修复(任务6)** |
| 9 | 面试重复提交跳两轮 | ❌ 不成立 — 有 request_id 幂等 + 409 兜底 | **不修复(核实不成立)** |
| 10 | 删对话不停后台任务 | ⚠️ 部分成立 — 前端停了 SSE,后端 run 继续 | **修复(任务7+8)** |
| 11 | 排队内容切对话丢失 | ✅ 成立 — `setQueue([])` 无条件清空 | **修复(任务9)** |
| 12 | 快速切对话发错会话 | ⚠️ 部分成立 — 串屏不成立,createAgentSession 异步竞态成立 | **修复(任务10)** |
| 13 | 断线恢复一直转圈 | ⚠️ 部分成立 — 有 5 次上限,非致命 | **不修复(非致命)③** |

**三条"不修复"的理由:**
- ① 单租户下 tenant_id 恒为 0,无跨校数据可泄漏,加过滤属过度设计(YAGNI)。
- ② 全仓库无任何代码将 `AdminUser.status`/`StudentUser.status` 设为 disabled/inactive,无"停用账号"业务入口,触发不了。
- ③ SSE 重连有 5 次上限 + disconnected 兜底 + finally 清理,不会"一直转圈",非致命。

---

## File Structure(改动地图)

### 后端
| 文件 | 责任 | 改动 |
|------|------|------|
| `backend/entrypoint.sh` | 容器启动 | 迁移失败拒绝启动(任务3) |
| `backend/app/jobs.py` | job 状态查询 | 返回归属信息供校验(任务5) |
| `backend/app/jobs_router.py` | 下载端点 | 校验 job 归属(任务5) |
| `backend/app/auth/router.py` | 登录路由 | IP 来源可信化(任务4) |
| `backend/app/infra/rate_limit.py` | 限流 IP | 同上(任务4) |
| `backend/app/core/config.py` | 配置 | 新增 TRUSTED_PROXY_COUNT(任务4) |
| `backend/.env.example` | 配置样例 | 同上(任务4) |
| `backend/app/student/router.py` | DELETE session | 联动取消 active run(任务8) |
| `backend/app/student/run_manager.py` | run 管理 | 加 list_active_runs 方法(任务8) |

### 前端
| 文件 | 责任 | 改动 |
|------|------|------|
| `frontend/src/student/AgentChatView.tsx` | 简历切换/排队/发送 | 切换回滚(任务6)、队列保留(任务9)、竞态保护(任务10) |
| `frontend/src/student/chatRuntimeStore.ts` | SSE 运行时 | 加 deleteSession 取消后端 run(任务7) |
| `frontend/src/student/StudentHomePage.tsx` | 删除会话 | 用 deleteSession(任务7) |

---

## 设计约定(所有任务遵守)

### require_role 返回值解构
`current=Depends(require_role("student"|"admin"))` 返回 `(identity, user)` 元组(`service.py:703-708`)。
取当前用户:`identity, _ = current`;用户 id:`identity.user_id`。

### 前端验证标准(AGENTS.md)
前端改动后必须:`cd frontend && npm run build && npm run lint` 全绿。
`npm run build` = `tsc -b && vite build`,是唯一的类型检查入口。

### 后端验证标准(AGENTS.md)
后端改动后必须:`cd backend && python -m pytest tests/ -v` 全绿。

---

## 阶段一:运维与认证安全(独立任务,可任意顺序)

### Task 3: 修复 entrypoint 假成功

**Files:**
- Modify: `backend/entrypoint.sh:39-53`

**问题:** 当 `alembic upgrade head` 和 `upgrade heads` 都失败后,脚本执行 `alembic stamp heads`(line 51)——这只在数据库盖章"已升级",**不实际执行迁移**,然后继续启动 uvicorn。后果是服务带着缺表/缺字段的数据库运行,业务各种报错且根因难查。

- [ ] **Step 1: 改 entrypoint,迁移失败必须退出**

`backend/entrypoint.sh`,把 line 36-53 的迁移逻辑改为:
```sh
echo "Running database migrations..."
set +e
alembic upgrade head
alembic_rc=$?
set -e
if [ $alembic_rc -ne 0 ]; then
  echo "alembic upgrade head failed (rc=$alembic_rc); retrying with plural heads" >&2
  set +e
  alembic upgrade heads
  alembic_rc=$?
  set -e
  if [ $alembic_rc -ne 0 ]; then
    echo "alembic upgrade heads also failed (rc=$alembic_rc)" >&2
    echo "数据库迁移失败,拒绝启动以避免缺表/缺字段故障。请检查迁移脚本。" >&2
    exit 1
  fi
fi
```
(删除原来的 `alembic stamp heads` 兜底分支——迁移失败必须让容器起不来)

- [ ] **Step 2: 手动验证 — 模拟迁移失败**

Run: `cd backend && DATABASE_URL="sqlite:///nonexistent/path/db.sqlite" sh entrypoint.sh`
Expected: 脚本因迁移失败 `exit 1`,不会启动 uvicorn。

- [ ] **Step 3: 提交**

```bash
git add backend/entrypoint.sh
git commit -m "fix: 数据库迁移失败时拒绝启动,杜绝假成功导致的长期缺表"
```

---

### Task 4: 登录防爆破 IP 来源可信化

**Files:**
- Modify: `backend/app/auth/router.py` (IP 提取)
- Modify: `backend/app/infra/rate_limit.py:39-44`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`

**问题:** `auth/router.py:49` 用 `x_forwarded_for: Optional[str] = Header(default=None)` 直接取 IP,客户端可任意伪造 `X-Forwarded-For` 头。`rate_limit.py:41` 同样逻辑。限流按 `(账号, 伪造IP)` 计数,攻击者每次换假 IP 即可绕过次数限制。

- [ ] **Step 1: 新增可信 IP 提取工具函数**

创建 `backend/app/infra/client_ip.py`:
```python
"""可信客户端 IP 提取。

直接信任 X-Forwarded-For 可被伪造,绕过按 IP 的限流。
默认只信任 socket 真实对端;仅当配置了前置可信代理跳数
(TRUSTED_PROXY_COUNT)时,才从 XFF 提取真实客户端。
"""
from __future__ import annotations
from typing import Optional
from fastapi import Request, Header
from app.core.config import get_settings


def trusted_client_ip(
    request: Request,
    x_forwarded_for: Optional[str] = Header(default=None, alias="X-Forwarded-For"),
) -> Optional[str]:
    """返回用于限流的客户端 IP。

    - 无 XFF:返回 socket 对端 IP(最可信)。
    - 有 XFF 但 TRUSTED_PROXY_COUNT=0:忽略 XFF,返回 socket 对端(默认,安全)。
    - 有 XFF 且 TRUSTED_PROXY_COUNT=N>0:取 XFF 倒数第 N 段(跳过 N 跳可信代理后的真实客户端)。
    """
    settings = get_settings()
    socket_ip = request.client.host if request.client else None
    xff = (x_forwarded_for or "").strip()
    if not xff:
        return socket_ip
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    n = max(0, getattr(settings, "trusted_proxy_count", 0))
    if n == 0:
        return socket_ip  # 不信任任何 XFF
    # 从右往左数 N 跳可信代理,其左边一位是真实客户端
    idx = len(parts) - n - 1
    return parts[idx] if idx >= 0 else socket_ip
```

- [ ] **Step 2: config.py 加配置项**

`backend/app/core/config.py` 的 Settings 类加:
```python
trusted_proxy_count: int = Field(
    0, alias="TRUSTED_PROXY_COUNT",
    description="前置可信代理跳数;用于从 X-Forwarded-For 提取真实客户端 IP。0=不信任 XFF,默认最安全",
)
```

- [ ] **Step 3: .env.example 加配置项**

`backend/.env.example` 在合适位置加:
```env
# 前置可信代理跳数(用于登录限流提取真实客户端 IP)
# 直连部署=0;经一层 Nginx 反代=1;Nginx+LB 两层=2。默认 0(最安全,不信任 X-Forwarded-For)
TRUSTED_PROXY_COUNT=0
```

- [ ] **Step 4: auth/router.py 各端点改用可信 IP**

`backend/app/auth/router.py`,所有用 `x_forwarded_for` 的端点(send-code / login / register / reset / login-student / login-admin),签名加 `request: Request`,并替换 IP 提取。

把原来的:
```python
x_forwarded_for: Optional[str] = Header(default=None),
...
data = login_xxx(db, payload, ip=x_forwarded_for, ...)
```
改为:
```python
from app.infra.client_ip import trusted_client_ip
from fastapi import Request
...
request: Request,
...
ip = trusted_client_ip(request, request.headers.get("X-Forwarded-For"))
data = login_xxx(db, payload, ip=ip, ...)
```
(共约 6 个端点:`student_send_code`、`unified_login`、`student_register`、`student_reset_password`、`student_login`、`admin_login`)

- [ ] **Step 5: rate_limit.py 同步用同一逻辑**

`backend/app/infra/rate_limit.py:39-44`,把 `_client_ip` 函数改为调用 `trusted_client_ip`:
```python
from app.infra.client_ip import trusted_client_ip

def _client_ip(request: Request) -> str:
    ip = trusted_client_ip(request, request.headers.get("X-Forwarded-For"))
    return ip or "unknown"
```

- [ ] **Step 6: 运行后端测试**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: 全部 PASS(原有测试不应被影响——TRUSTED_PROXY_COUNT 默认 0 时行为退化为用 socket IP,测试环境一般无 XFF)

- [ ] **Step 7: 手动验证**

启动 uvicorn,用 curl 伪造 XFF 测试登录:
```bash
# 伪造不同 XFF 连续登录失败多次,确认仍被限流(因为 TRUSTED_PROXY_COUNT=0 时 XFF 被忽略)
curl -X POST http://localhost:8000/api/v1/auth/student/login \
  -H "X-Forwarded-For: 1.1.1.1" -H "Content-Type: application/json" \
  -d '{"email":"x@x.com","password":"wrong"}'
```
Expected: 多次失败后返回 429(限流生效,伪造 IP 未生效)。

- [ ] **Step 8: 提交**

```bash
git add backend/app/infra/client_ip.py backend/app/auth/router.py backend/app/infra/rate_limit.py backend/app/core/config.py backend/.env.example
git commit -m "fix: 登录限流 IP 来源可信化,防伪造 X-Forwarded-For 绕过防爆破"
```

---

### Task 5: job 下载越权校验

**Files:**
- Modify: `backend/app/jobs.py` (get_job_status / get_job_result_path)
- Modify: `backend/app/jobs_router.py:53,61`

**问题:** `jobs_router.py:61` 的下载端点只凭 `job_id` 查 RQ,**不校验这个 job 是否属于当前学生**。job_id 虽是随机 UUID 不可枚举,但一旦泄露(日志/URL 历史/分享)即可越权下载他人简历 PDF。

- [ ] **Step 1: 让 job 查询支持归属校验**

`backend/app/jobs.py` 的 `get_job_result_path`(line 134)加归属校验。`generate_resume_pdf_job`(line 58)的参数顺序是 `(resume_id, user_id, tenant_id)`,可从 job.args 取出 user_id 比对:
```python
def get_job_result_path(job_id: str, *, expected_user_id: int | None = None) -> Optional[Path]:
    """Return the on-disk result path for a finished job, or None if missing.

    若传入 expected_user_id,会校验 job 归属:不属于该用户的 job 一律当作不存在(返回 None),
    避免越权下载他人简历。
    """
    try:
        job = Job.fetch(job_id, connection=get_redis())
    except NoSuchJob:
        return None
    if expected_user_id is not None:
        args = job.args or ()
        job_user_id = args[1] if len(args) >= 2 else None  # 参数顺序:resume_id, user_id, tenant_id
        if job_user_id is not None and job_user_id != expected_user_id:
            return None  # 不属于该用户,当作不存在
    if job.get_status() != JobStatus.FINISHED:
        return None
    result = job.result
    if not result:
        return None
    p = Path(result)
    return p if p.exists() else None
```

`get_job_status`(line 112)同样加 `expected_user_id` 参数,不匹配时返回 None:
```python
def get_job_status(job_id: str, *, expected_user_id: int | None = None) -> Optional[dict[str, Any]]:
    try:
        job = Job.fetch(job_id, connection=get_redis())
    except NoSuchJob:
        return None
    if expected_user_id is not None:
        args = job.args or ()
        job_user_id = args[1] if len(args) >= 2 else None
        if job_user_id is not None and job_user_id != expected_user_id:
            return None
    # ... 后续不变
```

- [ ] **Step 2: 路由层传入当前用户 id**

`backend/app/jobs_router.py:53` 和 `:61`,取 identity.user_id 传入:
```python
@router.get("/jobs/{job_id}")
def get_job(job_id: str, current=Depends(require_role("student"))):
    identity, _ = current
    info = get_job_status(job_id, expected_user_id=identity.user_id)
    if not info:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在或已过期")
    return ok(info)


@router.get("/jobs/{job_id}/download")
def download_job_result(job_id: str, current=Depends(require_role("student"))):
    identity, _ = current
    path = get_job_result_path(job_id, expected_user_id=identity.user_id)
    if not path:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="结果尚未生成或已过期")
    return FileResponse(path, media_type="application/pdf", filename=f"resume-{job_id}.pdf")
```

- [ ] **Step 3: 运行后端测试**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: 全部 PASS

- [ ] **Step 4: 手动验证越权被拒**

启动后端,用学生 A 导出一份简历拿到 job_id;用学生 B 的 token 访问:
```bash
curl -H "Authorization: Bearer <studentB_token>" http://localhost:8000/api/v1/jobs/<A的job_id>/download
```
Expected: 返回 410(越权被拒,当作不存在)。

- [ ] **Step 5: 提交**

```bash
git add backend/app/jobs.py backend/app/jobs_router.py
git commit -m "fix: PDF 导出下载校验 job 归属,防越权下载他人简历"
```

---

## 阶段二:前端体验(独立于后端,可并行)

### Task 6: 简历切换失败回滚

**Files:**
- Modify: `frontend/src/student/AgentChatView.tsx:1459`

**问题:** `handleResumeChange`(line 1459)先无条件 `setActiveResumeId(resumeId)`,PATCH 失败时 catch 块只注释"silent — state already updated locally",**不回滚**。用户看到已切换,但服务端还是旧简历,下次修改落到旧简历。

- [ ] **Step 1: 改 handleResumeChange,失败回滚 + 提示**

`frontend/src/student/AgentChatView.tsx:1459`,把:
```tsx
const handleResumeChange = useCallback(async (resumeId: number | null) => {
    setActiveResumeId(resumeId)
    if (agentSession?.id) {
      try {
        await apiRequest<AgentChatSession>(`/api/v1/student/master/sessions/${agentSession.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active_resume_id: resumeId }),
        })
      } catch {
        // silent — state already updated locally
      }
    }
  }, [agentSession?.id])
```
改为(乐观更新 + 失败回滚):
```tsx
const handleResumeChange = useCallback(async (resumeId: number | null) => {
    const prev = activeResumeId
    setActiveResumeId(resumeId)  // 乐观更新,UI 立即响应
    if (agentSession?.id) {
      try {
        await apiRequest<AgentChatSession>(`/api/v1/student/master/sessions/${agentSession.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active_resume_id: resumeId }),
        })
      } catch {
        setActiveResumeId(prev)  // 失败回滚,避免下次修改落到旧简历
        Message.error('切换工作简历失败,请重试')
      }
    }
  }, [agentSession?.id, activeResumeId])
```
确认文件顶部已 import `Message`(Arco)。检查方式:Run `cd frontend && grep -n "Message" src/student/AgentChatView.tsx | head -3`,若无 import 则顶部加 `import { Message } from '@arco-design/web-react'`。

- [ ] **Step 2: 构建与 lint 验证**

Run: `cd frontend && npm run build && npm run lint`
Expected: 全绿

- [ ] **Step 3: 提交**

```bash
git add frontend/src/student/AgentChatView.tsx
git commit -m "fix: 工作简历切换失败时回滚,避免修改落到旧简历"
```

---

### Task 7: 前端删除会话时取消后端 run

**Files:**
- Modify: `frontend/src/student/chatRuntimeStore.ts`
- Modify: `frontend/src/student/StudentHomePage.tsx:321`

**问题:** `StudentHomePage.tsx:321` 的 `handleDeleteSession` 删除时只调 `abortSession`(中止本地 SSE 订阅)+ `clearSession`,**没有调后端 cancel 接口**。后端 RunManager 的 agent loop 继续跑完,AI 仍会修改简历。

- [ ] **Step 1: chatRuntimeStore 记录 active run id**

`frontend/src/student/chatRuntimeStore.ts`,类初始化处加字段:
```ts
activeRunIds = new Map<string, string>()  // sessionId -> runId
```
在 `startRun`(约 line 417)收到后端返回的 run_id 后记录:
```ts
this.activeRunIds.set(sessionId, runId)
```
在 run 结束(done 事件 / disconnected / abort)时清理:
```ts
this.activeRunIds.delete(sessionId)
```

- [ ] **Step 2: 新增 deleteSession 方法**

`chatRuntimeStore.ts`,在 `abortSession`(约 line 521)附近新增:
```ts
/** 删除会话:先取消后端 run,再清本地状态。 */
async deleteSession(sessionId: string) {
    // 1. 中止本地 SSE 订阅(防止后续事件再写入)
    this.abortSession(sessionId)
    // 2. 取消后端正在跑的 run(若该 session 有 active run)
    const runId = this.activeRunIds.get(sessionId)
    if (runId) {
        try {
            await apiRequest(`/api/v1/student/master/runs/${runId}/cancel`, { method: 'POST' })
        } catch {
            // run 可能已结束,忽略
        }
    }
    // 3. 清本地状态
    this.clearSession(sessionId)
}
```

- [ ] **Step 3: 确认后端 cancel 端点存在**

Run: `cd backend && grep -n "cancel" app/student/router.py`
Expected: 存在 `POST /api/v1/student/master/runs/{run_id}/cancel`(已核实 `router.py:512-531` 存在)。若不存在则 Task 8 后端侧会补,这里先跳过 Step 2 的 cancel 调用。

- [ ] **Step 4: StudentHomePage 用 deleteSession**

`frontend/src/student/StudentHomePage.tsx:321` 的 `handleDeleteSession`,替换原本的 abortSession+clearSession 调用:
```tsx
const handleDeleteSession = async (target) => {
    // 先取消后端 run + 清本地状态(不 await,与后端 DELETE 并行)
    chatRuntimeStore.deleteSession(String(target.id))
    // 再调后端删除会话
    await apiRequest(`/api/v1/student/master/sessions/${target.id}`, { method: 'DELETE' })
    // ... 原有刷新列表逻辑保持不变
}
```

- [ ] **Step 5: 构建与 lint 验证**

Run: `cd frontend && npm run build && npm run lint`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add frontend/src/student/chatRuntimeStore.ts frontend/src/student/StudentHomePage.tsx
git commit -m "fix: 删除会话时前端先取消后端 run,避免 AI 继续改简历"
```

---

### Task 8: 后端删除会话联动取消 run(防御性兜底)

**Files:**
- Modify: `backend/app/student/router.py` (DELETE session 端点, line 151)
- Modify: `backend/app/student/run_manager.py`

**问题:** Task 7 是前端发起取消,但前端不可信(用户可能直接调 DELETE API,或前端崩溃/网络中断后重试)。后端删除会话时也应联动取消 active run,作为防御性双保险。

- [ ] **Step 1: run_manager 加 list_active_runs 方法**

Run: `cd backend && grep -n "def list_active\|def cancel_run\|def cancel" app/student/run_manager.py`
确认现有 cancel 方法签名。若缺按 session_id 查 active run 的方法,在 `run_manager.py` 添加(参照已有 cancel,line 246 附近):
```python
def list_active_runs(self, db: Session, session_id: int) -> list:
    """返回某 session 下所有未结束的 run(状态为 running/queued)。"""
    from app.student.agent_models import AgentRun  # 确认模型名
    rows = db.scalars(
        select(AgentRun).where(
            AgentRun.session_id == session_id,
            AgentRun.status.in_(["running", "queued", "started"]),
        )
    ).all()
    return list(rows)
```
(具体模型类名和状态值需先 Read `run_manager.py` 顶部 import 和 line 246 的 cancel 实现确认,此处给出的是模式。)

- [ ] **Step 2: DELETE session 端点联动取消**

`backend/app/student/router.py:151` 的删除端点,在 `delete_session` 前取消该 session 的 active run:
```python
@router.delete("/master/sessions/{session_id}")
def delete_master_session(session_id: int, db: Session = Depends(get_db), current=Depends(require_role("student"))):
    identity, _ = current
    session = _get_owned_session(db, identity.user_id, identity.tenant_id, session_id)
    # 防御性:取消该 session 正在跑的 run
    from app.student.run_manager import run_manager
    for run in run_manager.list_active_runs(db, session_id):
        try:
            run_manager.cancel_run(db, run.id, identity.user_id)  # 确认 cancel 方法签名
        except Exception:
            pass  # 单个 run 取消失败不阻塞删除
    delete_session(db, session)
    db.commit()
    return ok(msg="已删除")
```

- [ ] **Step 3: 运行后端测试**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add backend/app/student/router.py backend/app/student/run_manager.py
git commit -m "fix: 后端删除会话联动取消 active run(前端不可信的防御性兜底)"
```

---

### Task 9: 切换会话保留排队内容

**Files:**
- Modify: `frontend/src/student/AgentChatView.tsx` (queue 相关, line 1147, 1296, 1325, 1433)

**问题:** 切换会话(loadTrigger effect line 1325)和新建会话(newChatTrigger effect line 1433)都 `setQueue([])` 无条件清空排队中的文字和附件。排队内容只存在内存,不持久化、不恢复,静默丢失。

- [ ] **Step 1: SavedSessionState 类型加 queue 字段**

`frontend/src/student/AgentChatView.tsx:1147` 的 `SavedSessionState` 类型加:
```tsx
interface SavedSessionState {
    // ... 原有字段
    queue?: QueuedMessage[]  // 新增:排队中的消息
}
```

- [ ] **Step 2: loadTrigger 切换时保存 + 恢复 queue**

`loadTrigger` effect(line 1296),切换前把当前 queue 存进旧 session 的 cache:
```tsx
// 切换前保存当前会话状态
sessionCache.current.set(String(prevSessionId), {
    ...currentSavedState,
    queue,  // 新增
})
// 恢复目标会话状态
const saved = sessionCache.current.get(String(targetSessionId))
setQueue(saved?.queue ?? [])  // 新增:恢复,而非清空
```
**删除** line 1325 的 `setQueue([])`(无条件清空),改为上面的恢复逻辑。

- [ ] **Step 3: newChatTrigger 新建时保存旧 queue**

`newChatTrigger` effect(line 1408),新建会话前先把旧 queue 存进对应旧 session 的 cache(避免新建导致丢失),然后 `setQueue([])`(新建会话本应清空):
```tsx
// 新建前保存当前会话的 queue(若有 agentSession)
if (agentSession?.id) {
    const prev = sessionCache.current.get(String(agentSession.id)) ?? {}
    sessionCache.current.set(String(agentSession.id), { ...prev, queue })
}
setQueue([])  // 新建会话清空
```

- [ ] **Step 4: 构建与 lint 验证**

Run: `cd frontend && npm run build && npm run lint`
Expected: 全绿

- [ ] **Step 5: 手动验证**

启动前端,在会话 A 里 AI 回复期间排队输入文字+附件 → 切到会话 B → 切回 A,确认排队内容还在。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/student/AgentChatView.tsx
git commit -m "fix: 切换会话时保留排队内容,不再静默丢失"
```

---

### Task 10: createAgentSession 异步竞态保护

**Files:**
- Modify: `frontend/src/student/AgentChatView.tsx` (createAgentSession line 1439, runSend line 1605)

**问题:** `createAgentSession`(line 1439)是异步 POST,返回前用户若快速切到历史会话,`runSend`(line 1605)闭包里仍持有即将返回的新 session,导致消息发进新会话而非用户当前看着的历史会话。

- [ ] **Step 1: 新增 agentSessionRef 同步最新 session**

`frontend/src/student/AgentChatView.tsx`,新增 ref 跟踪最新 agentSession(state 闭包是旧值,ref 是同步最新值):
```tsx
const agentSessionRef = useRef<AgentChatSession | null>(agentSession)
useEffect(() => { agentSessionRef.current = agentSession }, [agentSession])
```

- [ ] **Step 2: runSend 创建 session 后校验是否切走**

`runSend`(line 1605),`await createAgentSession()` 返回后校验:
```tsx
const runSend = async (...) => {
    let currentSession = agentSessionRef.current
    if (!currentSession) {
        currentSession = await createAgentSession()
        // 竞态保护:创建期间用户可能已切到历史会话
        const latest = agentSessionRef.current
        if (latest && latest.id !== currentSession.id) {
            // 用户已切走,把消息发到用户当前看着的会话
            currentSession = latest
        }
    }
    // ... 后续用 currentSession.id 发送(把原本引用 agentSession 的地方改为 currentSession)
}
```
**注意:** 需要把 `runSend` 内部原本引用 `agentSession` 的地方统一改为 `currentSession`,确保整条发送链路用同一个 session。

- [ ] **Step 3: 构建与 lint 验证**

Run: `cd frontend && npm run build && npm run lint`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add frontend/src/student/AgentChatView.tsx
git commit -m "fix: 新会话创建期间切换会话的竞态保护,避免消息发进错误会话"
```

---

## 执行顺序建议

```
阶段一(运维与认证,独立任务,任意顺序):
  Task 3 (entrypoint 假成功)     — 最隐蔽,建议优先
  Task 4 (登录限流 IP 可信化)    — 独立
  Task 5 (job 越权下载)          — 独立

阶段二(前端体验,独立于后端):
  Task 6 (简历切换回滚)          — 独立,改动小
  Task 7 + Task 8 (删会话停 run) — 前后端配合,Task 7 先 Task 8 后
  Task 9 (排队保留)              — 独立
  Task 10 (竞态保护)             — 独立
```

每个 Task 结束后:**前端改动跑 `cd frontend && npm run build && npm run lint`,后端改动跑 `cd backend && python -m pytest tests/ -v`,然后提交。**(AGENTS.md 验证标准)

---

## Self-Review 自检

**1. Spec coverage(断言覆盖):**
- 断言1/2/3 → 明确不修复(单租户,无跨校数据)✓
- 断言4 → Task 5 ✓
- 断言5 → 明确不修复(无停用入口)✓
- 断言6 → Task 4 ✓
- 断言7 → Task 3 ✓
- 断言8 → Task 6 ✓
- 断言9 → 明确不修复(核实不成立)✓
- 断言10 → Task 7 + Task 8 ✓
- 断言11 → Task 9 ✓
- 断言12 → Task 10 ✓
- 断言13 → 明确不修复(非致命)✓

**2. Placeholder scan:** 无 TBD/TODO。Task 8 Step 1 含「先 grep 确认 cancel 方法签名/模型类名」的探索步骤——这是必要的代码侦察(run_manager.py 2000+ 行需现场确认),给出的是模式而非占位符,侦察后填入真实签名。

**3. Type consistency:** `require_role` 返回值全程解构为 `identity, _ = current`;`trusted_client_ip` 在 Task 4 Step 1 定义、Step 4/5 使用,签名一致;`activeRunIds` Map 在 Task 7 Step 1 定义、Step 2 使用;`agentSessionRef` 在 Task 10 Step 1 定义、Step 2 使用。

**4. YAGNI 自检:** 数据隔离 4 个任务(原 Task 1-4)因单租户确认已删除,未保留为"技术债"——长期单租户意味着 tenant_id 在新数据里永远 0,加过滤是零收益的复杂度,属过度设计。
