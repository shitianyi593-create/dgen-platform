// src/__tests__/responsesApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildResponsesRequestBody, createResponse, createResponseStream,
  extractResponsesResult, retrieveResponse, deleteResponse, retrieveResponseContext,
  RESPONSES_PATH,
} from '../api/responses'
import { apiClient } from '../api/client'
import { postSse } from '../api/sse'
import { DEFAULT_GEN_PARAMS } from '../types/chat'

vi.mock('../api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn(), delete: vi.fn() } }))
vi.mock('../api/sse', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/sse')>()
  return { ...orig, postSse: vi.fn() }
})

const mockPost = vi.mocked(apiClient.post)
const mockGet = vi.mocked(apiClient.get)
const mockDelete = vi.mocked(apiClient.delete)
const mockPostSse = vi.mocked(postSse)

// 对照 Text-gen-api-reference/responses-api-create-model-response.md 的范例响应
const API_RESPONSE = {
  id: 'resp_abc', model: 'seed-2-0-pro-260328', object: 'response',
  service_tier: 'default', status: 'completed', expire_at: 1761910597,
  output: [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking…' }], status: 'completed' },
    { type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Hi there!' }] },
  ],
  usage: {
    input_tokens: 85, output_tokens: 72, total_tokens: 157,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens_details: { reasoning_tokens: 60 },
  },
}

describe('buildResponsesRequestBody', () => {
  it('第一轮：input 字符串、无 previous_response_id', () => {
    expect(buildResponsesRequestBody('ep-x', DEFAULT_GEN_PARAMS, 'hello')).toEqual({
      model: 'ep-x', input: 'hello', stream: true,
    })
  })
  it('多轮：带 previous_response_id；参数映射到 Responses 栏位名', () => {
    const body = buildResponsesRequestBody('ep-x', {
      temperature: '0.3', topP: '0.9', maxTokens: '2048',
      thinkingType: 'auto', reasoningEffort: 'low', stream: false, serviceTier: '',
    }, 'again', 'resp_prev')
    expect(body).toEqual({
      model: 'ep-x', input: 'again', stream: false,
      previous_response_id: 'resp_prev',
      temperature: 0.3, top_p: 0.9,
      max_output_tokens: 2048,           // 注意：不是 max_tokens
      thinking: { type: 'auto' },
      reasoning: { effort: 'low' },      // 注意：不是 reasoning_effort
    })
  })
  it('非数字（NaN / 空白 / Infinity）不送，不会序列化成 null', () => {
    const body = buildResponsesRequestBody('ep-x', {
      ...DEFAULT_GEN_PARAMS,
      temperature: 'abc', topP: ' ', maxTokens: '1e999',
    }, 'hi')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('max_output_tokens')
  })

  it('空白系统提示 = 向后相容：input 维持纯字符串、不带 instructions', () => {
    const body = buildResponsesRequestBody('ep-x', DEFAULT_GEN_PARAMS, 'hi', undefined, '   ', 'system')
    expect(body.input).toBe('hi')
    expect(body).not.toHaveProperty('instructions')
  })

  it('系统提示 mode=system 第一轮（无 prevId）：input 换成 [system, user] 消息阵列', () => {
    const body = buildResponsesRequestBody('ep-x', DEFAULT_GEN_PARAMS, 'hi', undefined, '你是助理', 'system')
    expect(body.input).toEqual([
      { type: 'message', role: 'system', content: '你是助理' },
      { type: 'message', role: 'user', content: 'hi' },
    ])
    expect(body).not.toHaveProperty('instructions')
  })

  it('系统提示 mode=system 后续轮（有 prevId）：input 维持纯字符串（system 已在服务器端串接中）', () => {
    const body = buildResponsesRequestBody('ep-x', DEFAULT_GEN_PARAMS, 'again', 'resp_prev', '你是助理', 'system')
    expect(body.input).toBe('again')
    expect(body.previous_response_id).toBe('resp_prev')
    expect(body).not.toHaveProperty('instructions')
  })

  it('系统提示 mode=instructions：每轮（含有 prevId）都送 instructions，input 维持纯字符串', () => {
    const first = buildResponsesRequestBody('ep-x', DEFAULT_GEN_PARAMS, 'hi', undefined, '你是助理', 'instructions')
    expect(first.input).toBe('hi')
    expect(first.instructions).toBe('你是助理')
    const later = buildResponsesRequestBody('ep-x', DEFAULT_GEN_PARAMS, 'again', 'resp_prev', '你是助理', 'instructions')
    expect(later.input).toBe('again')
    expect(later.instructions).toBe('你是助理')
  })

  it('Responses builder 从不带 service_tier（该栏位仅 Chat API 有）', () => {
    const body = buildResponsesRequestBody('ep-x', { ...DEFAULT_GEN_PARAMS, serviceTier: 'fast' }, 'hi', undefined, '你是助理', 'system')
    expect(body).not.toHaveProperty('service_tier')
  })
})

describe('extractResponsesResult', () => {
  it('组合 output 阵列、正规化 usage、meta 带 responseId/expireAt', () => {
    const r = extractResponsesResult(API_RESPONSE)
    expect(r.content).toBe('Hi there!')
    expect(r.reasoning).toBe('thinking…')
    expect(r.usage).toEqual({ promptTokens: 85, completionTokens: 72, totalTokens: 157, cachedTokens: 40, reasoningTokens: 60 })
    expect(r.meta).toEqual({
      requestId: 'resp_abc', responseId: 'resp_abc', model: 'seed-2-0-pro-260328',
      serviceTier: 'default', finishReason: 'completed', expireAt: 1761910597,
    })
  })

  it('reasoning 用 content[]/reasoning_text（无 summary）也能抽出思维链', () => {
    // 对照 responses-api-the-response-object.md：reasoning item 可用 content[] 带 reasoning_text
    const data = {
      id: 'resp_r', status: 'completed',
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: '原始思考' }], status: 'completed' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '答案' }] },
      ],
    }
    const r = extractResponsesResult(data)
    expect(r.reasoning).toBe('原始思考')
    expect(r.content).toBe('答案')
  })

  it('summary 与 content/reasoning_text 并存：只取 summary（不重复拼接）', () => {
    const data = {
      id: 'resp_both', status: 'completed',
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '摘要' }],
          content: [{ type: 'reasoning_text', text: '原始全文原始全文' }],
          status: 'completed',
        },
      ],
    }
    const r = extractResponsesResult(data)
    expect(r.reasoning).toBe('摘要')
  })
})

