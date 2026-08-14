// src/__tests__/chatToolbar.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatToolbar from '../components/chat/ChatToolbar'
import { useChatStore } from '../stores/chatStore'
import type { ChatTurn } from '../types/chat'

vi.mock('../utils/chatExport', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../utils/chatExport')>()
  return { ...orig, downloadChatExport: vi.fn() }
})
import { downloadChatExport } from '../utils/chatExport'

function turn(over: Partial<ChatTurn>): ChatTurn {
  return {
    id: 't', apiMode: 'chat', userText: 'q', assistant: { content: 'a' },
    requestBody: {}, timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 1 },
    ...over,
  }
}

beforeEach(() => {
  sessionStorage.clear()
  useChatStore.setState({ turns: [], isGenerating: false, expandAll: false })
})

describe('ChatToolbar', () => {
  it('无对话：统计显示 —、下载钮 disabled', () => {
    render(<ChatToolbar />)
    expect(screen.getByText('上下文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /下载 JSON/ })).toBeDisabled()
  })

  it('有 usage：显示上下文 / 累计 / 命中率', () => {
    useChatStore.setState({
      turns: [
        turn({ id: 'a', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110, cachedTokens: 0, reasoningTokens: 0 } }),
        turn({ id: 'b', usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220, cachedTokens: 100, reasoningTokens: 0 } }),
      ],
    })
    render(<ChatToolbar />)
    expect(screen.getByText(/200/)).toBeInTheDocument()        // 上下文 = 最后一轮 prompt
    expect(screen.getByText(/330/)).toBeInTheDocument()        // 累计 total
    expect(screen.getByText(/33\.3%/)).toBeInTheDocument()     // 100/300
  })

  it('下载钮呼叫 downloadChatExport', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 'a' })] })
    render(<ChatToolbar />)
    await user.click(screen.getByRole('button', { name: /下载 JSON/ }))
    expect(vi.mocked(downloadChatExport)).toHaveBeenCalled()
  })

  it('新对话：ConfirmModal 确认后清空 turns', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ turns: [turn({ id: 'a' })] })
    render(<ChatToolbar />)
    await user.click(screen.getByRole('button', { name: /新对话/ }))
    await user.click(screen.getByRole('button', { name: /^清空$/ }))
    expect(useChatStore.getState().turns).toEqual([])
  })

  it('全部展开/收起 切换 expandAll', async () => {
    const user = userEvent.setup()
    render(<ChatToolbar />)
    await user.click(screen.getByRole('button', { name: /全部展开/ }))
    expect(useChatStore.getState().expandAll).toBe(true)
  })
})
