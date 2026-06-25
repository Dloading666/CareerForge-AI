// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * 安全提取后端错误信息，兼容三种 detail 形态：
 *  - 字符串："请输入内容"
 *  - FastAPI 校验错误数组：[{type, loc, msg, input}, ...] → 取 msg 拼接
 *  - 对象：{detail: {...}} → 递归
 * 避免直接 String(对象) 产生 "[object Object]"。
 */
function extractBackendError(body: Record<string, unknown>, status: number): string {
  const raw = body.detail ?? body.msg ?? body.message
  if (typeof raw === 'string' && raw.trim()) return raw
  if (Array.isArray(raw)) {
    const msgs = raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          const msg = obj.msg ?? obj.message
          if (typeof msg === 'string') return String(msg)
          const loc = Array.isArray(obj.loc) ? obj.loc.join('.') : ''
          return loc ? `${loc} 参数有误` : ''
        }
        return ''
      })
      .filter(Boolean)
    if (msgs.length) return msgs.join('；')
  }
  if (raw && typeof raw === 'object') {
    const inner = (raw as Record<string, unknown>).detail ?? (raw as Record<string, unknown>).msg
    if (typeof inner === 'string' && inner.trim()) return inner
  }
  return `请求失败（${status}）`
}


export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'disconnected'

export type RuntimeStatusEvent = {
  message_id: number
  phase: 'thinking' | 'tool' | 'writing'
  label: string
  tool?: string
  iteration: number
}

export type HeartbeatEvent = {
  message_id: number
  elapsed_ms: number
  output_chars: number
  phase: string
  tool?: string
  iteration?: number
}

export type StepsPlanEvent = {
  session_id: number
  intent: string
  steps: string[]
}

export type RuntimeInfoEvent = {
  message_id: number
  model_name: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  duration_ms: number
}

type StreamEvent = {
  event: string
  data: Record<string, unknown>
}

/** Matches the shape returned by backend activity SSE events */
type AgentActivity = {
  id: number
  session_id: number
  message_id: number | null
  kind: string
  name: string
  status: 'started' | 'completed' | 'failed'
  summary: string | null
  display_summary: string | null
  detail: Record<string, unknown>
  started_at: string
  completed_at: string | null
}

export type GeneratedFile = {
  attachment_id: number
  download_url: string
  filename: string
}

// ── Timeline segments ──────────────────────────────────────────────────────

export type TextSegment = { type: 'text'; content: string }
export type ActionsSegment = {
  type: 'actions'
  activities: AgentActivity[]
  collapsed: boolean
}
export type TimelineSegment = TextSegment | ActionsSegment

/** 将活动按类别聚合计数 */
export function aggregateActions(activities: AgentActivity[]): string {
  const displayActivities = filterRecoveredActivities(activities)
  const groups: Record<string, number> = {}
  let hintCount = 0
  for (const a of displayActivities) {
    const cat = categorizeActivity(a.name, a.kind)
    groups[cat] = (groups[cat] || 0) + 1
    if (a.status === 'failed') hintCount++
  }
  const parts: string[] = []
  const order = ['查阅资料', '搜索', '简历操作', '调用技能', '处理']
  for (const cat of order) {
    const count = groups[cat]
    if (!count) continue
    if (cat === '查阅资料') parts.push(`已查看 ${count} 项资料`)
    else if (cat === '搜索') parts.push(`已搜索 ${count} 次`)
    else if (cat === '简历操作') parts.push(`已完成 ${count} 项简历操作`)
    else if (cat === '调用技能') parts.push(`已运行 ${count} 个技能`)
    else parts.push(`已处理 ${count} 个步骤`)
  }
  if (hintCount > 0) parts.push(`${hintCount} 项轻提示`)
  return parts.join('，') || '处理中…'
}

function filterRecoveredActivities(activities: AgentActivity[]): AgentActivity[] {
  return activities.filter((activity) => {
    if (activity.status !== 'failed') return true
    return !activities.some(
      (candidate) => candidate.name === activity.name && candidate.status === 'completed' && candidate.id > activity.id,
    )
  })
}

