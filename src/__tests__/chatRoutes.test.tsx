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
  it('掛載參數面板、工具列、訊息區、輸入框', () => {
    render(<MemoryRouter initialEntries={['/chat']}><ChatPage /></MemoryRouter>)
    expect(screen.getByText('API 模式')).toBeInTheDocument()                  // ChatParams
    expect(screen.getByText('上下文')).toBeInTheDocument()                    // ChatToolbar
    expect(screen.getByText(/開始對話以測試模型/)).toBeInTheDocument()         // MessageList 空狀態
    expect(screen.getByPlaceholderText(/輸入訊息/)).toBeInTheDocument()        // ChatComposer
    expect(screen.getByPlaceholderText('預設 1')).toBeInTheDocument()          // temperature 顯示實際預設值
  })

  it('對話進行中 API 模式鎖定（radio disabled）', () => {
    useChatStore.setState({
      turns: [{
        id: 'a', apiMode: 'chat', userText: 'q', assistant: { content: 'a' },
        requestBody: {}, timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 1 },
      }],
    })
    render(<MemoryRouter initialEntries={['/chat']}><ChatPage /></MemoryRouter>)
    expect(screen.getByRole('radio', { name: /Chat API/ })).toBeDisabled()
    // 鎖定提示出現在 API 模式與系統提示兩個欄位（兩者同屬 cache prefix，一併鎖定）。
    // handoff §6：鎖定提示縮短為「🔒 對話進行中鎖定」。
    expect(screen.getAllByText(/對話進行中鎖定/).length).toBeGreaterThanOrEqual(1)
  })
})
