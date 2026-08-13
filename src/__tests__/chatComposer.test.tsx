// src/__tests__/chatComposer.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatComposer from '../components/chat/ChatComposer'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { useCredentialsUiStore } from '../components/credentials/uiStore'

const VALID_EP = 'ep-20260101000000-txttx'

beforeEach(() => {
  sessionStorage.clear()
  // composerDraft 現為 store-backed；每個測試需從空草稿開始。
  useChatStore.setState({ isGenerating: false, composerDraft: '' })
  // 齊備憑證：除非測試自行清空，否則不出現引導提示、送出鈕可用。
  useAuthStore.setState({ apiKey: 'k', textEndpoint: VALID_EP })
  useCredentialsUiStore.setState({ drawerOpen: false, drawerTarget: null, expandedSection: null })
})

describe('ChatComposer', () => {
  it('Enter：以 trim 後的文字呼叫 onSend 並清空輸入框', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, '  hello world  ')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('hello world')
    expect(textarea.value).toBe('')
  })

  it('Shift+Enter：不送出（換行）', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, 'line one')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toContain('line one')
  })

  it('空白 / 純空白字元：Enter 不送出', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // 完全空的輸入
    await user.click(textarea)
    await user.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    // 純空白字元
    await user.type(textarea, '    ')
    await user.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('缺 API 金鑰：顯示引導提示與「開啟憑證設定」鈕、送出禁用、點擊開抽屜', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ apiKey: '', textEndpoint: VALID_EP })
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByText('請先輸入 API 金鑰')).toBeInTheDocument()
    const sendBtn = screen.getByRole('button', { name: '送出' })
    expect(sendBtn).toBeDisabled()
    const openBtn = screen.getByRole('button', { name: '開啟憑證設定' })
    await user.click(openBtn)
    const ui = useCredentialsUiStore.getState()
    expect(ui.drawerOpen).toBe(true)
    expect(ui.drawerTarget).toBe('inference')
  })

  it('憑證齊備：不顯示引導提示，且 Enter 正常送出', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} />)
    expect(screen.queryByText('請先輸入 API 金鑰')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '開啟憑證設定' })).not.toBeInTheDocument()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, 'hi')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('hi')
  })

  it('生成中：顯示中止鈕，點擊呼叫 onStop', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    useChatStore.setState({ isGenerating: true })
    render(<ChatComposer onSend={vi.fn()} onStop={onStop} />)
    const stopBtn = screen.getByRole('button', { name: /中止/ })
    expect(stopBtn).toBeInTheDocument()
    await user.click(stopBtn)
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
