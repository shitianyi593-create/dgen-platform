// src/__tests__/chatExport.test.ts
import { describe, it, expect } from 'vitest'
import { buildChatExport } from '../utils/chatExport'
import { DEFAULT_GEN_PARAMS } from '../types/chat'
import type { ChatTurn } from '../types/chat'

const TURN: ChatTurn = {
  id: 'a', apiMode: 'chat', userText: 'hi',
  assistant: { content: 'hello', reasoning: 'think' },
  requestBody: { model: 'ep-x' },
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 60, reasoningTokens: 0 },
  timing: { requestAt: '2026-07-11T01:00:00.000Z', totalMs: 1234, ttftMs: 200, tokensPerSec: 48.3 },
  meta: { requestId: 'req-1', model: 'm', serviceTier: 'default', finishReason: 'stop' },
}

describe('buildChatExport', () => {
  it('打包完整 debug bundle（不含 API key）', () => {
    const bundle = buildChatExport({
      apiMode: 'chat',
      endpoint: 'ep-20260101000000-txttx',
      params: DEFAULT_GEN_PARAMS,
      systemPrompt: '你是助理',
      systemPromptMode: 'instructions',
      turns: [TURN],
      exportedAt: '2026-07-11T02:00:00.000Z',
    })
    expect(bundle.exportedAt).toBe('2026-07-11T02:00:00.000Z')
    expect(bundle.apiMode).toBe('chat')
    expect(bundle.endpoint).toBe('ep-20260101000000-txttx')
    expect(bundle.systemPrompt).toBe('你是助理')
    expect(bundle.systemPromptMode).toBe('instructions')
    expect(bundle.turns).toHaveLength(1)
    expect(bundle.turns[0].requestBody).toEqual({ model: 'ep-x' })
    expect(bundle.totals.totalTokens).toBe(150)
    expect(bundle.totals.cacheHitRate).toBeCloseTo(0.6)
    // 整包序列化不得出现 API key 栏位
    expect(JSON.stringify(bundle)).not.toContain('apiKey')
  })
})