describe('createResponse（非流式）', () => {
  beforeEach(() => mockPost.mockReset())
  it('POST 到 /api/v3/responses 并解析', async () => {
    mockPost.mockResolvedValueOnce({ data: API_RESPONSE })
    const r = await createResponse({ model: 'ep-x', input: 'hi', stream: false })
    expect(mockPost).toHaveBeenCalledWith(RESPONSES_PATH, expect.anything(), expect.objectContaining({ timeout: 300_000 }))
    expect(r.content).toBe('Hi there!')
    expect(r.rawResponse).toBe(API_RESPONSE)
  })
})

describe('服务器端辅助 API（retrieve / delete / input_items）', () => {
  beforeEach(() => { mockGet.mockReset(); mockDelete.mockReset() })

  it('retrieveResponse：GET /responses/{id}，回传 res.data', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'resp_x', status: 'completed' } })
    const r = await retrieveResponse('resp_x')
    expect(mockGet).toHaveBeenCalledWith(`${RESPONSES_PATH}/resp_x`)
    expect(r).toEqual({ id: 'resp_x', status: 'completed' })
  })

  it('retrieveResponseContext：GET /responses/{id}/input_items', async () => {
    mockGet.mockResolvedValueOnce({ data: { object: 'list', data: [] } })
    const r = await retrieveResponseContext('resp_x')
    expect(mockGet).toHaveBeenCalledWith(`${RESPONSES_PATH}/resp_x/input_items`)
    expect(r).toEqual({ object: 'list', data: [] })
  })

  it('deleteResponse：DELETE /responses/{id}，回传 deleted 结果', async () => {
    mockDelete.mockResolvedValueOnce({ data: { id: 'resp_x', object: 'response', deleted: true } })
    const r = await deleteResponse('resp_x')
    expect(mockDelete).toHaveBeenCalledWith(`${RESPONSES_PATH}/resp_x`)
    expect(r).toEqual({ id: 'resp_x', object: 'response', deleted: true })
  })

  it('responseId 会做 URL 编码', async () => {
    mockGet.mockResolvedValueOnce({ data: {} })
    await retrieveResponse('resp a/b')
    expect(mockGet).toHaveBeenCalledWith(`${RESPONSES_PATH}/resp%20a%2Fb`)
  })
})

