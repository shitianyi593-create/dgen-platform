// src/__tests__/useChatGeneration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  buildHistoryMessages, computeChatBlockReason, useChatGeneration,
} from '../hooks/useChatGeneration'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { chatCompletion, chatCompletionStream } from '../api/chat'
import { createResponse } from '../api/responses'
import type { ChatTurn, TurnResult } from '../types/chat'

vi.mock('../api/chat', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/chat')>()
  return { ...orig, chatCompletion: vi.fn(), chatCompletionStream: vi.fn() }
})
vi.mock('../api/responses', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/responses')>()
  return { ...orig, createResponse: vi.fn(), createResponseStream: vi.fn() }
})
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const OK_RESULT: TurnResult = {
  content: 'hello', reasoning: 'think',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0, reasoningTokens: 0 },
  meta: { requestId: 'r1', finishReason: 'stop' },
  rawResponse: { ok: true },
}

function turn(over: Partial<ChatTurn>): ChatTurn {
  return {
    id: 'x', apiMode: 'chat', userText: 'q',
    assistant: { content: 'a' }, requestBody: {},
    timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 1 },
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(chatCompletion).mockReset()
  vi.mocked(chatCompletionStream).mockReset()
  vi.mocked(createResponse).mockReset()
  useChatStore.setState({
    turns: [], isGenerating: false, apiMode: 'chat',
    systemPrompt: '', systemPromptMode: 'system', composerDraft: '',
  })
  useChatStore.getState().setParam('stream', false)
  useAuthStore.setState({ apiKey: 'k', textEndpoint: 'ep-20260101000000-txttx' })
})

describe('buildHistoryMessages', () => {
  it('user/assistant 交错；error 轮整轮剔除；无内容的 assistant 略过', () => {
    const msgs = buildHistoryMessages([
      turn({ id: 'a', userText: 'q1', assistant: { content: 'a1' } }),
      turn({ id: 'b', userText: 'q2', error: { body: 'boom' }, assistant: { content: '' } }),
      turn({ id: 'c', userText: 'q3', aborted: true, assistant: { content: '' } }),
      turn({ id: 'd', userText: 'q4', assistant: { content: 'a4' } }),
    ])
    expect(msgs).toEqual([
      { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q3' },                      // aborted 留 user；空 assistant 略过
      { role: 'user', content: 'q4' }, { role: 'assistant', content: 'a4' },
    ])
  })
})

describe('computeChatBlockReason', () => {
  it('缺 key / 缺 ep / 生成中 各自挡下', () => {
    useAuthStore.setState({ apiKey: '', textEndpoint: '' })
    expect(computeChatBlockReason()).toContain('API 密钥')
    useAuthStore.setState({ apiKey: 'k' })
    expect(computeChatBlockReason()).toContain('文字生成接入点')
    useAuthStore.setState({ textEndpoint: 'ep-20260101000000-txttx' })
    useChatStore.setState({ isGenerating: true })
    expect(computeChatBlockReason()).toContain('生成中')
    useChatStore.setState({ isGenerating: false })
    expect(computeChatBlockReason()).toBeNull()
  })
})

describe('useChatGeneration.send（chat 模式・非流式）', () => {
  it('成功：turn 写入 usage/meta/rawResponse/timing，pending 落 false', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(OK_RESULT)
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    const t = useChatStore.getState().turns[0]
    expect(t.userText).toBe('hi')
    expect(t.assistant).toEqual({ content: 'hello', reasoning: 'think' })
    expect(t.usage?.totalTokens).toBe(15)
    expect(t.meta?.requestId).toBe('r1')
    expect(t.pending).toBe(false)
    expect(t.timing.totalMs).toBeGreaterThanOrEqual(0)
    expect(useChatStore.getState().isGenerating).toBe(false)
    // 送出的 messages 带了空历史 + 新消息
    const body = vi.mocked(chatCompletion).mock.calls[0][0]
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.model).toBe('ep-20260101000000-txttx')
  })

  it('失败：turn 标记 error（保留 status/body）', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429, body: { error: { message: 'rate limited' } } })
    vi.mocked(chatCompletion).mockRejectedValueOnce(err)
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    const t = useChatStore.getState().turns[0]
    expect(t.error?.status).toBe(429)
    expect(t.pending).toBe(false)
  })

  it('第二轮带完整历史', async () => {
    vi.mocked(chatCompletion).mockResolvedValue(OK_RESULT)
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('q1'))
    await act(() => result.current.send('q2'))
    const body2 = vi.mocked(chatCompletion).mock.calls[1][0]
    expect(body2.messages).toEqual([
      { role: 'user', content: 'q1' }, { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'q2' },
    ])
  })
})