function categorizeActivity(name: string, kind: string): string {
  if (name === 'query_student_profile' || name === 'read_resume' || name === 'analyze_uploaded_file'
      || name === 'get_session_context' || kind === 'profile' || kind === 'resume'
      || kind === 'file' || kind === 'context') return '查阅资料'
  if (name === 'web_search' || name === 'read_webpage' || name === 'analyze_jd_match'
      || kind === 'job' || kind === 'knowledge') return '搜索'
  if (name === 'generate_resume_data' || name === 'optimize_resume_data'
      || name === 'update_resume_data' || name === 'apply_resume_patch' || name === 'export_resume_pdf') return '简历操作'
  if (name.startsWith('skill__') || kind === 'skill' || kind === 'resume_skill') return '调用技能'
  return '处理'
}

export type RunState = {
  runId: number | null
  sessionId: number
  agentType: string
  status: RunStatus
  streaming: boolean

  // 消息相关
  assistantContent: string
  assistantMessageId: number | null
  pendingUserMessageId: number | null

  // 状态行
  runtimeStatus: RuntimeStatusEvent | null
  heartbeat: HeartbeatEvent | null
  runtimeInfo: RuntimeInfoEvent | null
  stepsPlan: StepsPlanEvent | null

  // 活动
  activities: AgentActivity[]

  // 时间线分段
  segments: TimelineSegment[]

  // 简历实时刷新信号：AI 改完简历后自增，驱动右侧预览窗重新拉取最新内容
  resumeSignal: { resumeId: number; tick: number } | null

  // 附件/文件
  generatedFiles: Map<number, GeneratedFile[]>
  userAttachments: Map<number, unknown[]>

  // 时间
  streamStartMs: number | null
  lastSeq: number

  // 错误
  error: string | null

  // 对话建议：message_id -> suggestions
  messageSuggestions: Map<number, string[]>
}

type Listener = () => void



/** 按 content_offset 重建时间线，用于流式快照、断线恢复和历史回放。 */
export function buildTimelineSegments(fullContent: string, activities: AgentActivity[]): TimelineSegment[] {
  const displayActivities = filterRecoveredActivities(activities)
  if (!displayActivities.length) return fullContent ? [{ type: 'text', content: fullContent }] : []

  // 按 content_offset 排序活动
  const sorted = [...displayActivities].sort((a, b) => {
    const oa = Number(a.detail?.content_offset ?? Infinity)
    const ob = Number(b.detail?.content_offset ?? Infinity)
    return oa - ob
  })

  const segments: TimelineSegment[] = []
  let cursor = 0

  for (const activity of sorted) {
    const offset = Number(activity.detail?.content_offset)
    if (!isNaN(offset) && offset > cursor && offset <= fullContent.length) {
      // 插入文本段
      const textContent = fullContent.slice(cursor, offset)
      if (textContent) segments.push({ type: 'text', content: textContent })
      cursor = offset
    }

    // 尝试加入前一个 actions 段（如果 offset 相同）
    const lastSeg = segments[segments.length - 1]
    if (lastSeg && lastSeg.type === 'actions' && !isNaN(offset)) {
      const lastOffset = Number(lastSeg.activities[0]?.detail?.content_offset)
      if (lastOffset === offset) {
        lastSeg.activities.push(activity)
        continue
      }
    }

    // 新开 actions 段
    segments.push({ type: 'actions', activities: [activity], collapsed: true })
  }

  // 剩余文本
  if (cursor < fullContent.length) {
    segments.push({ type: 'text', content: fullContent.slice(cursor) })
  }

  // 合并相邻 text 段
  const merged: TimelineSegment[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && last.type === 'text' && seg.type === 'text') {
      last.content += seg.content
    } else {
      merged.push(seg)
    }
  }

  return merged
}

// ── Store ──────────────────────────────────────────────────────────────────────

class ChatRuntimeStore {
  private state: Map<number, RunState> = new Map() // sessionId -> RunState
  private listeners: Set<Listener> = new Set()
  private abortControllers: Map<number, AbortController> = new Map() // sessionId -> controller
  private elapsedTimers: Map<number, ReturnType<typeof setInterval>> = new Map() // sessionId -> timer
  private elapsedTick: number = 0

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(sessionId: number): RunState | null {
    return this.state.get(sessionId) ?? null
  }

  isRunning(sessionId: number): boolean {
    const s = this.state.get(sessionId)
    return s?.streaming === true || s?.status === 'running'
  }