describe('createResponseStream', () => {
  beforeEach(() => mockPostSse.mockReset())

  function feed(events: Array<{ event?: string; data: string }>) {
    mockPostSse.mockImplementationOnce(async (_p, _b, opts) => {
      for (const e of events) opts.onEvent(e)
      return events.map((e) => e.data)
    })
  }

  it('累積 output_text delta、以 response.completed 拿 usage/meta', async () => {
    feed([
      { event: 'response.created', data: JSON.stringify({ type: 'response.created', response: { id: 'resp_abc' } }) },
      { event: 'response.reasoning_summary_text.delta', data: JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'think' }) },
      { event: 'response.output_text.delta', data: JSON.stringify({ type: 'response.output_text.delta', delta: 'Hi ' }) },
      { event: 'response.output_text.delta', data: JSON.stringify({ type: 'response.output_text.delta', delta: 'there!' }) },
      { event: 'response.completed', data: JSON.stringify({ type: 'response.completed', response: API_RESPONSE }) },
      { data: '[DONE]' },
    ])
    const onFirstToken = vi.fn()
    const onDelta = vi.fn()
    const r = await createResponseStream({ model: 'ep-x', input: 'hi', stream: true }, { onFirstToken, onDelta })
    expect(r.content).toBe('Hi there!')
    expect(r.reasoning).toBe('think')
    expect(r.usage?.cachedTokens).toBe(40)
    expect(r.meta.responseId).toBe('resp_abc')
    expect(r.meta.expireAt).toBe(1761910597)
    expect(r.rawResponse).toStrictEqual(API_RESPONSE)   // rawResponse = completed 事件的 response 对象（feed 经 JSON 往返 → 深度相等而非同参考）
    expect(onFirstToken).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenLastCalledWith('Hi there!', 'think')
    expect(r.sseChunks).toHaveLength(6)
  })

  it('response.incomplete 视为终结事件：带入 usage / status incomplete / incomplete_details', async () => {
    const incompleteResponse = {
      id: 'resp_inc', model: 'seed-2-0-lite-260428', object: 'response',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial…' }] },
      ],
      usage: { input_tokens: 30, output_tokens: 100, total_tokens: 130 },
    }
    feed([
      { event: 'response.created', data: JSON.stringify({ type: 'response.created', response: { id: 'resp_inc' } }) },
      { event: 'response.output_text.delta', data: JSON.stringify({ type: 'response.output_text.delta', delta: 'partial…' }) },
      { event: 'response.incomplete', data: JSON.stringify({ type: 'response.incomplete', response: incompleteResponse }) },
      { data: '[DONE]' },
    ])
    const r = await createResponseStream({ model: 'ep-x', input: 'hi', stream: true }, {})
    expect(r.content).toBe('partial…')
    expect(r.usage).toEqual({ promptTokens: 30, completionTokens: 100, totalTokens: 130, cachedTokens: 0, reasoningTokens: 0 })
    expect(r.meta.finishReason).toBe('incomplete')
    expect(r.meta.incompleteReason).toBe('max_output_tokens')
  })

  it('response.failed 事件 → 抛出含 body 的错误', async () => {
    mockPostSse.mockImplementationOnce(async (_p, _b, opts) => {
      opts.onEvent({ event: 'response.failed', data: JSON.stringify({ type: 'response.failed', response: { error: { message: 'quota exceeded' } } }) })
      return []
    })
    await expect(
      createResponseStream({ model: 'ep-x', input: 'hi', stream: true }, {}),
    ).rejects.toThrow('quota exceeded')
  })

  it('没收到 completed 也不炸：回传累積内容、usage undefined', async () => {
    feed([
      { event: 'response.output_text.delta', data: JSON.stringify({ type: 'response.output_text.delta', delta: 'partial' }) },
    ])
    const r = await createResponseStream({ model: 'ep-x', input: 'hi', stream: true }, {})
    expect(r.content).toBe('partial')
    expect(r.usage).toBeUndefined()
  })
})
