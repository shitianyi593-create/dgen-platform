// src/__tests__/chatDebugPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MessageBubble from '../components/chat/MessageBubble'
import type { ChatTurn } from '../types/chat'
import { retrieveResponseContext, deleteResponse } from '../api/responses'
import { copyWithToast } from '../utils/clipboard'
import { useChatStore } from '../stores/chatStore'

vi.mock('../api/responses', () => ({
  retrieveResponse: vi.fn(),
  retrieveResponseContext: vi.fn(),
  deleteResponse: vi.fn(),
}))

vi.mock('../utils/clipboard', () => ({
  copyWithToast: vi.fn(),
  copyToClipboard: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  useChatStore.setState({ turns: [], isGenerating: false, expandAll: false, composerDraft: '' })
})

function turn(over: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: 'a', apiMode: 'chat', userText: '你好',
    assistant: { content: '哈囉！', reasoning: '用户打招呼' },
    requestBody: { model: 'ep-x', messages: [] },
    rawResponse: { id: 'req-1' },
    usage: { promptTokens: 1500, completionTokens: 50, totalTokens: 1550, cachedTokens: 1024, reasoningTokens: 5 },
    timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 2300, ttftMs: 400, tokensPerSec: 26.3 },
    meta: { requestId: 'req-1', model: 'seed-2-0-pro', serviceTier: 'default', finishReason: 'stop' },
    ...over,
  }
}

describe('MessageBubble（assistant debug 收起/展开）', () => {
  it('默认收起：摘要徽章可见、完整面板不渲染', () => {
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText('哈囉！')).toBeInTheDocument()
    expect(screen.getByText(/cache HIT/)).toBeInTheDocument()      // 摘要徽章
    expect(screen.getByText(/2\.3s/)).toBeInTheDocument()
    expect(screen.queryByText('Raw request')).not.toBeInTheDocument()
  })

  it('点摘要列展开完整 debug 面板', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText('Raw request')).toBeInTheDocument()
    expect(screen.getByText('Raw response')).toBeInTheDocument()
    expect(screen.getByText('req-1')).toBeInTheDocument()           // request id
    // cached_tokens 同时出现在摘要徽章与展开面板 KV → 用 getAllByText，展开后至少 2 处
    expect(screen.getAllByText(/1,?024/).length).toBeGreaterThanOrEqual(2)
  })

  it('expandAll=true 直接展开', () => {
    render(<MessageBubble turn={turn()} isLast={false} expandAll onResend={() => {}} resendDisabled />)
    expect(screen.getByText('Raw request')).toBeInTheDocument()
  })

  it('cache MISS + prompt<1024 → 显示未达门槛提示', async () => {
    const user = userEvent.setup()
    const t = turn({ usage: { promptTokens: 500, completionTokens: 10, totalTokens: 510, cachedTokens: 0, reasoningTokens: 0 } })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText(/cache MISS/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText(/未达隐性 cache 最低门槛/)).toBeInTheDocument()
  })

  it('reasoning 摺叠区存在且含思维链内容', () => {
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText(/思维链/)).toBeInTheDocument()
    expect(screen.getByText('用户打招呼')).toBeInTheDocument()
  })

  it('error 轮：显示错误徽章与原始 error body', async () => {
    const user = userEvent.setup()
    const t = turn({
      assistant: { content: '' }, usage: undefined, rawResponse: undefined,
      error: { status: 429, body: { error: { message: 'rate limited' } } },
    })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText(/错误/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText(/rate limited/)).toBeInTheDocument()
  })

  it('isLast 时显示重送按钮并可点击', async () => {
    const user = userEvent.setup()
    const onResend = vi.fn()
    render(<MessageBubble turn={turn()} isLast expandAll={false} onResend={onResend} resendDisabled={false} />)
    await user.click(screen.getByRole('button', { name: '重送' }))
    expect(onResend).toHaveBeenCalled()
  })

  it('responses 模式：展开后显示 response id 与 expire_at', async () => {
    const user = userEvent.setup()
    const t = turn({
      apiMode: 'responses',
      meta: { requestId: 'resp_9', responseId: 'resp_9', model: 'm', serviceTier: 'default', finishReason: 'completed', expireAt: 1761910597 },
    })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    // fixture 的 requestId 与 responseId 皆为 'resp_9' → request id + response id 两处
    expect(screen.getAllByText('resp_9').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/expire/i)).toBeInTheDocument()
  })
})