  isAnyRunning(): boolean {
    for (const s of this.state.values()) {
      if (s.streaming || s.status === 'running') return true
    }
    return false
  }

  getActiveSessionIds(): number[] {
    const result: number[] = []
    for (const [sid, s] of this.state) {
      if (s.streaming || s.status === 'running') result.push(sid)
    }
    return result
  }

  /** Tick value that increments every second while a stream is active — for elapsed-time rendering */
  getElapsedTick(): number {
    return this.elapsedTick
  }

  private notify(): void {
    this.elapsedTick++
    for (const fn of this.listeners) fn()
  }

  private updateState(sessionId: number, updater: (prev: RunState) => RunState): void {
    const prev = this.state.get(sessionId)
    const next = updater(prev ?? this.createEmptyState(sessionId))
    this.state.set(sessionId, next)
    this.notify()
  }

  private createEmptyState(sessionId: number): RunState {
    return {
      runId: null,
      sessionId,
      agentType: 'resume',
      status: 'idle',
      streaming: false,
      assistantContent: '',
      assistantMessageId: null,
      pendingUserMessageId: null,
      runtimeStatus: null,
      heartbeat: null,
      runtimeInfo: null,
      stepsPlan: null,
      activities: [],
      segments: [],
      resumeSignal: null,
      generatedFiles: new Map(),
      userAttachments: new Map(),
      streamStartMs: null,
      lastSeq: 0,
      error: null,
      messageSuggestions: new Map(),
    }
  }

  // ── 发送消息并开始流式读取 ────────────────────────────────────────────────

