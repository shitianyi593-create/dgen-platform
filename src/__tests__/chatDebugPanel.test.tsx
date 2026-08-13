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
    assistant: { content: '哈囉！', reasoning: '使用者打招呼' },
    requestBody: { model: 'ep-x', messages: [] },
    rawResponse: { id: 'req-1' },
    usage: { promptTokens: 1500, completionTokens: 50, totalTokens: 1550, cachedTokens: 1024, reasoningTokens: 5 },
    timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 2300, ttftMs: 400, tokensPerSec: 26.3 },
    meta: { requestId: 'req-1', model: 'seed-2-0-pro', serviceTier: 'default', finishReason: 'stop' },
    ...over,
  }
}

describe('MessageBubble（assistant debug 收合/展開）', () => {
  it('預設收合：摘要徽章可見、完整面板不渲染', () => {
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText('哈囉！')).toBeInTheDocument()
    expect(screen.getByText(/cache HIT/)).toBeInTheDocument()      // 摘要徽章
    expect(screen.getByText(/2\.3s/)).toBeInTheDocument()
    expect(screen.queryByText('Raw request')).not.toBeInTheDocument()
  })

  it('點摘要列展開完整 debug 面板', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText('Raw request')).toBeInTheDocument()
    expect(screen.getByText('Raw response')).toBeInTheDocument()
    expect(screen.getByText('req-1')).toBeInTheDocument()           // request id
    // cached_tokens 同時出現在摘要徽章與展開面板 KV → 用 getAllByText，展開後至少 2 處
    expect(screen.getAllByText(/1,?024/).length).toBeGreaterThanOrEqual(2)
  })

  it('expandAll=true 直接展開', () => {
    render(<MessageBubble turn={turn()} isLast={false} expandAll onResend={() => {}} resendDisabled />)
    expect(screen.getByText('Raw request')).toBeInTheDocument()
  })

  it('cache MISS + prompt<1024 → 顯示未達門檻提示', async () => {
    const user = userEvent.setup()
    const t = turn({ usage: { promptTokens: 500, completionTokens: 10, totalTokens: 510, cachedTokens: 0, reasoningTokens: 0 } })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText(/cache MISS/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText(/未達隱性 cache 最低門檻/)).toBeInTheDocument()
  })

  it('reasoning 摺疊區存在且含思維鏈內容', () => {
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText(/思維鏈/)).toBeInTheDocument()
    expect(screen.getByText('使用者打招呼')).toBeInTheDocument()
  })

  it('error 輪：顯示錯誤徽章與原始 error body', async () => {
    const user = userEvent.setup()
    const t = turn({
      assistant: { content: '' }, usage: undefined, rawResponse: undefined,
      error: { status: 429, body: { error: { message: 'rate limited' } } },
    })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByText(/錯誤/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText(/rate limited/)).toBeInTheDocument()
  })

  it('isLast 時顯示重送按鈕並可點擊', async () => {
    const user = userEvent.setup()
    const onResend = vi.fn()
    render(<MessageBubble turn={turn()} isLast expandAll={false} onResend={onResend} resendDisabled={false} />)
    await user.click(screen.getByRole('button', { name: '重送' }))
    expect(onResend).toHaveBeenCalled()
  })

  it('responses 模式：展開後顯示 response id 與 expire_at', async () => {
    const user = userEvent.setup()
    const t = turn({
      apiMode: 'responses',
      meta: { requestId: 'resp_9', responseId: 'resp_9', model: 'm', serviceTier: 'default', finishReason: 'completed', expireAt: 1761910597 },
    })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    // fixture 的 requestId 與 responseId 皆為 'resp_9' → request id + response id 兩處
    expect(screen.getAllByText('resp_9').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/expire/i)).toBeInTheDocument()
  })
})

