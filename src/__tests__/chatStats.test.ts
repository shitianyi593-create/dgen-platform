// src/__tests__/chatStats.test.ts
import { describe, it, expect } from 'vitest'
import { computeChatTotals, computeTokensPerSec } from '../utils/chatStats'
import type { ChatTurn } from '../types/chat'

function turn(over: Partial<ChatTurn>): ChatTurn {
  return {
    id: 't1', apiMode: 'chat', userText: 'hi',
    assistant: { content: 'hello' },
    requestBody: {}, timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 1000 },
    ...over,
  }
}

describe('computeChatTotals', () => {
  it('空对话：全部 0 / null', () => {
    expect(computeChatTotals([])).toEqual({
      turns: 0, totalTokens: 0, promptTokens: 0, cachedTokens: 0,
      cacheHitRate: null, currentContextTokens: null,
    })
  })

  it('累计 usage 并以最后一笔有 usage 的轮作为目前上下文', () => {
    const t1 = turn({ id: 'a', usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 0, reasoningTokens: 0 } })
    const t2 = turn({ id: 'b', usage: { promptTokens: 200, completionTokens: 60, totalTokens: 260, cachedTokens: 150, reasoningTokens: 10 } })
    const t3 = turn({ id: 'c', error: { body: 'boom' } })  // 失败轮没 usage
    const totals = computeChatTotals([t1, t2, t3])
    expect(totals.turns).toBe(3)
    expect(totals.totalTokens).toBe(410)
    expect(totals.promptTokens).toBe(300)
    expect(totals.cachedTokens).toBe(150)
    expect(totals.cacheHitRate).toBeCloseTo(0.5)
    expect(totals.currentContextTokens).toBe(200)
  })

  it('有轮但都没有 usage（失败轮 + pending 轮）：turns 计数但 totals 全 0 / null', () => {
    const t1 = turn({ id: 'a', error: { body: 'boom' } })
    const t2 = turn({ id: 'b', pending: true })
    const totals = computeChatTotals([t1, t2])
    expect(totals.turns).toBe(2)
    expect(totals.totalTokens).toBe(0)
    expect(totals.promptTokens).toBe(0)
    expect(totals.cachedTokens).toBe(0)
    expect(totals.cacheHitRate).toBeNull()
    expect(totals.currentContextTokens).toBeNull()
  })
})

describe('computeTokensPerSec', () => {
  it('流式：以 totalMs − ttftMs 为生成时间', () => {
    expect(computeTokensPerSec(100, 5000, 1000)).toBeCloseTo(25)
  })
  it('非流式（无 ttft）：以 totalMs 为生成时间', () => {
    expect(computeTokensPerSec(100, 4000)).toBeCloseTo(25)
  })
  it('缺 completionTokens 或时间为 0 → undefined', () => {
    expect(computeTokensPerSec(undefined, 4000)).toBeUndefined()
    expect(computeTokensPerSec(100, 0)).toBeUndefined()
    expect(computeTokensPerSec(100, 1000, 1000)).toBeUndefined()
  })
})
