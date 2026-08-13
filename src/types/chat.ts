// src/types/chat.ts
// 文字生成（Chat / Responses API）共用型別。ChatTurn 同時是
// UI 呈現單元、store 持久化單元、下載 JSON 的單元。

export type ChatApiMode = 'chat' | 'responses'

/** 系統提示注入方式（僅 Responses 模式有兩種；Chat 一律 system message）。 */
export type SystemPromptMode = 'system' | 'instructions'

/** 兩種 API 的 usage 正規化成同一形狀（Chat: prompt/completion；Responses: input/output）。 */
export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** usage.prompt_tokens_details.cached_tokens（隱性 cache 命中量；>0 = HIT）。 */
  cachedTokens: number
  /** usage.completion_tokens_details.reasoning_tokens（思維鏈耗用）。 */
  reasoningTokens: number
}

export interface ChatTiming {
  /** ISO 字串（送出時間）。 */
  requestAt: string
  /** Time-to-first-token（僅串流有值）。 */
  ttftMs?: number
  totalMs: number
  /** completion_tokens ÷ 生成秒數（totalMs − ttftMs）。 */
  tokensPerSec?: number
}

export interface ChatTurnMeta {
  requestId?: string
  /** 實際使用的 model 版本（回應的 model 欄位）。 */
  model?: string
  serviceTier?: string
  /** Chat: finish_reason；Responses: status（completed / incomplete…）。 */
  finishReason?: string
  /** Responses 模式：本輪回應 id（下一輪的 previous_response_id）。 */
  responseId?: string
  /** Responses 模式：回應未完成的原因（incomplete_details.reason）。 */
  incompleteReason?: string
  /** Responses 模式：儲存/快取到期（unix 秒）。 */
  expireAt?: number
}

export interface ChatTurnError {
  status?: number
  /** 原始 error body（或 Error message 字串）。 */
  body: unknown
}

export interface ChatTurn {
  id: string
  apiMode: ChatApiMode
  userText: string
  assistant: { content: string; reasoning?: string }
  /** 實際送出的 JSON body（含 ep ID；不含 API key）。 */
  requestBody: unknown
  /** 非串流：完整回應。串流（Responses）：response.completed 的 response 物件。 */
  rawResponse?: unknown
  /** 串流：原始 SSE data 行（含 event: 前綴行與 [DONE]）。 */
  sseChunks?: string[]
  usage?: ChatUsage
  timing: ChatTiming
  meta?: ChatTurnMeta
  error?: ChatTurnError
  aborted?: boolean
  /** 生成中。rehydrate 後仍為 true = 被頁面重整中斷 → merge 時轉標 aborted。 */
  pending?: boolean
  /** 本輪 request 實際帶的 previous_response_id（responses 模式；重送需要）。 */
  previousResponseId?: string
}

/** 參數面板狀態。數值欄位用字串保留「空 = 不送、用 API 預設」語意。 */
export interface GenParams {
  temperature: string
  topP: string
  maxTokens: string
  thinkingType: '' | 'enabled' | 'disabled' | 'auto'
  reasoningEffort: '' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  stream: boolean
  /** service_tier（推論模式）；空 = 不送（用 API 預設 auto）。僅 Chat API 支援。 */
  serviceTier: '' | 'fast' | 'auto' | 'default'
}

export const DEFAULT_GEN_PARAMS: GenParams = {
  temperature: '',
  topP: '',
  maxTokens: '',
  thinkingType: '',
  reasoningEffort: '',
  stream: true,
  serviceTier: '',
}

/** api/chat.ts 與 api/responses.ts 的統一回傳形狀。 */
export interface TurnResult {
  content: string
  reasoning?: string
  usage?: ChatUsage
  meta: ChatTurnMeta
  rawResponse?: unknown
  sseChunks?: string[]
}
