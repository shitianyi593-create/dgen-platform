// src/__tests__/chatRoutes.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from '../components/layout/Header'
import ChatPage from '../components/chat/ChatPage'
import { useChatStore } from '../stores/chatStore'
import { I18nProvider } from '../i18n/I18nProvider'

beforeEach(() => {
  sessionStorage.clear()
  useChatStore.setState({ turns: [], isGenerating: false })
})

describe('Header tabs', () => {
  it('显示 文字生成 分页', () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <I18nProvider initialLocale="zh-CN">
          <Header />
        </I18nProvider>
      </MemoryRouter>,
    )
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toContain('文字生成')
  })
})

describe('ChatPage', () => {
  it('挂载参数面板、工具列、消息区、输入框', () => {
    render(<MemoryRouter initialEntries={['/chat']}><ChatPage /></MemoryRouter>)
    expect(screen.getByText('API 模式')).toBeInTheDocument()                  // ChatParams
    expect(screen.getByText('上下文')).toBeInTheDocument()                    // ChatToolbar
    expect(screen.getByText(/开始对话以测试模型/)).toBeInTheDocument()         // MessageList 空状态
    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument()        // ChatComposer
    expect(screen.getByPlaceholderText('默认 1')).toBeInTheDocument()          // temperature 显示实际默认值
  })

  it('对话进行中 API 模式锁定（radio disabled）', () => {
    useChatStore.setState({
      turns: [{
        id: 'a', apiMode: 'chat', userText: 'q', assistant: { content: 'a' },
        requestBody: {}, timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 1 },
      }],
    })
    render(<MemoryRouter initialEntries={['/chat']}><ChatPage /></MemoryRouter>)
    expect(screen.getByRole('radio', { name: /Chat API/ })).toBeDisabled()
    // 锁定提示出现在 API 模式与系统提示两个栏位（两者同属 cache prefix，一并锁定）。
    // handoff §6：锁定提示缩短为「🔒 对话进行中锁定」。
    expect(screen.getAllByText(/对话进行中锁定/).length).toBeGreaterThanOrEqual(1)
  })
})
