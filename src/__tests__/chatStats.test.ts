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
  it('空對話：全部 0 / null', () => {
    expect(computeChatTotals([])).toEqual({
      turns: 0, totalTokens: 0, promptTokens: 0, cachedTokens: 0,
      cacheHitRate: null, currentContextTokens: null,
    })
  })

  it('累計 usage 並以最後一筆有 usage 的輪作為目前上下文', () => {
    const t1 = turn({ id: 'a', usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 0, reasoningTokens: 0 } })
    const t2 = turn({ id: 'b', usage: { promptTokens: 200, completionTokens: 60, totalTokens: 260, cachedTokens: 150, reasoningTokens: 10 } })
    const t3 = turn({ id: 'c', error: { body: 'boom' } })  // 失敗輪沒 usage
    const totals = computeChatTotals([t1, t2, t3])
    expect(totals.turns).toBe(3)
    expect(totals.totalTokens).toBe(410)
    expect(totals.promptTokens).toBe(300)
    expect(totals.cachedTokens).toBe(150)
    expect(totals.cacheHitRate).toBeCloseTo(0.5)
    expect(totals.currentContextTokens).toBe(200)
  })

  it('有輪但都沒有 usage（失敗輪 + pending 輪）：turns 計數但 totals 全 0 / null', () => {
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
  it('串流：以 totalMs − ttftMs 為生成時間', () => {
    expect(computeTokensPerSec(100, 5000, 1000)).toBeCloseTo(25)
  })
  it('非串流（無 ttft）：以 totalMs 為生成時間', () => {
    expect(computeTokensPerSec(100, 4000)).toBeCloseTo(25)
  })
  it('缺 completionTokens 或時間為 0 → undefined', () => {
    expect(computeTokensPerSec(undefined, 4000)).toBeUndefined()
    expect(computeTokensPerSec(100, 0)).toBeUndefined()
    expect(computeTokensPerSec(100, 1000, 1000)).toBeUndefined()
  })
})