  async startRun(
    sessionId: number,
    agentType: string,
    params: {
      content: string
      model_id: number
      reasoning_effort: string
      attachment_ids: number[]
      optimisticUserMessageId: number
      sendingAttachments?: unknown[]
    },
  ): Promise<void> {
    // 如果已有运行中，不重复启动
    if (this.isRunning(sessionId)) return

    // 取消该 session 之前的流
    this.abortSession(sessionId)

    const state = this.createEmptyState(sessionId)
    state.agentType = agentType
    state.streaming = true
    state.status = 'running'
    state.streamStartMs = Date.now()
    state.pendingUserMessageId = params.optimisticUserMessageId
    state.activities = []
    state.runtimeStatus = null
    state.heartbeat = null
    state.stepsPlan = null
    state.runtimeInfo = null
    state.error = null
    this.state.set(sessionId, state)
    this.notify()

    // 启动计时器（每秒 tick 一次，驱动 UI 更新已用时间）
    const prevTimer = this.elapsedTimers.get(sessionId)
    if (prevTimer) clearInterval(prevTimer)
    this.elapsedTimers.set(sessionId, setInterval(() => {
      this.elapsedTick++
      this.notify()
    }, 1000))

    const controller = new AbortController()
    this.abortControllers.set(sessionId, controller)

    try {
      const { authenticatedFetch } = await import('../shared/api')

      // ── Step 1: POST 启动后台运行，立即拿到 run_id ──
      const startResp = await authenticatedFetch(
        `/api/v1/student/master/sessions/${sessionId}/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: params.content,
            model_id: params.model_id,
            reasoning_effort: params.reasoning_effort,
            attachment_ids: params.attachment_ids,
          }),
          signal: controller.signal,
        },
      )

      if (!startResp.ok) {
        const errBody = await startResp.json().catch(() => ({})) as Record<string, unknown>
        const detail = extractBackendError(errBody, startResp.status)
        throw new Error(detail)
      }

      const startData = (await startResp.json()) as { code: number; data: { run_id: number }; msg: string }
      const runId = startData.data?.run_id
      if (!runId) throw new Error('未获取到 run_id')

      this.updateState(sessionId, (s) => ({ ...s, runId }))

      // ── Step 2: GET 订阅事件流（SSE），连接断开不影响运行 ──
      let afterSeq = 0
      let retries = 0
      const MAX_RETRIES = 5
      let gotDone = false

      while (retries < MAX_RETRIES) {
        if (controller.signal.aborted) break

        const eventsResp = await authenticatedFetch(
          `/api/v1/student/master/runs/${runId}/events?after_seq=${afterSeq}`,
          { signal: controller.signal },
        )

        if (!eventsResp.ok || !eventsResp.body) {
          if (eventsResp.status === 404 || eventsResp.status === 410) {
            // 404/410 = run 已结束或不存在，标记为 disconnected 而非 completed
            this.updateState(sessionId, (s) => ({ ...s, streaming: false, status: 'disconnected', error: '连接中断，请刷新查看结果' }))
            return
          }
          throw new Error(`事件流连接失败（${eventsResp.status}）`)
        }

        retries = 0
        const reader = eventsResp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() ?? ''
            for (const block of blocks) {
              if (block.startsWith(':seq ')) {
                const seq = parseInt(block.slice(5).trim(), 10)
                if (!isNaN(seq)) afterSeq = Math.max(afterSeq, seq)
                continue
              }
              const parsed = parseSseBlock(block)
              if (parsed) {
                this.handleStreamEvent(sessionId, parsed)
                if (parsed.event === 'done') gotDone = true
              }
            }
          }
          if (buffer.trim()) {
            const parsed = parseSseBlock(buffer)
            if (parsed) {
              this.handleStreamEvent(sessionId, parsed)
              if (parsed.event === 'done') gotDone = true
            }
          }
        } catch {
          // 流中断，准备重连
        } finally {
          reader.releaseLock()
        }

        if (gotDone) break
        if (controller.signal.aborted) break

        retries++
        await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, retries), 10000)))
      }

      // 循环退出：gotDone=true 表示正常完成，否则是重连耗尽或被中止
      if (gotDone) {
        this.updateState(sessionId, (s) => ({ ...s, streaming: false, status: 'completed' }))
      } else if (!controller.signal.aborted) {
        this.updateState(sessionId, (s) => ({ ...s, streaming: false, status: 'disconnected', error: '连接中断，请刷新查看结果' }))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const msg = error instanceof Error ? error.message : '回复失败'
        this.updateState(sessionId, (s) => ({
          ...s,
          streaming: false,
          status: 'failed',
          error: msg,
        }))
      }
    } finally {
      this.abortControllers.delete(sessionId)
      const timer = this.elapsedTimers.get(sessionId)
      if (timer) {
        clearInterval(timer)
        this.elapsedTimers.delete(sessionId)
      }
      this.notify()
    }
  }

  // ── 取消当前流 ───────────────────────────────────────────────────────────

  abort(): void {
    for (const [, c] of this.abortControllers) c.abort()
    this.abortControllers.clear()
    for (const [, t] of this.elapsedTimers) clearInterval(t)
    this.elapsedTimers.clear()
  }

  /** Cancel a specific session's active run */
  abortSession(sessionId: number): void {
    const s = this.state.get(sessionId)
    if (s?.streaming) {
      this.abortControllers.get(sessionId)?.abort()
      this.abortControllers.delete(sessionId)
      const timer = this.elapsedTimers.get(sessionId)
      if (timer) {
        clearInterval(timer)
        this.elapsedTimers.delete(sessionId)
      }
      this.updateState(sessionId, (prev) => ({ ...prev, streaming: false, status: 'cancelled' }))
    }
  }

  /** Cancel the backend run as well as the local SSE subscription. */
  async cancelSessionRun(sessionId: number): Promise<void> {
    const s = this.state.get(sessionId)
    const runId = s?.runId
    this.abortSession(sessionId)
    if (!runId) return
    try {
      const { authenticatedFetch } = await import('../shared/api')
      await authenticatedFetch(`/api/v1/student/master/runs/${runId}/cancel`, { method: 'POST' })
    } catch {
      // Local cancellation has already happened; backend cancellation failure should not block the next user message.
    }
  }

  /** Clear session state (useful when switching away from a session) */
  clearSession(sessionId: number): void {
    this.state.delete(sessionId)
    this.notify()
  }

  /** 刷新后恢复活跃 run 的 SSE 订阅 */
  async resumeActiveRuns(): Promise<void> {
    try {
      const { authenticatedFetch } = await import('../shared/api')
      const resp = await authenticatedFetch('/api/v1/student/master/runs/active')
      if (!resp.ok) return
      const data = (await resp.json()) as { data: Array<{ run_id: number; session_id: number; status: string }> }
      const runs = data.data ?? []
      for (const run of runs) {
        if (run.status !== 'running') continue
        const sessionId = run.session_id
        if (this.isRunning(sessionId)) continue // 已在订阅中
        // 创建状态并开始订阅
        const state = this.createEmptyState(sessionId)
        state.runId = run.run_id
        state.streaming = true
        state.status = 'running'
        state.streamStartMs = Date.now()
        this.state.set(sessionId, state)
        // 后台订阅（不阻塞）
        this._resumeSubscribe(sessionId, run.run_id)
      }
      if (runs.length > 0) this.notify()
    } catch {
      // 静默失败，不影响用户体验
    }
  }

  private async _resumeSubscribe(sessionId: number, runId: number): Promise<void> {
    const controller = new AbortController()
    this.abortControllers.set(sessionId, controller)
    const timer = setInterval(() => { this.elapsedTick++; this.notify() }, 1000)
    this.elapsedTimers.set(sessionId, timer)

    try {
      const { authenticatedFetch } = await import('../shared/api')
      let afterSeq = 0
      let retries = 0
      let gotDone = false
      while (retries < 3) {
        if (controller.signal.aborted) break
        const resp = await authenticatedFetch(
          `/api/v1/student/master/runs/${runId}/events?after_seq=${afterSeq}`,
          { signal: controller.signal },
        )
        if (!resp.ok || !resp.body) break
        retries = 0
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() ?? ''
            for (const block of blocks) {
              if (block.startsWith(':seq ')) {
                const seq = parseInt(block.slice(5).trim(), 10)
                if (!isNaN(seq)) afterSeq = Math.max(afterSeq, seq)
                continue
              }
              const parsed = parseSseBlock(block)
              if (parsed) {
                this.handleStreamEvent(sessionId, parsed)
                if (parsed.event === 'done') gotDone = true
              }
            }
          }
        } catch { /* stream interrupted */ } finally { reader.releaseLock() }
        if (gotDone) break
        retries++
        await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, retries), 10000)))
      }
      if (gotDone) {
        this.updateState(sessionId, s => ({ ...s, streaming: false, status: 'completed' }))
      } else if (!controller.signal.aborted) {
        this.updateState(sessionId, s => ({ ...s, streaming: false, status: 'disconnected', error: '连接中断，请刷新查看结果' }))
      }
    } catch {
      this.updateState(sessionId, s => ({ ...s, streaming: false, status: 'disconnected' }))
    } finally {
      this.abortControllers.delete(sessionId)
      const t = this.elapsedTimers.get(sessionId)
      if (t) { clearInterval(t); this.elapsedTimers.delete(sessionId) }
      this.notify()
    }
  }

  // ── SSE 事件处理 ─────────────────────────────────────────────────────────

  private handleStreamEvent(
    sessionId: number,
    evt: StreamEvent,
  ): void {
    const { event, data } = evt


    if (event === 'message.saved') {
      const messageId = Number(data.message_id)
      this.updateState(sessionId, (s) => {
        const newAttachments = new Map(s.userAttachments)
        if (s.pendingUserMessageId && newAttachments.has(s.pendingUserMessageId)) {
          newAttachments.set(messageId, newAttachments.get(s.pendingUserMessageId)!)
          newAttachments.delete(s.pendingUserMessageId)
        }
        return { ...s, pendingUserMessageId: messageId, userAttachments: newAttachments }
      })
      return
    }

    if (event === 'activity.started' || event === 'activity.completed' || event === 'activity.failed') {
      const activity = data as unknown as AgentActivity
      this.updateState(sessionId, (s) => {
        const idx = s.activities.findIndex((a) => a.id === activity.id)
        const activities = [...s.activities]
        if (idx >= 0) activities[idx] = activity
        else activities.push(activity)

        const segments = buildTimelineSegments(s.assistantContent, activities)

        // 简历实时刷新信号：AI 完成「生成/优化/更新简历」工具且携带 resume_id 时，
        // 自增 tick 驱动右侧预览窗重新拉取最新简历内容（即使 resume_id 没变也能刷新）
        let resumeSignal = s.resumeSignal
        if (
          activity.status === 'completed'
          && (activity.name === 'generate_resume_data'
            || activity.name === 'optimize_resume_data'
            || activity.name === 'update_resume_data'
            || activity.name === 'apply_resume_patch')
        ) {
          const rid = Number(activity.detail?.resume_id)
          if (Number.isFinite(rid) && rid > 0) {
            resumeSignal = { resumeId: rid, tick: (s.resumeSignal?.tick ?? 0) + 1 }
          }
        }

        return { ...s, activities, segments, resumeSignal }
      })
      return
    }

    if (event === 'runtime.heartbeat') {
      this.updateState(sessionId, (s) => ({
        ...s,
        heartbeat: data as unknown as HeartbeatEvent,
      }))
      return
    }

    if (event === 'runtime.steps_plan') {
      const raw = data as Record<string, unknown>
      if (Array.isArray(raw?.steps)) {
        this.updateState(sessionId, (s) => ({
          ...s,
          stepsPlan: { session_id: Number(raw.session_id) || 0, intent: String(raw.intent || ''), steps: raw.steps as string[] },
        }))
      }
      return
    }

    if (event === 'runtime.status') {
      this.updateState(sessionId, (s) => ({
        ...s,
        runtimeStatus: data as unknown as RuntimeStatusEvent,
      }))
      return
    }

    if (event === 'runtime.completed') {
      const info = data as unknown as RuntimeInfoEvent
      this.updateState(sessionId, (s) => ({
        ...s,
        runtimeInfo: info,
        runtimeStatus: null,
        heartbeat: null,
        stepsPlan: null,
      }))
      return
    }

    if (event === 'message.snapshot') {
      // 快照：替换正文（不是追加），用于断线重连后幂等恢复
      const rawContent = data.content ?? ''
      const content = typeof rawContent === 'string' ? rawContent : ''
      const messageId = Number(data.message_id)
      this.updateState(sessionId, (s) => {
        // 按 content_offset 重建 segments
        const segments = buildTimelineSegments(content, s.activities)
        return {
          ...s,
          assistantContent: content,
          assistantMessageId: messageId,
          segments,
        }
      })
      return
    }

    if (event === 'message.delta') {
      const rawDelta = data.delta ?? ''
      const delta = typeof rawDelta === 'string' ? rawDelta : ''
      const messageId = Number(data.message_id)
      this.updateState(sessionId, (s) => {
        const segments = s.segments.map((segment) => (
          segment.type === 'actions'
            ? { ...segment, activities: [...segment.activities] }
            : { ...segment }
        ))
        // 追加到末尾 text 段；末尾是 actions 段则新开 text 段
        const last = segments[segments.length - 1]
        if (last && last.type === 'text') {
          last.content += delta
        } else {
          segments.push({ type: 'text', content: delta })
        }
        return {
          ...s,
          assistantContent: s.assistantContent + delta,
          assistantMessageId: messageId,
          segments,
          runtimeStatus:
            s.runtimeStatus?.phase === 'writing'
              ? s.runtimeStatus
              : {
                  message_id: messageId,
                  phase: 'writing',
                  label: '正在组织并输出回复…',
                  iteration: s.runtimeStatus?.iteration || 1,
                },
        }
      })
      return
    }

    if (event === 'message.completed') {
      this.updateState(sessionId, (s) => ({ ...s, runtimeStatus: null }))
      return
    }

    if (event === 'message.suggestions') {
      const messageId = Number(data.message_id)
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : []
      this.updateState(sessionId, (s) => {
        const newMap = new Map(s.messageSuggestions)
        newMap.set(messageId, suggestions)
        return { ...s, messageSuggestions: newMap }
      })
      return
    }

    if (event === 'attachment.created') {
      const messageId = Number(data.message_id)
      const downloadUrl = String(data.download_url ?? '')
      if (!downloadUrl) return
      const file: GeneratedFile = {
        attachment_id: Number(data.attachment_id),
        download_url: downloadUrl,
        filename: String(data.filename ?? '简历.pdf'),
      }
      this.updateState(sessionId, (s) => {
        const newFiles = new Map(s.generatedFiles)
        const list = newFiles.get(messageId) ?? []
        if (list.some((f) => f.attachment_id === file.attachment_id)) return s
        newFiles.set(messageId, [...list, file])
        return { ...s, generatedFiles: newFiles }
      })
    }
  }
}

// ── SSE 解析（复用 AgentChatView 的逻辑）────────────────────────────────────

function parseSseBlock(block: string): StreamEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> }
  } catch {
    return null
  }
}

// ── 导出单例 ───────────────────────────────────────────────────────────────────

export const chatRuntimeStore = new ChatRuntimeStore()
