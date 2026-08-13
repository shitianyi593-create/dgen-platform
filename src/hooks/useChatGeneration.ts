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
 * 純函式：把輪次序列攤成 Chat API 的 messages 歷史。
 * - error 輪整輪剔除（連 user 訊息都不進歷史 — 該次請求沒有有效回應）。
 * - aborted / 空回應輪：user 訊息保留，空的 assistant 訊息略過（部分內容則保留）。
 * - 不回送 reasoning_content（文件建議只回送 content）。
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
 * 純函式：只看憑證（API 金鑰、文字接入點）是否齊備（null = 齊備）。
 * Composer 的憑證引導提示與 computeChatBlockReason 共用，避免字串重複。
 */
export function computeCredsBlockReason(apiKey: string, textEndpoint: string): string | null {
  if (!apiKey) return '請先輸入 API 金鑰'
  if (!textEndpoint) return '請先設定文字生成接入點'
  return null
}

/** 送出前置檢查（null = 可送出）。Composer 按鈕 disable 與 send() 共用。 */
export function computeChatBlockReason(): string | null {
  const { apiKey, textEndpoint } = useAuthStore.getState()
  const s = useChatStore.getState()
  const creds = computeCredsBlockReason(apiKey, textEndpoint)
  if (creds) return creds
  if (s.isGenerating) return '生成中，請先等待完成或按中止'
  return null
}

function makeTurnId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useChatGeneration() {
  const abortRef = useRef<AbortController | null>(null)
  // Responses API 官方建議連續請求間隔 ≥100ms（重送連點防抖用）。
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
      // 重送 = 以「該輪之前的歷史」重建同一 request。重送僅允許最後一輪
      //（resendOf 一定是 turns 最後一筆）→ 過濾掉它即為之前的歷史。
      const historyTurns = resendOf ? s.turns.filter((t) => t.id !== resendOf.id) : s.turns
      const userMsg = { role: 'user' as const, content: text }
      // system prompt 非空時作為對話首則 system 訊息（穩定前綴，有利隱性 cache）。
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

    // 先「同步」佔住 in-flight 名額（addTurn + setGenerating + controller）再做
    // 任何 await — 否則等待期間 isGenerating 仍為 false，連點會產生重疊請求。
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

    // t0 在間隔等待之後 — totalMs 不含人工等待時間。
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
      // 中止/錯誤發生在串流途中時，sse.ts 會把已收到的原始 chunk 掛在錯誤上，
      // 保留下來供 debug 面板顯示（僅在有值時併入，避免覆蓋非串流輪的 undefined）。
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
        // 失敗輪：把送失敗的輸入救回輸入框（僅在草稿為空時，避免蓋掉生成期間新輸入的內容）。
        const { composerDraft, setComposerDraft } = useChatStore.getState()
        if (!composerDraft.trim()) setComposerDraft(text)
        toast.error(`生成失敗: ${e.message}`)
      }
    } finally {
      lastDoneAtRef.current = Date.now()
      setGenerating(false)
      abortRef.current = null
    }
  }, [])

  const send = useCallback((text: string) => run(text), [run])

  /** 重送最後一輪（隱性 cache 驗證的主要手段：同一 request 第二次應 HIT）。 */
  const resendLast = useCallback(async (): Promise<void> => {
    const { turns } = useChatStore.getState()
    const last = turns[turns.length - 1]
    if (!last) return
    await run(last.userText, last)
  }, [run])

  const stop = useCallback(() => { abortRef.current?.abort() }, [])

  return { send, resendLast, stop }
}
