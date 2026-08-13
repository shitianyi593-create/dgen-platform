// src/__tests__/chatApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildChatRequestBody, chatCompletion, chatCompletionStream,
  normalizeChatUsage, CHAT_PATH, type ChatMessage,
} from '../api/chat'
import { apiClient } from '../api/client'
import { postSse } from '../api/sse'
import { DEFAULT_GEN_PARAMS } from '../types/chat'

vi.mock('../api/client', () => ({ apiClient: { post: vi.fn() } }))
vi.mock('../api/sse', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/sse')>()
  return { ...orig, postSse: vi.fn() }
})

const mockPost = vi.mocked(apiClient.post)
const mockPostSse = vi.mocked(postSse)

const MSGS: ChatMessage[] = [{ role: 'user', content: 'hi' }]

describe('buildChatRequestBody', () => {
  it('預設參數：只送 model/messages/stream + include_usage', () => {
    expect(buildChatRequestBody('ep-x', DEFAULT_GEN_PARAMS, MSGS)).toEqual({
      model: 'ep-x', messages: MSGS, stream: true,
      stream_options: { include_usage: true },
    })
  })
  it('非串流不帶 stream_options', () => {
    const body = buildChatRequestBody('ep-x', { ...DEFAULT_GEN_PARAMS, stream: false }, MSGS)
    expect(body.stream).toBe(false)
    expect(body).not.toHaveProperty('stream_options')
  })
  it('填了的參數逐一帶上；空字串不送', () => {
    const body = buildChatRequestBody('ep-x', {
      temperature: '0.2', topP: '', maxTokens: '4096',
      thinkingType: 'enabled', reasoningEffort: 'high', stream: false, serviceTier: '',
    }, MSGS)
    expect(body).toMatchObject({
      temperature: 0.2, max_tokens: 4096,
      thinking: { type: 'enabled' }, reasoning_effort: 'high',
    })
    expect(body).not.toHaveProperty('top_p')
  })
  it('非數字（NaN / 空白 / Infinity）不送，不會序列化成 null', () => {
    const body = buildChatRequestBody('ep-x', {
      ...DEFAULT_GEN_PARAMS,
      temperature: 'abc', topP: ' ', maxTokens: '1e999',
    }, MSGS)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('max_tokens')
  })
  it('serviceTier 有值時帶 service_tier；空字串不送', () => {
    const withTier = buildChatRequestBody('ep-x', { ...DEFAULT_GEN_PARAMS, serviceTier: 'fast' }, MSGS)
    expect(withTier.service_tier).toBe('fast')
    const withoutTier = buildChatRequestBody('ep-x', DEFAULT_GEN_PARAMS, MSGS)
    expect(withoutTier).not.toHaveProperty('service_tier')
  })
})

describe('normalizeChatUsage', () => {
  it('補齊巢狀欄位缺漏', () => {
    expect(normalizeChatUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })).toEqual({
      promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0, reasoningTokens: 0,
    })
    expect(normalizeChatUsage(undefined)).toBeUndefined()
  })
})

describe('chatCompletion（非串流）', () => {
  beforeEach(() => mockPost.mockReset())

  it('回傳 content/reasoning/usage/meta/rawResponse', async () => {
    const api = {
      id: 'req-1', model: 'seed-2-0-pro-260328', service_tier: 'default',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello', reasoning_content: 'think' } }],
      usage: {
        prompt_tokens: 20, completion_tokens: 35, total_tokens: 55,
        prompt_tokens_details: { cached_tokens: 8 },
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    }
    mockPost.mockResolvedValueOnce({ data: api })
    const r = await chatCompletion({ model: 'ep-x', messages: MSGS, stream: false })
    expect(mockPost).toHaveBeenCalledWith(CHAT_PATH, expect.anything(), expect.objectContaining({ timeout: 300_000 }))
    expect(r.content).toBe('hello')
    expect(r.reasoning).toBe('think')
    expect(r.usage).toEqual({ promptTokens: 20, completionTokens: 35, totalTokens: 55, cachedTokens: 8, reasoningTokens: 3 })
    expect(r.meta).toEqual({ requestId: 'req-1', model: 'seed-2-0-pro-260328', serviceTier: 'default', finishReason: 'stop' })
    expect(r.rawResponse).toBe(api)
  })
})

describe('chatCompletionStream', () => {
  beforeEach(() => mockPostSse.mockReset())

  function feedEvents(datas: string[]) {
    mockPostSse.mockImplementationOnce(async (_p, _b, opts) => {
      for (const d of datas) opts.onEvent({ data: d })
      return datas
    })
  }

  it('累積 delta、記 meta、從 usage chunk 取 usage、回呼 onFirstToken/onDelta', async () => {
    feedEvents([
      JSON.stringify({ id: 'r1', model: 'm', service_tier: 'default', choices: [{ delta: { reasoning_content: 'th' } }] }),
      JSON.stringify({ id: 'r1', choices: [{ delta: { content: 'he' } }] }),
      JSON.stringify({ id: 'r1', choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }] }),
      JSON.stringify({ id: 'r1', choices: [], usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11, prompt_tokens_details: { cached_tokens: 0 } } }),
      '[DONE]',
    ])
    const onFirstToken = vi.fn()
    const onDelta = vi.fn()
    const r = await chatCompletionStream({ model: 'ep-x', messages: MSGS, stream: true }, { onFirstToken, onDelta })
    expect(r.content).toBe('hello')
    expect(r.reasoning).toBe('th')
    expect(r.usage?.promptTokens).toBe(9)
    expect(r.meta).toMatchObject({ requestId: 'r1', model: 'm', finishReason: 'stop' })
    expect(r.sseChunks).toHaveLength(5)
    expect(onFirstToken).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenLastCalledWith('hello', 'th')
  })

  it('malformed chunk 忽略不中斷', async () => {
    feedEvents(['not-json', JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }), '[DONE]'])
    const r = await chatCompletionStream({ model: 'ep-x', messages: MSGS, stream: true }, {})
    expect(r.content).toBe('ok')
  })
})
