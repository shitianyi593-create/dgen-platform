// src/api/responses.ts
// Responses API（POST /api/v3/responses）。有狀態：多輪用 previous_response_id
// 串接（伺服器記住上下文，每輪只送新 input）。不送 caching / instructions
//（本頁只觀測隱性 cache；instructions 與 cache 互斥）。
import { apiClient } from './client'
import { postSse, SSE_DONE, type SseEvent } from './sse'
import type { ChatUsage, GenParams, SystemPromptMode, TurnResult } from '../types/chat'
import { parseNumericParam, type StreamCallbacks } from './chat'

export const RESPONSES_PATH = '/api/v3/responses'
const RESPONSES_TIMEOUT_MS = 300_000

/** input 陣列中的訊息項（system prompt 注入用）。content 為純字串（文件允許 string）。 */
export interface ResponsesInputMessage {
  type: 'message'
  role: 'system' | 'user'
  content: string
}

export interface ResponsesRequest {
  model: string
  input: string | ResponsesInputMessage[]
  stream: boolean
  previous_response_id?: string
  /** 系統提示注入方式 'instructions'：每輪送出；與 cache 互斥（cached_tokens 歸零）。 */
  instructions?: string
  temperature?: number
  top_p?: number
  /** 注意：Responses API 的輸出上限欄位名與 Chat API 不同。 */
  max_output_tokens?: number
  thinking?: { type: 'enabled' | 'disabled' | 'auto' }
  reasoning?: { effort: string }
}

/**
 * 純函式：空字串 = 不送。獨立匯出供單元測試。
 * systemPrompt 空/純空白 → 行為與加入本參數前完全一致（向後相容）。
 * - mode 'system'（預設，cache 友善）：僅「第一輪」（無 previousResponseId）把 input
 *   換成 [system, user] 訊息陣列；後續輪 system 訊息已存在伺服器端串接中，input 維持純字串。
 * - mode 'instructions'（與 cache 互斥）：每輪都送 instructions（文件：instructions 不隨
 *   previous_response_id 帶入），input 維持純字串。
 */
export function buildResponsesRequestBody(
  ep: string,
  params: GenParams,
  userText: string,
  previousResponseId?: string,
  systemPrompt?: string,
  systemPromptMode?: SystemPromptMode,
): ResponsesRequest {
  const req: ResponsesRequest = { model: ep, input: userText, stream: params.stream }
  if (previousResponseId) req.previous_response_id = previousResponseId
  const sp = systemPrompt ?? ''
  if (sp.trim() !== '') {
    const mode = systemPromptMode ?? 'system'
    if (mode === 'instructions') {
      req.instructions = sp
    } else if (!previousResponseId) {
      req.input = [
        { type: 'message', role: 'system', content: sp },
        { type: 'message', role: 'user', content: userText },
      ]
    }
  }
  const temperature = parseNumericParam(params.temperature)
  if (temperature !== undefined) req.temperature = temperature
  const topP = parseNumericParam(params.topP)
  if (topP !== undefined) req.top_p = topP
  const maxTokens = parseNumericParam(params.maxTokens)
  if (maxTokens !== undefined) req.max_output_tokens = maxTokens
  if (params.thinkingType !== '') req.thinking = { type: params.thinkingType }
  if (params.reasoningEffort !== '') req.reasoning = { effort: params.reasoningEffort }
  return req
}

interface ResponsesApiUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

interface ResponsesApiResponse {
  id?: string
  model?: string
  service_tier?: string
  status?: string
  incomplete_details?: { reason?: string }
  expire_at?: number
  output?: Array<{
    type?: string
    summary?: Array<{ type?: string; text?: string }>
    content?: Array<{ type?: string; text?: string }>
  }>
  usage?: ResponsesApiUsage
  error?: { message?: string }
}

function normalizeResponsesUsage(u: ResponsesApiUsage | undefined): ChatUsage | undefined {
  if (!u) return undefined
  return {
    promptTokens: u.input_tokens ?? 0,
    completionTokens: u.output_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
  }
}

