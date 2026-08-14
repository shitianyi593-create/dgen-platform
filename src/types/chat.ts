// src/types/chat.ts
// 文字生成（Chat / Responses API）共用型别。ChatTurn 同时是
// UI 呈现单元、store 持久化单元、下载 JSON 的单元。

export type ChatApiMode = 'chat' | 'responses'

/** 系统提示注入方式（仅 Responses 模式有两種；Chat 一律 system message）。 */
export type SystemPromptMode = 'system' | 'instructions'

/** 两種 API 的 usage 正规化成同一形状（Chat: prompt/completion；Responses: input/output）。 */
export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** usage.prompt_tokens_details.cached_tokens（隐性 cache 命中量；>0 = HIT）。 */
  cachedTokens: number
  /** usage.completion_tokens_details.reasoning_tokens（思维链耗用）。 */
  reasoningTokens: number
}

export interface ChatTiming {
  /** ISO 字符串（送出时间）。 */
  requestAt: string
  /** Time-to-first-token（仅流式有值）。 */
  ttftMs?: number
  totalMs: number
  /** completion_tokens ÷ 生成秒数（totalMs − ttftMs）。 */
  tokensPerSec?: number
}

export interface ChatTurnMeta {
  requestId?: string
  /** 实际使用的 model 版本（响应的 model 字段）。 */
  model?: string
  serviceTier?: string
  /** Chat: finish_reason；Responses: status（completed / incomplete…）。 */
  finishReason?: string
  /** Responses 模式：本轮响应 id（下一轮的 previous_response_id）。 */
  responseId?: string
  /** Responses 模式：响应未完成的原因（incomplete_details.reason）。 */
  incompleteReason?: string
  /** Responses 模式：存储/缓存到期（unix 秒）。 */
  expireAt?: number
}

export interface ChatTurnError {
  status?: number
  /** 原始 error body（或 Error message 字符串）。 */
  body: unknown
}

export interface ChatTurn {
  id: string
  apiMode: ChatApiMode
  userText: string
  assistant: { content: string; reasoning?: string }
  /** 实际送出的 JSON body（含 ep ID；不含 API key）。 */
  requestBody: unknown
  /** 非流式：完整响应。流式（Responses）：response.completed 的 response 对象。 */
  rawResponse?: unknown
  /** 流式：原始 SSE data 行（含 event: 前缀行与 [DONE]）。 */
  sseChunks?: string[]
  usage?: ChatUsage
  timing: ChatTiming
  meta?: ChatTurnMeta
  error?: ChatTurnError
  aborted?: boolean
  /** 生成中。rehydrate 后仍为 true = 被页面刷新中断 → merge 时转标 aborted。 */
  pending?: boolean
  /** 本轮 request 实际带的 previous_response_id（responses 模式；重送需要）。 */
  previousResponseId?: string
}

/** 参数面板状态。数值字段用字符串保留「空 = 不送、用 API 默认」语意。 */
export interface GenParams {
  temperature: string
  topP: string
  maxTokens: string
  thinkingType: '' | 'enabled' | 'disabled' | 'auto'
  reasoningEffort: '' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  stream: boolean
  /** service_tier（推理模式）；空 = 不送（用 API 默认 auto）。仅 Chat API 支持。 */
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

/** api/chat.ts 与 api/responses.ts 的统一返回形状。 */
export interface TurnResult {
  content: string
  reasoning?: string
  usage?: ChatUsage
  meta: ChatTurnMeta
  rawResponse?: unknown
  sseChunks?: string[]
}