describe('TurnDebugPanel — 伺服器端動作（responses 模式）', () => {
  const responsesTurn = (over: Partial<ChatTurn> = {}): ChatTurn => turn({
    apiMode: 'responses',
    meta: { requestId: 'resp_9', responseId: 'resp_9', model: 'm', finishReason: 'completed' },
    ...over,
  })

  it('responses 模式 + responseId：展開後顯示三顆伺服器端動作按鈕', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={responsesTurn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.getByText('伺服器端動作')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看伺服器上下文' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '檢視 response' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刪除 response' })).toBeInTheDocument()
  })

  it('chat 模式：不顯示伺服器端動作區', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: /debug/i }))
    expect(screen.queryByText('伺服器端動作')).not.toBeInTheDocument()
  })

  it('點「查看伺服器上下文」→ 呼叫 API 並以 RawBlock 呈現結果', async () => {
    const user = userEvent.setup()
    vi.mocked(retrieveResponseContext).mockResolvedValueOnce({ object: 'list', data: [] })
    render(<MessageBubble turn={responsesTurn()} isLast={false} expandAll onResend={() => {}} resendDisabled />)
    await user.click(screen.getByRole('button', { name: '查看伺服器上下文' }))
    expect(retrieveResponseContext).toHaveBeenCalledWith('resp_9')
    expect(await screen.findByText(/伺服器上下文（input_items）/)).toBeInTheDocument()
    expect(screen.getByText(/"object": "list"/)).toBeInTheDocument()
  })

  it('刪除流程：ConfirmModal 二次確認 → 呼叫 deleteResponse → 顯示刪除結果並鎖定按鈕', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteResponse).mockResolvedValueOnce({ id: 'resp_9', object: 'response', deleted: true })
    render(<MessageBubble turn={responsesTurn()} isLast={false} expandAll onResend={() => {}} resendDisabled />)

    await user.click(screen.getByRole('button', { name: '刪除 response' }))
    // ConfirmModal 出現，尚未真的刪除
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('刪除伺服器端 response？')).toBeInTheDocument()
    expect(deleteResponse).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '刪除' }))
    expect(deleteResponse).toHaveBeenCalledWith('resp_9')
    expect(await screen.findByText('刪除結果')).toBeInTheDocument()
    expect(screen.getByText(/"deleted": true/)).toBeInTheDocument()
    // 刪除成功後三顆按鈕全部鎖定（伺服器端物件已不存在）
    expect(screen.getByRole('button', { name: '查看伺服器上下文' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '檢視 response' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刪除 response' })).toBeDisabled()
  })
})

describe('MessageBubble — 訊息複製按鈕（S4）', () => {
  it('複製使用者訊息：呼叫 copyWithToast(使用者訊息, userText)', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)
    await user.click(screen.getByRole('button', { name: '複製使用者訊息' }))
    expect(copyWithToast).toHaveBeenCalledWith('使用者訊息', '你好')
  })

  it('複製回應內容：呼叫 copyWithToast(回應內容, content)', async () => {
    const user = userEvent.setup()
    render(<MessageBubble turn={turn()} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)
    await user.click(screen.getByRole('button', { name: '複製回應內容' }))
    expect(copyWithToast).toHaveBeenCalledWith('回應內容', '哈囉！')
  })

  it('content 為空（error 輪）時不渲染複製回應內容按鈕', () => {
    const t = turn({
      assistant: { content: '' }, usage: undefined, rawResponse: undefined,
      error: { status: 500, body: { error: { message: 'boom' } } },
    })
    render(<MessageBubble turn={t} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)
    expect(screen.queryByRole('button', { name: '複製回應內容' })).not.toBeInTheDocument()
  })
})

describe('MessageBubble — 編輯重送 / 刪除（自此輪回溯，S5）', () => {
  it('刪除：開啟 ConfirmModal，確認後截斷 store（自此輪回溯）', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 't1' }), turn({ id: 't2', userText: '第二輪' })] })
    render(<MessageBubble turn={turn({ id: 't1' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)

    await user.click(screen.getByRole('button', { name: '刪除此輪及之後' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('刪除此輪及之後？')).toBeInTheDocument()
    expect(useChatStore.getState().turns.length).toBe(2)  // 尚未截斷

    await user.click(screen.getByRole('button', { name: '刪除' }))
    expect(useChatStore.getState().turns).toEqual([])
  })

  it('編輯：確認後回填 composerDraft 為該輪 userText 並截斷', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 't1', userText: '原始輸入' }), turn({ id: 't2' })] })
    render(<MessageBubble turn={turn({ id: 't1', userText: '原始輸入' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)

    await user.click(screen.getByRole('button', { name: '編輯並自此輪重送' }))
    expect(screen.getByText('編輯並自此輪重送？')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '移除並回填' }))

    expect(useChatStore.getState().composerDraft).toBe('原始輸入')
    expect(useChatStore.getState().turns).toEqual([])
  })

  it('取消：turns 不變', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 't1' }), turn({ id: 't2' })] })
    render(<MessageBubble turn={turn({ id: 't1' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled={false} />)

    await user.click(screen.getByRole('button', { name: '刪除此輪及之後' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(useChatStore.getState().turns.length).toBe(2)
  })

  it('生成中（resendDisabled）時 編輯 / 刪除 按鈕 disabled', () => {
    useChatStore.setState({ turns: [turn({ id: 't1' })] })
    render(<MessageBubble turn={turn({ id: 't1' })} isLast={false} expandAll={false} onResend={() => {}} resendDisabled />)
    expect(screen.getByRole('button', { name: '編輯並自此輪重送' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刪除此輪及之後' })).toBeDisabled()
  })
})