describe('TurnDebugPanel — 服务器端动作（responses 模式）', () => {
  const responsesTurn = (over: Partial<ChatTurn> = {}): ChatTurn => turn({
    apiMode: 'responses',
    meta: { requestId: 'resp_9', responseId: 'resp_9', model: 'm', finishReason: 'completed' },
    ...over,
  })

  it('responses 模式 + responseId：展开后显示三颗服务器端动作按钮', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={responsesTurn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText('服务器端动作')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看服务器上下文' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 response' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 response' })).toBeInTheDocument()
  })

  it('chat 模式：不显示服务器端动作区', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.queryByText('服务器端动作')).not.toBeInTheDocument()
  })

  it('点「查看服务器上下文」→ 呼叫 API 并以 RawBlock 呈现结果', async () => {
    const user = userEvent.setup()
    vi.mocked(retrieveResponseContext).mockResolvedValueOnce({ object: 'list', data: [] })
    render(<MessageBubble turn={responsesTurn()} isLast={false} expandAll onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: '查看服务器上下文' }))
    expect(retrieveResponseContext).toHaveBeenCalledWith('resp_9')
    expect(await screen.findByText(/服务器上下文（input_items）/)).toBeInTheDocument()
    expect(screen.getByText(/"object": "list"/)).toBeInTheDocument()
  })

  it('删除流程：ConfirmModal 二次确认 → 呼叫 deleteResponse → 显示删除结果并锁定按钮', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteResponse).mockResolvedValueOnce({ id: 'resp_9', object: 'response', deleted: true })
    render(<MessageBubble turn={responsesTurn()} isLast={false} expandAll onResend={() => {}} resendDisabled />)

    await user.click(screen.getByRole('button', { name: '删除 response' }))
    // ConfirmModal 出现，尚未真的删除
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('删除服务器端 response？')).toBeInTheDocument()
    expect(deleteResponse).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(deleteResponse).toHaveBeenCalledWith('resp_9')
    expect(await screen.findByText('删除结果')).toBeInTheDocument()
    expect(screen.getByText(/"deleted": true/)).toBeInTheDocument()
    // 删除成功后三颗按钮全部锁定（服务器端对象已不存在）
    expect(screen.getByRole('button', { name: '查看服务器上下文' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看 response' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除 response' })).toBeDisabled()
  })
})

describe('MessageBubble — 消息复制按钮（S4）', () => {
  it('复制用户消息：呼叫 copyWithToast(用户消息, userText)', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)
    await user.click(screen.getByRole('button', { name: '复制用户消息' }))
    expect(copyWithToast).toHaveBeenCalledWith('用户消息', '你好')
  })

  it('复制响应内容：呼叫 copyWithToast(响应内容, content)', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)
    await user.click(screen.getByRole('button', { name: '复制响应内容' }))
    expect(copyWithToast).toHaveBeenCalledWith('响应内容', '哈囉！')
  })

  it('content 为空（error 轮）时不渲染复制响应内容按钮', () => {
    const t = turn({
      assistant: { content: '' }, usage: undefined, rawResponse: undefined,
      error: { status: 500, body: { error: { message: 'boom' } } },
    })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)
    expect(screen.queryByRole('button', { name: '复制响应内容' })).not.toBeInTheDocument()
  })
})

describe('MessageBubble — 编辑重送 / 删除（自此轮回溯，S5）', () => {
  it('删除：打开 ConfirmModal，确认后截断 store（自此轮回溯）', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 't1' }), turn({ id: 't2', userText: '第二轮' })] })
    render(<MessageBubble turn={turn({ id: 't1' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)

    await user.click(screen.getByRole('button', { name: '删除此轮及之后' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('删除此轮及之后？')).toBeInTheDocument()
    expect(useChatStore.getState().turns.length).toBe(2)  // 尚未截断

    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(useChatStore.getState().turns).toEqual([])
  })

  it('编辑：确认后回填 composerDraft 为该轮 userText 并截断', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 't1', userText: '原始输入' }), turn({ id: 't2' })] })
    render(<MessageBubble turn={turn({ id: 't1', userText: '原始输入' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)

    await user.click(screen.getByRole('button', { name: '编辑并自此轮重送' }))
    expect(screen.getByText('编辑并自此轮重送？')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '移除并回填' }))

    expect(useChatStore.getState().composerDraft).toBe('原始输入')
    expect(useChatStore.getState().turns).toEqual([])
  })

  it('取消：turns 不变', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 't1' }), turn({ id: 't2' })] })
    render(<MessageBubble turn={turn({ id: 't1' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)

    await user.click(screen.getByRole('button', { name: '删除此轮及之后' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(useChatStore.getState().turns.length).toBe(2)
  })

  it('生成中（resendDisabled）时 编辑 / 删除 按钮 disabled', () => {
    useChatStore.setState({ turns: [turn({ id: 't1' })] })
    render(<MessageBubble turn={turn({ id: 't1' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByRole('button', { name: '编辑并自此轮重送' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除此轮及之后' })).toBeDisabled()
  })
})
