import { authenticatedFetch } from '../../shared/api'

export type InterviewRunHandlers = {
  onEvent: (event: string, data: unknown) => void
  onDone: () => void
  onError: (error: Error) => void
}

export type InterviewRunSubscribeOptions = {
  afterSeq?: number
  maxRetries?: number
  timeoutMs?: number
}

export function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

export async function subscribeInterviewRun(
  runId: string,
  handlers: InterviewRunHandlers,
  options?: InterviewRunSubscribeOptions,
): Promise<void> {
  const maxRetries = options?.maxRetries ?? 3
  const timeoutMs = options?.timeoutMs ?? 120000
  let afterSeq = options?.afterSeq ?? 0
  let retries = 0
  let gotDone = false
  let failed = false
  const controller = new AbortController()

  const failOnce = (error: Error) => {
    if (gotDone || failed) return
    failed = true
    controller.abort()
    handlers.onError(error)
  }

  const timeout = setTimeout(() => {
    failOnce(new Error('事件流超时'))
  }, timeoutMs)

  try {
    while (retries <= maxRetries && !gotDone && !failed) {
      try {
        const resp = await authenticatedFetch(
          `/api/v1/student/interviews/runs/${runId}/events?after_seq=${afterSeq}`,
          { signal: controller.signal },
        )
        if (failed) break
        if (!resp.ok || !resp.body) {
          if (resp.status === 401) {
            failOnce(new Error('登录已过期，请刷新页面'))
            break
          }
          throw new Error(`事件流连接失败（${resp.status}）`)
        }

        retries = 0
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (!gotDone && !failed) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() ?? ''
            for (const block of blocks) {
              if (block.startsWith(':')) continue
              const parsed = parseSseBlock(block)
              if (!parsed) continue
              if (typeof parsed.data === 'object' && parsed.data !== null && 'seq' in parsed.data) {
                afterSeq = Math.max(afterSeq, Number((parsed.data as Record<string, unknown>).seq))
              }
              handlers.onEvent(parsed.event, parsed.data)
              if (parsed.event === 'done') {
                gotDone = true
                break
              }
            }
          }
          if (!gotDone && !failed && buffer.trim() && !buffer.startsWith(':')) {
            const parsed = parseSseBlock(buffer)
            if (parsed) {
              handlers.onEvent(parsed.event, parsed.data)
              if (parsed.event === 'done') gotDone = true
            }
          }
        } catch {
          // Stream interrupted; retry with after_seq.
        } finally {
          reader.releaseLock()
        }
      } catch (err) {
        if (failed) break
        if (err instanceof DOMException && err.name === 'AbortError') break
        if (retries >= maxRetries) {
          failOnce(err instanceof Error ? err : new Error('事件流连接失败'))
          break
        }
      }

      if (!gotDone && !failed) {
        retries++
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * retries, 5000)))
      }
    }
  } finally {
    clearTimeout(timeout)
  }

  if (gotDone && !failed) {
    handlers.onDone()
  }
}