describe('系统提示注入', () => {
  it('chat 模式：systemPrompt 非空 → messages 以 system 消息开头（原始未 trim 值）', async () => {
    useChatStore.setState({ systemPrompt: '  你是助理  ' })
    vi.mocked(chatCompletion).mockResolvedValueOnce(OK_RESULT)
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    const body = vi.mocked(chatCompletion).mock.calls[0][0]
    expect(body.messages).toEqual([
      { role: 'system', content: '  你是助理  ' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('chat 模式：systemPrompt 纯空白 → 不加 system 消息', async () => {
    useChatStore.setState({ systemPrompt: '   ' })
    vi.mocked(chatCompletion).mockResolvedValueOnce(OK_RESULT)
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    const body = vi.mocked(chatCompletion).mock.calls[0][0]
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('responses 模式 mode=system：第一轮 input 为 [system, user] 阵列', async () => {
    useChatStore.setState({ apiMode: 'responses', systemPrompt: '你是助理', systemPromptMode: 'system' })
    vi.mocked(createResponse).mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_1' } })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    const body = vi.mocked(createResponse).mock.calls[0][0]
    expect(body.input).toEqual([
      { type: 'message', role: 'system', content: '你是助理' },
      { type: 'message', role: 'user', content: 'hi' },
    ])
  })

  it('responses 模式 mode=system：重送第一轮 → input 仍为 [system, user] 阵列（previousResponseId undefined）', async () => {
    useChatStore.setState({ apiMode: 'responses', systemPrompt: '你是助理', systemPromptMode: 'system' })
    vi.mocked(createResponse)
      .mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_1' } })
      .mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_2' } })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    await act(() => result.current.resendLast())
    // 重送第一轮：沿用该轮的 previousResponseId（= undefined）→ request 与原第一轮相同
    const body1 = vi.mocked(createResponse).mock.calls[0][0]
    const body2 = vi.mocked(createResponse).mock.calls[1][0]
    expect(body2.input).toEqual([
      { type: 'message', role: 'system', content: '你是助理' },
      { type: 'message', role: 'user', content: 'hi' },
    ])
    expect(body2.input).toEqual(body1.input)
    expect(body2).not.toHaveProperty('previous_response_id')
  })

  it('responses 模式 mode=system：truncateFromTurn 清空后再送 → input 重新为 [system, user] 阵列', async () => {
    useChatStore.setState({ apiMode: 'responses', systemPrompt: '你是助理', systemPromptMode: 'system' })
    vi.mocked(createResponse)
      .mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_1' } })
      .mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_2' } })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('q1'))
    // 自首轮回溯截断 → turns 清空 → lastResponseId(空) = undefined
    useChatStore.getState().truncateFromTurn(useChatStore.getState().turns[0].id)
    expect(useChatStore.getState().turns).toEqual([])
    await act(() => result.current.send('q2'))
    const body2 = vi.mocked(createResponse).mock.calls[1][0]
    expect(body2.input).toEqual([
      { type: 'message', role: 'system', content: '你是助理' },
      { type: 'message', role: 'user', content: 'q2' },
    ])
    expect(body2).not.toHaveProperty('previous_response_id')
  })

  it('responses 模式 mode=instructions：带 instructions、input 维持纯字符串', async () => {
    useChatStore.setState({ apiMode: 'responses', systemPrompt: '你是助理', systemPromptMode: 'instructions' })
    vi.mocked(createResponse).mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_1' } })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    const body = vi.mocked(createResponse).mock.calls[0][0]
    expect(body.input).toBe('hi')
    expect(body.instructions).toBe('你是助理')
  })
})

describe('失败轮输入救回（composerDraft）', () => {
  it('HTTP 失败且草稿为空 → 把送失败的输入救回草稿', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 })
    vi.mocked(chatCompletion).mockRejectedValueOnce(err)
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('救我'))
    expect(useChatStore.getState().composerDraft).toBe('救我')
  })

  it('失败时用户已另输入内容（草稿非空）→ 不覆盖', async () => {
    const err = Object.assign(new Error('boom'), { status: 500 })
    vi.mocked(chatCompletion).mockImplementationOnce(async () => {
      // 模擬生成期间用户又打了新字
      useChatStore.getState().setComposerDraft('新输入')
      throw err
    })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('原本的'))
    expect(useChatStore.getState().composerDraft).toBe('新输入')
  })

  it('中止（abort）不救回草稿', async () => {
    vi.mocked(chatCompletion).mockImplementationOnce(
      (_body, signal) =>
        new Promise((_, rej) =>
          signal?.addEventListener('abort', () =>
            rej(new DOMException('canceled', 'AbortError')))),
    )
    const { result } = renderHook(() => useChatGeneration())
    act(() => { void result.current.send('别救我') })
    act(() => { result.current.stop() })
    await waitFor(() => {
      expect(useChatStore.getState().turns[0].aborted).toBe(true)
    })
    expect(useChatStore.getState().composerDraft).toBe('')
  })
})

describe('useChatGeneration.send（responses 模式）', () => {
  it('第一轮无 previous_response_id；第二轮带上一轮 responseId', async () => {
    useChatStore.setState({ apiMode: 'responses' })
    vi.mocked(createResponse).mockResolvedValue({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_1' } })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('q1'))
    await act(() => result.current.send('q2'))
    const body1 = vi.mocked(createResponse).mock.calls[0][0]
    const body2 = vi.mocked(createResponse).mock.calls[1][0]
    expect(body1).not.toHaveProperty('previous_response_id')
    expect(body2.previous_response_id).toBe('resp_1')
    expect(useChatStore.getState().turns[1].previousResponseId).toBe('resp_1')
  })
})

describe('stop', () => {
  it('中止 in-flight 请求（chat 模式・非流式）：aborted 标记、无 error、isGenerating 复位', async () => {
    vi.mocked(chatCompletion).mockImplementationOnce(
      (_body, signal) =>
        new Promise((_, rej) =>
          signal?.addEventListener('abort', () =>
            rej(new DOMException('canceled', 'AbortError')))),
    )
    const { result } = renderHook(() => useChatGeneration())
    act(() => { void result.current.send('hi') })
    act(() => { result.current.stop() })
    await waitFor(() => {
      const t = useChatStore.getState().turns[0]
      expect(t.aborted).toBe(true)
      expect(t.pending).toBe(false)
      expect(t.error).toBeUndefined()
      expect(useChatStore.getState().isGenerating).toBe(false)
    })
  })
})

describe('resendLast', () => {
  it('responses 模式：沿用被重送轮的 previousResponseId（非全对话最新 responseId）', async () => {
    useChatStore.setState({ apiMode: 'responses' })
    vi.mocked(createResponse)
      .mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_1' } })
      .mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_2' } })
      .mockResolvedValueOnce({ ...OK_RESULT, meta: { ...OK_RESULT.meta, responseId: 'resp_3' } })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('q1'))
    await act(() => result.current.send('q2'))
    expect(useChatStore.getState().turns[1].previousResponseId).toBe('resp_1')
    await act(() => result.current.resendLast())
    // 重送第二轮必须沿用它原本带的 resp_1，而非 lastResponseId(turns) = resp_2
    const body3 = vi.mocked(createResponse).mock.calls[2][0]
    expect(body3.previous_response_id).toBe('resp_1')
    expect(useChatStore.getState().turns[2].previousResponseId).toBe('resp_1')
  })

  it('chat 模式：以同样历史重送最后一轮的 userText（新 turn 附加在后）', async () => {
    vi.mocked(chatCompletion).mockResolvedValue(OK_RESULT)
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('q1'))
    await act(() => result.current.resendLast())
    const turns = useChatStore.getState().turns
    expect(turns).toHaveLength(2)
    expect(turns[1].userText).toBe('q1')
    // 重送的 request 历史 = 第一轮之前的历史（空）+ q1 → 与第一轮相同
    const body1 = vi.mocked(chatCompletion).mock.calls[0][0]
    const body2 = vi.mocked(chatCompletion).mock.calls[1][0]
    expect(body2.messages).toEqual(body1.messages)
  })
})

describe('流式路径', () => {
  it('流式途中中止：aborted 标记、保留部分内容与 chunk log', async () => {
    useChatStore.getState().setParam('stream', true)
    vi.mocked(chatCompletionStream).mockImplementationOnce((_body, cb) => {
      cb.onDelta?.('pa', '')
      const err = Object.assign(new DOMException('canceled', 'AbortError'), { sseChunks: ['c1', 'c2'] })
      return new Promise((_, rej) => cb.signal?.addEventListener('abort', () => rej(err)))
    })
    const { result } = renderHook(() => useChatGeneration())
    act(() => { void result.current.send('hi') })
    act(() => { result.current.stop() })
    await waitFor(() => {
      const t = useChatStore.getState().turns[0]
      expect(t.aborted).toBe(true)
      expect(t.pending).toBe(false)
      expect(t.error).toBeUndefined()
      expect(t.sseChunks).toEqual(['c1', 'c2'])
      expect(t.assistant.content).toBe('pa')
    })
  })

  it('stream=true 走 chatCompletionStream，onDelta 期间 turn 内容即时更新', async () => {
    useChatStore.getState().setParam('stream', true)
    vi.mocked(chatCompletionStream).mockImplementationOnce(async (_body, cb) => {
      cb.onFirstToken?.()
      cb.onDelta?.('he', '')
      cb.onDelta?.('hello', '')
      return { ...OK_RESULT, sseChunks: ['c1', 'c2'] }
    })
    const { result } = renderHook(() => useChatGeneration())
    await act(() => result.current.send('hi'))
    await waitFor(() => {
      const t = useChatStore.getState().turns[0]
      expect(t.sseChunks).toEqual(['c1', 'c2'])
      expect(t.timing.ttftMs).toBeGreaterThanOrEqual(0)
    })
  })
})
