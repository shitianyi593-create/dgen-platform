// src/hooks/useChatGeneration.ts
import { useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { useChatStore, lastResponseId } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import {
  buildChatRequestBody, chatCompletion, chatCompletionStream,
  type ChatMessage, type ChatCompletionRequest,
} from '../api/chat'
import {
  buildResponsesRequestBody, createResponse, createResponseStream,
  type ResponsesRequest,
} from '../api/responses'
import { computeTokensPerSec } from '../utils/chatStats'
import type { ChatTurn, TurnResult } from '../types/chat'

/**
 * 纯函数：把轮次序列摊成 Chat API 的 messages 历史。
 * - error 轮整轮剔除（连 user 消息都不进历史 — 该次请求没有有效响应）。
 * - aborted / 空响应轮：user 消息保留，空的 assistant 消息略过（部分内容则保留）。
 * - 不回送 reasoning_content（文件建议只回送 content）。
 */
export function buildHistoryMessages(turns: ChatTurn[]): ChatMessage[] {
  const msgs: ChatMessage[] = []
  for (const t of turns) {
    if (t.error || t.pending) continue
    msgs.push({ role: 'user', content: t.userText })
    if (t.assistant.content) msgs.push({ role: 'assistant', content: t.assistant.content })
  }
  return msgs
}

/**
 * 纯函数：只看凭证（API 密钥、文字接入点）是否齐备（null = 齐备）。
 * Composer 的凭证引导提示与 computeChatBlockReason 共用，避免字符串重复。
 */
export function computeCredsBlockReason(apiKey: string, textEndpoint: string): string | null {
  if (!apiKey) return '请先输入 API 密钥'
  if (!textEndpoint) return '请先设置文字生成接入点'
  return null
}

/** 送出前置检查（null = 可送出）。Composer 按钮 disable 与 send() 共用。 */
export function computeChatBlockReason(): string | null {
  const { apiKey, textEndpoint } = useAuthStore.getState()
  const s = useChatStore.getState()
  const creds = computeCredsBlockReason(apiKey, textEndpoint)
  if (creds) return creds
  if (s.isGenerating) return '生成中，请先等待完成或按中止'
  return null
}

function makeTurnId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useChatGeneration() {
  const abortRef = useRef<AbortController | null>(null)
  // Responses API 官方建议连续请求间隔 ≥100ms（重送连点防抖用）。
  const lastDoneAtRef = useRef(0)

  const run = useCallback(async (text: string, resendOf?: ChatTurn): Promise<void> => {
    const reason = computeChatBlockReason()
    if (reason) { toast.error(reason); return }

    const s = useChatStore.getState()
    const { textEndpoint } = useAuthStore.getState()
    const mode = s.apiMode

    let requestBody: ChatCompletionRequest | ResponsesRequest
    let prevId: string | undefined
    const systemPrompt = s.systemPrompt.trim()
    if (mode === 'chat') {
      // 重送 = 以「该轮之前的历史」重建同一 request。重送仅允许最后一轮
      //（resendOf 一定是 turns 最后一笔）→ 过滤掉它即为之前的历史。
      const historyTurns = resendOf ? s.turns.filter((t) => t.id !== resendOf.id) : s.turns
      const userMsg = { role: 'user' as const, content: text }
      // system prompt 非空时作为对话首则 system 消息（稳定前缀，有利隐性 cache）。
      const messages: ChatMessage[] = systemPrompt
        ? [{ role: 'system', content: s.systemPrompt }, ...buildHistoryMessages(historyTurns), userMsg]
        : [...buildHistoryMessages(historyTurns), userMsg]
      requestBody = buildChatRequestBody(textEndpoint, s.params, messages)
    } else {
      prevId = resendOf ? resendOf.previousResponseId : lastResponseId(s.turns)
      requestBody = buildResponsesRequestBody(
        textEndpoint, s.params, text, prevId, s.systemPrompt, s.systemPromptMode,
      )
    }

    // 先「同步」占住 in-flight 名额（addTurn + setGenerating + controller）再做
    // 任何 await — 否则等待期间 isGenerating 仍为 false，连点会产生重叠请求。
    const turnId = makeTurnId()
    const requestAt = new Date().toISOString()
    const { addTurn, updateTurn, setGenerating } = useChatStore.getState()
    addTurn({
      id: turnId, apiMode: mode, userText: text,
      assistant: { content: '' },
      requestBody, timing: { requestAt, totalMs: 0 },
      pending: true, previousResponseId: prevId,
    })
    setGenerating(true)

    const controller = new AbortController()
    abortRef.current = controller

    if (mode === 'responses') {
      const since = Date.now() - lastDoneAtRef.current
      if (since < 120) await new Promise((r) => setTimeout(r, 120 - since))
    }

    // t0 在间隔等待之后 — totalMs 不含人工等待时间。
    const t0 = performance.now()
    let ttftMs: number | undefined

    try {
      const cb = {
        signal: controller.signal,
        onFirstToken: () => { ttftMs = performance.now() - t0 },
        onDelta: (content: string, reasoning: string) =>
          updateTurn(turnId, { assistant: { content, reasoning: reasoning || undefined } }),
      }
      let result: TurnResult
      if (s.params.stream) {
        result = mode === 'chat'
          ? await chatCompletionStream(requestBody as ChatCompletionRequest, cb)
          : await createResponseStream(requestBody as ResponsesRequest, cb)
      } else {
        result = mode === 'chat'
          ? await chatCompletion(requestBody as ChatCompletionRequest, controller.signal)
          : await createResponse(requestBody as ResponsesRequest, controller.signal)
      }
      const totalMs = performance.now() - t0
      updateTurn(turnId, {
        assistant: { content: result.content, reasoning: result.reasoning },
        usage: result.usage,
        meta: result.meta,
        rawResponse: result.rawResponse,
        sseChunks: result.sseChunks,
        timing: {
          requestAt, ttftMs, totalMs,
          tokensPerSec: computeTokensPerSec(result.usage?.completionTokens, totalMs, ttftMs),
        },
        pending: false,
      })
    } catch (err) {
      const totalMs = performance.now() - t0
      // 中止/错误发生在流式途中时，sse.ts 会把已收到的原始 chunk 挂在错误上，
      // 保留下来供 debug 面板显示（仅在有值时并入，避免覆盖非流式轮的 undefined）。
      const partialChunks = (err as { sseChunks?: string[] }).sseChunks
      const chunkPatch = partialChunks ? { sseChunks: partialChunks } : {}
      if (controller.signal.aborted) {
        updateTurn(turnId, { aborted: true, pending: false, timing: { requestAt, ttftMs, totalMs }, ...chunkPatch })
        toast('已中止生成')
      } else {
        const e = err as Error & { status?: number; body?: unknown }
        updateTurn(turnId, {
          error: { status: e.status, body: e.body ?? e.message },
          pending: false,
          timing: { requestAt, ttftMs, totalMs },
          ...chunkPatch,
        })
        // 失败轮：把送失败的输入救回输入框（仅在草稿为空时，避免盖掉生成期间新输入的内容）。
        const { composerDraft, setComposerDraft } = useChatStore.getState()
        if (!composerDraft.trim()) setComposerDraft(text)
        toast.error(`生成失败: ${e.message}`)
      }
    } finally {
      lastDoneAtRef.current = Date.now()
      setGenerating(false)
      abortRef.current = null
    }
  }, [])

  const send = useCallback((text: string) => run(text), [run])

  /** 重送最后一轮（隐性 cache 验证的主要手段：同一 request 第二次应 HIT）。 */
  const resendLast = useCallback(async (): Promise<void> => {
    const { turns } = useChatStore.getState()
    const last = turns[turns.length - 1]
    if (!last) return
    await run(last.userText, last)
  }, [run])

  const stop = useCallback(() => { abortRef.current?.abort() }, [])

  return { send, resendLast, stop }
}
