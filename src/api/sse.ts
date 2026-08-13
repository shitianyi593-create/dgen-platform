// SSE（Server-Sent Events）最小解析器 + 串流 POST。
// axios 在瀏覽器拿不到增量回應 → 串流一律走 fetch + ReadableStream。
// Bearer key 與 apiClient 同源（authStore），走同一個 /api proxy。
import { BASE_URL } from './client'
import { useAuthStore } from '../stores/authStore'

export const SSE_DONE = '[DONE]'

export interface SseEvent {
  /** SSE `event:` 欄位（Chat API 沒有；Responses API 有事件名）。 */
  event?: string
  /** `data:` 欄位的 payload（尚未 JSON.parse；可能是 [DONE]）。 */
  data: string
}

/**
 * 逐行狀態機：feed() 餵任意切割的文字，吐出完成的事件。
 * 簡化假設（符合 ARK 的實際輸出）：每個事件一行 data；event: 行（若有）
 * 緊接在它的 data 行之前。其他欄位（id:、retry:、註解）忽略。
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
        // 空行與其他欄位：忽略
      }
      return out
    },
    /** 串流結束後吐出殘留（無結尾換行的最後一行）。 */
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
  /** 每個 data 事件回呼一次（[DONE] 也會，data === SSE_DONE）。拋錯會中斷讀取並外傳。 */
  onEvent: (e: SseEvent) => void
}

/**
 * POST + 讀 SSE 直到串流結束。回傳所有原始 data 行（含 event: 前綴、含 [DONE]），
 * 供 debug 面板的 chunk log 顯示。
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
  if (!res.body) throw new Error('串流回應沒有 body')

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
    // abort / onEvent 拋錯：把「到目前為止已收到的原始 chunk」掛在錯誤上外傳，
    // 讓上層能保留部分內容的 chunk log 並標記 aborted。
    if (err && typeof err === 'object') {
      ;(err as Error & { sseChunks?: string[] }).sseChunks = raw
    }
    throw err
  } finally {
    // onEvent 拋錯 / abort 時確保連線釋放
    try { await reader.cancel() } catch { /* already closed */ }
  }
  return raw
}
