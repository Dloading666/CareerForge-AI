# AI 面试官 Run Events 生产风险说明

## 当前实现

`backend/app/interview/run_events.py` 现在采用 **Redis 优先、进程内内存兜底** 的实现：

- Redis 可用时，run owner、事件列表、done 标记都会写入 Redis key，并设置 30 分钟 TTL。
- Redis 不可用时，模块会短时熔断并降级到进程内 Python 字典，避免每个事件都等待 Redis socket timeout。
- 本地开发无需强制启动 Redis；生产多 worker 部署应确保 Redis 可用。

内存兜底仍包含：

- `_EVENTS`: 事件队列（deque，最大 500 条/run）
- `_DONE`: run 完成标记
- `_RUN_OWNERS`: run 所属 tenant_id + student_id
- `_CREATED_AT`: 创建时间（30 分钟 TTL 自动清理）

## 剩余限制

### 1. Redis 不可用时，多 Worker 仍可能丢事件

当 Redis 不可达时，系统会退回进程内内存。Gunicorn/uvicorn 多 worker 模式下，每个 worker 仍有独立内存空间。

- Worker A 创建 run 并写入事件
- Worker B 处理 SSE 订阅请求，看不到 Worker A 的事件

结果：前端 SSE 可能收不到事件，超时后进入 REST/刷新兜底。

### 2. Redis 未开启持久化时，重启仍可能丢事件

如果 Redis 未开启 AOF/RDB，Redis 重启仍会丢失 run 事件。

- 已创建但未完成的 run 永远不会发送 done
- 前端 SSE 连接断开后重连仍失败，最终 fallback 到 REST

### 3. 内存兜底仍有容量风险

虽然单 run 限制 500 条，且 30 分钟 TTL 会清理过期 run，但 Redis 不可用且高并发时，进程内 run 数量仍可能增长。

## 当前不影响本地开发验收的原因

- 本地开发通常单 worker（uvicorn --reload）
- 面试 run 生命周期短（通常 < 5 分钟）
- 30 分钟 TTL 足够覆盖开发场景
- 即使 Redis 不可用或事件流中断，前端有 REST/刷新兜底

## 生产加固建议

当前实现使用 Redis List + Hash，已能解决常规多 worker 读取问题。更严格的生产加固可以升级到 **Redis Stream** 或 **数据库事件表**：

### Redis Stream 方案

```
XADD interview:run:{run_id} * event runtime.status data '{"phase":"resume","label":"..."}'
XREAD COUNT 10 BLOCK 1000 STREAMS interview:run:{run_id} 0
```

优势：
- 跨 worker 共享
- 支持持久化（AOF/RDB）
- 支持消费者组
- 天然支持 after_seq（stream ID）

### 数据库事件表方案

```sql
CREATE TABLE interview_run_events (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL,
    seq INT NOT NULL,
    event VARCHAR(64) NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

优势：
- 持久化，重启不丢
- 支持复杂查询
- 与现有 SQLAlchemy 集成

劣势：
- 写入延迟比 Redis 高
- 需要定期清理旧事件

## 升级时机

当以下任一条件满足时建议从 Redis List 升级到 Redis Stream 或数据库事件表：
1. 需要严格的事件审计和重放
2. 需要面试事件持久化审计
3. 需要跨服务共享面试事件
4. 需要消费者组、阻塞读取或更强的事件消费语义