/** 從完整 response 物件抽出統一結果。獨立匯出供單元測試與串流 completed 事件共用。 */
export function extractResponsesResult(data: ResponsesApiResponse): TurnResult {
  let content = ''
  let reasoning = ''
  for (const item of data.output ?? []) {
    if (item.type === 'reasoning') {
      // summary[] 優先、content[]/reasoning_text 僅作 fallback（兩者並存時取 summary，
      // 避免摘要+全文重複顯示；原始全文仍可在 rawResponse 查看）。
      const summaryText = (item.summary ?? []).map((s) => s.text ?? '').join('')
      const contentText = (item.content ?? [])
        .filter((c) => c.type === 'reasoning_text')
        .map((c) => c.text ?? '')
        .join('')
      reasoning += summaryText || contentText
    } else if (item.type === 'message') {
      content += (item.content ?? [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text ?? '')
        .join('')
    }
  }
  return {
    content,
    reasoning: reasoning || undefined,
    usage: normalizeResponsesUsage(data.usage),
    meta: {
      requestId: data.id,
      responseId: data.id,
      model: data.model,
      serviceTier: data.service_tier,
      finishReason: data.status,
      incompleteReason: data.incomplete_details?.reason,
      expireAt: data.expire_at,
    },
    rawResponse: data,
  }
}

/** 非串流。 */
export async function createResponse(
  body: ResponsesRequest,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const res = await apiClient.post<ResponsesApiResponse>(RESPONSES_PATH, body, {
    timeout: RESPONSES_TIMEOUT_MS,
    signal,
  })
  return extractResponsesResult(res.data)
}

/** 取回伺服器端儲存的 response 物件（GET /responses/{id}）。 */
export async function retrieveResponse(responseId: string): Promise<unknown> {
  const res = await apiClient.get(`${RESPONSES_PATH}/${encodeURIComponent(responseId)}`)
  return res.data
}

/** 刪除伺服器端儲存的 response（DELETE /responses/{id}）。 */
export interface DeleteResponseResult { id?: string; object?: string; deleted?: boolean }
export async function deleteResponse(responseId: string): Promise<DeleteResponseResult> {
  const res = await apiClient.delete<DeleteResponseResult>(`${RESPONSES_PATH}/${encodeURIComponent(responseId)}`)
  return res.data
}

/** 取回某 response 關聯的伺服器端上下文（GET /responses/{id}/input_items）。 */
export async function retrieveResponseContext(responseId: string): Promise<unknown> {
  const res = await apiClient.get(`${RESPONSES_PATH}/${encodeURIComponent(responseId)}/input_items`)
  return res.data
}

// 串流事件名（已用 scripts/verify-chat.ts 對照真實 API 確認）。
// event: 行與 data.type 內容相同；其餘事件（output_item.added 等）忽略即可。
const EV_TEXT_DELTA = 'response.output_text.delta'
const EV_REASONING_DELTA = 'response.reasoning_summary_text.delta'
const EV_CREATED = 'response.created'
const EV_COMPLETED = 'response.completed'
const EV_INCOMPLETE = 'response.incomplete'
const EV_FAILED = 'response.failed'

/** 串流。累積 delta；最終 usage/meta 來自 response.completed 事件。 */
export async function createResponseStream(
  body: ResponsesRequest,
  cb: StreamCallbacks,
): Promise<TurnResult> {
  let content = ''
  let reasoning = ''
  let completed: ResponsesApiResponse | undefined
  let createdId: string | undefined
  let first = true

  const handle = (e: SseEvent) => {
    if (e.data === SSE_DONE) return
    let obj: { type?: string; delta?: string; message?: string; response?: ResponsesApiResponse }
    try { obj = JSON.parse(e.data) as typeof obj } catch { return }
    const type = obj.type ?? e.event
    if (type === EV_TEXT_DELTA || type === EV_REASONING_DELTA) {
      if (first) { first = false; cb.onFirstToken?.() }
      if (type === EV_TEXT_DELTA) content += obj.delta ?? ''
      else reasoning += obj.delta ?? ''
      cb.onDelta?.(content, reasoning)
    } else if (type === EV_CREATED) {
      createdId = obj.response?.id
    } else if (type === EV_COMPLETED || type === EV_INCOMPLETE) {
      completed = obj.response
    } else if (type === EV_FAILED || type === 'error') {
      const err = new Error(
        obj.response?.error?.message ?? obj.message ?? 'Responses 串流失敗',
      ) as Error & { body?: unknown }
      err.body = obj
      throw err
    }
    // 其他事件（output_item.added 等）：忽略，raw chunk log 已留存
  }

  const chunks = await postSse(RESPONSES_PATH, body, { signal: cb.signal, onEvent: handle })

  if (!completed) {
    // 異常結束（沒等到 completed）：保留累積內容，usage 缺。
    return {
      content, reasoning: reasoning || undefined,
      usage: undefined,
      meta: { requestId: createdId, responseId: createdId },
      sseChunks: chunks,
    }
  }
  const final = extractResponsesResult(completed)
  return {
    ...final,
    // 串流累積值優先（completed 內容應一致；保險起見取非空者）
    content: content || final.content,
    reasoning: reasoning || final.reasoning,
    sseChunks: chunks,
  }
}
