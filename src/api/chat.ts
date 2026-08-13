// src/api/chat.ts
// Chat API（POST /api/v3/chat/completions）。無狀態：每輪送完整 messages 歷史。
import { apiClient } from './client'
import { postSse, SSE_DONE } from './sse'
import type { ChatUsage, ChatTurnMeta, GenParams, TurnResult } from '../types/chat'

export const CHAT_PATH = '/api/v3/chat/completions'
/** 深度推理可能跑很久 — 非串流放寬到 5 分鐘（apiClient 預設 30s 不夠）。 */
const CHAT_TIMEOUT_MS = 300_000

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  stream: boolean
  stream_options?: { include_usage: boolean }
  temperature?: number
  top_p?: number
  max_tokens?: number
  thinking?: { type: 'enabled' | 'disabled' | 'auto' }
  reasoning_effort?: string
  /** 推論模式（fast / auto / default）。僅 Chat API 支援。 */
  service_tier?: string
}

/** 空/空白字串或非數字（NaN/Infinity）→ undefined = 不送該參數。 */
export function parseNumericParam(raw: string): number | undefined {
  const s = raw.trim()
  if (s === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** 純函式：空字串 = 不送該參數（用 API 端預設值）。獨立匯出供單元測試。 */
export function buildChatRequestBody(
  ep: string,
  params: GenParams,
  messages: ChatMessage[],
): ChatCompletionRequest {
  const req: ChatCompletionRequest = { model: ep, messages, stream: params.stream }
  // 串流時 usage 預設不回傳 → 一律要求最後一個 chunk 帶 usage（debug 頁的核心資訊）。
  if (params.stream) req.stream_options = { include_usage: true }
  const temperature = parseNumericParam(params.temperature)
  if (temperature !== undefined) req.temperature = temperature
  const topP = parseNumericParam(params.topP)
  if (topP !== undefined) req.top_p = topP
  const maxTokens = parseNumericParam(params.maxTokens)
  if (maxTokens !== undefined) req.max_tokens = maxTokens
  if (params.thinkingType !== '') req.thinking = { type: params.thinkingType }
  if (params.reasoningEffort !== '') req.reasoning_effort = params.reasoningEffort
  if (params.serviceTier !== '') req.service_tier = params.serviceTier
  return req
}

interface ApiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** Chat API usage → 統一形狀。獨立匯出供單元測試。 */
export function normalizeChatUsage(u: ApiUsage | undefined | null): ChatUsage | undefined {
  if (!u) return undefined
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  }
}

interface ChatApiResponse {
  id?: string
  model?: string
  service_tier?: string
  choices?: Array<{
    finish_reason?: string
    message?: { content?: string; reasoning_content?: string }
    delta?: { content?: string; reasoning_content?: string }
  }>
  usage?: ApiUsage | null
}

/** 非串流。signal 供中止（axios 支援 AbortSignal）。 */
export async function chatCompletion(
  body: ChatCompletionRequest,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const res = await apiClient.post<ChatApiResponse>(CHAT_PATH, body, {
    timeout: CHAT_TIMEOUT_MS,
    signal,
  })
  const data = res.data
  const choice = data.choices?.[0]
  return {
    content: choice?.message?.content ?? '',
    reasoning: choice?.message?.reasoning_content || undefined,
    usage: normalizeChatUsage(data.usage),
    meta: {
      requestId: data.id,
      model: data.model,
      serviceTier: data.service_tier,
      finishReason: choice?.finish_reason,
    },
    rawResponse: data,
  }
}

export interface StreamCallbacks {
  signal?: AbortSignal
  /** 第一個含內容（content 或 reasoning）的 chunk 抵達時呼叫一次（TTFT 量測）。 */
  onFirstToken?: () => void
  /** 每次累積更新：目前為止的完整 content / reasoning（即時渲染用）。 */
  onDelta?: (contentSoFar: string, reasoningSoFar: string) => void
}

/** 串流。累積 delta、從最後的 usage chunk 取 token 統計。 */
export async function chatCompletionStream(
  body: ChatCompletionRequest,
  cb: StreamCallbacks,
): Promise<TurnResult> {
  let content = ''
  let reasoning = ''
  let usage: ChatUsage | undefined
  const meta: ChatTurnMeta = {}
  let first = true

  const chunks = await postSse(CHAT_PATH, body, {
    signal: cb.signal,
    onEvent: (e) => {
      if (e.data === SSE_DONE) return
      let obj: ChatApiResponse
      try { obj = JSON.parse(e.data) as ChatApiResponse } catch { return }  // malformed chunk：略過
      if (obj.id && !meta.requestId) {
        meta.requestId = obj.id
        meta.model = obj.model
        meta.serviceTier = obj.service_tier
      }
      const c = obj.choices?.[0]
      if (c?.finish_reason) meta.finishReason = c.finish_reason
      const delta = c?.delta
      if (delta?.content || delta?.reasoning_content) {
        if (first) { first = false; cb.onFirstToken?.() }
        content += delta.content ?? ''
        reasoning += delta.reasoning_content ?? ''
        cb.onDelta?.(content, reasoning)
      }
      if (obj.usage) usage = normalizeChatUsage(obj.usage)
    },
  })

  return { content, reasoning: reasoning || undefined, usage, meta, sseChunks: chunks }
}
