// src/utils/chatStats.ts
import type { ChatTurn } from '../types/chat'

export interface ChatTotals {
  turns: number
  totalTokens: number
  promptTokens: number
  cachedTokens: number
  /** Σcached ÷ Σprompt；尚无 usage 时 null。 */
  cacheHitRate: number | null
  /** 最近一次请求的 prompt_tokens = 模型实际看到的 context 大小；null = 尚无。 */
  currentContextTokens: number | null
}

export function computeChatTotals(turns: ChatTurn[]): ChatTotals {
  let totalTokens = 0, promptTokens = 0, cachedTokens = 0
  let currentContextTokens: number | null = null
  for (const t of turns) {
    if (!t.usage) continue
    totalTokens += t.usage.totalTokens
    promptTokens += t.usage.promptTokens
    cachedTokens += t.usage.cachedTokens
    currentContextTokens = t.usage.promptTokens
  }
  return {
    turns: turns.length,
    totalTokens, promptTokens, cachedTokens,
    cacheHitRate: promptTokens > 0 ? cachedTokens / promptTokens : null,
    currentContextTokens,
  }
}

/** completion_tokens ÷ 生成秒数。流式扣掉 TTFT（等待期不算生成）。 */
export function computeTokensPerSec(
  completionTokens: number | undefined,
  totalMs: number,
  ttftMs?: number,
): number | undefined {
  if (!completionTokens) return undefined
  const genMs = totalMs - (ttftMs ?? 0)
  if (genMs <= 0) return undefined
  return completionTokens / (genMs / 1000)
}
