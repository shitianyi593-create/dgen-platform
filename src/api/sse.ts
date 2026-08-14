// SSE（Server-Sent Events）最小解析器 + 流式 POST。
// axios 在浏览器拿不到增量响应 → 流式一律走 fetch + ReadableStream。
// Bearer key 与 apiClient 同源（authStore），走同一个 /api proxy。
import { BASE_URL } from './client'
import { useAuthStore } from '../stores/authStore'

export const SSE_DONE = '[DONE]'

export interface SseEvent {
  /** SSE `event:` 字段（Chat API 没有；Responses API 有事件名）。 */
  event?: string
  /** `data:` 字段的 payload（尚未 JSON.parse；可能是 [DONE]）。 */
  data: string
}

/**
 * 逐行状态机：feed() 喂任意切割的文字，吐出完成的事件。
 * 簡化假设（符合 ARK 的实际输出）：每个事件一行 data；event: 行（若有）
 * 紧接在它的 data 行之前。其他字段（id:、retry:、注解）忽略。
 */
export function createSseParser() {
  let buffer = ''
  let pendingEvent: string | undefined
  return {
    feed(chunk: string): SseEvent[] {
      buffer += chunk
      const out: SseEvent[] = []
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('event:')) {
          pendingEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          out.push({ event: pendingEvent, data: line.slice(5).trim() })
          pendingEvent = undefined
        }
        // 空行与其他字段：忽略
      }
      return out
    },
    /** 流式结束后吐出残留（无结尾换行的最后一行）。 */
    flush(): SseEvent[] {
      const line = buffer.replace(/\r$/, '')
      buffer = ''
      if (line.startsWith('data:')) {
        const e: SseEvent = { event: pendingEvent, data: line.slice(5).trim() }
        pendingEvent = undefined
        return [e]
      }
      return []
    },
  }
}

export interface PostSseOptions {
  signal?: AbortSignal
  /** 每个 data 事件回呼一次（[DONE] 也会，data === SSE_DONE）。抛错会中断读取并外传。 */
  onEvent: (e: SseEvent) => void
}

/**
 * POST + 读 SSE 直到流式结束。返回所有原始 data 行（含 event: 前缀、含 [DONE]），
 * 供 debug 面板的 chunk log 显示。
 */
export async function postSse(
  path: string,
  body: unknown,
  opts: PostSseOptions,
): Promise<string[]> {
  const { apiKey } = useAuthStore.getState()
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok) {
    const text = await res.text()
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* 保留原文 */ }
    const p = parsed as { error?: { message?: string }; message?: string } | string
    const msg: string =
      (typeof p === 'object' && p !== null
        ? p.error?.message ?? p.message
        : undefined) ?? `HTTP ${res.status}`
    const err = new Error(msg) as Error & { status?: number; body?: unknown }
    err.status = res.status
    err.body = parsed
    throw err
  }
  if (!res.body) throw new Error('流式响应没有 body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  const raw: string[] = []
  const dispatch = (events: SseEvent[]) => {
    for (const e of events) {
      raw.push(e.event ? `event: ${e.event}\ndata: ${e.data}` : e.data)
      opts.onEvent(e)
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      dispatch(parser.feed(decoder.decode(value, { stream: true })))
    }
    dispatch(parser.feed(decoder.decode()))
    dispatch(parser.flush())
  } catch (err) {
    // abort / onEvent 抛错：把「到目前为止已收到的原始 chunk」挂在错误上外传，
    // 让上层能保留部分内容的 chunk log 并标记 aborted。
    if (err && typeof err === 'object') {
      ;(err as Error & { sseChunks?: string[] }).sseChunks = raw
    }
    throw err
  } finally {
    // onEvent 抛错 / abort 时确保连接释放
    try { await reader.cancel() } catch { /* already closed */ }
  }
  return raw
}
