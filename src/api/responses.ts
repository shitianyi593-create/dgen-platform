// src/api/responses.ts
// Responses API（POST /api/v3/responses）。有状态：多轮用 previous_response_id
// 串接（服务器记住上下文，每轮只送新 input）。不送 caching / instructions
//（本页只观测隐性 cache；instructions 与 cache 互斥）。
import { apiClient } from './client'
import { postSse, SSE_DONE, type SseEvent } from './sse'
import type { ChatUsage, GenParams, SystemPromptMode, TurnResult } from '../types/chat'
import { parseNumericParam, type StreamCallbacks } from './chat'

export const RESPONSES_PATH = '/api/v3/responses'
const RESPONSES_TIMEOUT_MS = 300_000

/** input 阵列中的消息项（system prompt 注入用）。content 为纯字符串（文件允许 string）。 */
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
  /** 系统提示注入方式 'instructions'：每轮送出；与 cache 互斥（cached_tokens 归零）。 */
  instructions?: string
  temperature?: number
  top_p?: number
  /** 注意：Responses API 的输出上限字段名与 Chat API 不同。 */
  max_output_tokens?: number
  thinking?: { type: 'enabled' | 'disabled' | 'auto' }
  reasoning?: { effort: string }
}

/**
 * 纯函数：空字符串 = 不送。独立导出供单元测试。
 * systemPrompt 空/纯空白 → 行为与加入本参数前完全一致（向后相容）。
 * - mode 'system'（默认，cache 友好）：仅「第一轮」（无 previousResponseId）把 input
 *   换成 [system, user] 消息阵列；后续轮 system 消息已存在服务器端串接中，input 维持纯字符串。
 * - mode 'instructions'（与 cache 互斥）：每轮都送 instructions（文件：instructions 不随
 *   previous_response_id 带入），input 维持纯字符串。
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

/** 从完整 response 对象抽出统一结果。独立导出供单元测试与流式 completed 事件共用。 */
export function extractResponsesResult(data: ResponsesApiResponse): TurnResult {
  let content = ''
  let reasoning = ''
  for (const item of data.output ?? []) {
    if (item.type === 'reasoning') {
      // summary[] 优先、content[]/reasoning_text 仅作 fallback（两者并存时取 summary，
      // 避免摘要+全文重复显示；原始全文仍可在 rawResponse 查看）。
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

/** 非流式。 */
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

/** 取回服务器端存储的 response 对象（GET /responses/{id}）。 */
export async function retrieveResponse(responseId: string): Promise<unknown> {
  const res = await apiClient.get(`${RESPONSES_PATH}/${encodeURIComponent(responseId)}`)
  return res.data
}

/** 删除服务器端存储的 response（DELETE /responses/{id}）。 */
export interface DeleteResponseResult { id?: string; object?: string; deleted?: boolean }
export async function deleteResponse(responseId: string): Promise<DeleteResponseResult> {
  const res = await apiClient.delete<DeleteResponseResult>(`${RESPONSES_PATH}/${encodeURIComponent(responseId)}`)
  return res.data
}

/** 取回某 response 关联的服务器端上下文（GET /responses/{id}/input_items）。 */
export async function retrieveResponseContext(responseId: string): Promise<unknown> {
  const res = await apiClient.get(`${RESPONSES_PATH}/${encodeURIComponent(responseId)}/input_items`)
  return res.data
}

// 流式事件名（已用 scripts/verify-chat.ts 对照真实 API 确认）。
// event: 行与 data.type 内容相同；其余事件（output_item.added 等）忽略即可。
const EV_TEXT_DELTA = 'response.output_text.delta'
const EV_REASONING_DELTA = 'response.reasoning_summary_text.delta'
const EV_CREATED = 'response.created'
const EV_COMPLETED = 'response.completed'
const EV_INCOMPLETE = 'response.incomplete'
const EV_FAILED = 'response.failed'

/** 流式。累積 delta；最终 usage/meta 来自 response.completed 事件。 */
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
        obj.response?.error?.message ?? obj.message ?? 'Responses 流式失败',
      ) as Error & { body?: unknown }
      err.body = obj
      throw err
    }
    // 其他事件（output_item.added 等）：忽略，raw chunk log 已留存
  }

  const chunks = await postSse(RESPONSES_PATH, body, { signal: cb.signal, onEvent: handle })

  if (!completed) {
    // 异常结束（没等到 completed）：保留累積内容，usage 缺。
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
    // 流式累積值优先（completed 内容应一致；保险起见取非空者）
    content: content || final.content,
    reasoning: reasoning || final.reasoning,
    sseChunks: chunks,
  }
}
