// src/__tests__/promptOptimizeModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PromptOptimizeModal from '../components/video25/PromptOptimizeModal'

const baseProps = {
  open: true,
  loading: false,
  error: undefined as string | undefined,
  taskType: 'reference' as const,
  originalPrompt: '原文 prompt',
  optimizedPrompt: '優化後 prompt',
  fixNote: null as string | null,
  onConfirm: vi.fn(),
  onUseOriginal: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
}

describe('PromptOptimizeModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<PromptOptimizeModal {...baseProps} open={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows loading state', () => {
    render(<PromptOptimizeModal {...baseProps} loading />)
    expect(screen.getByText('正在優化提示詞…')).toBeInTheDocument()
  })

  it('editable textarea confirms with the edited text', () => {
    const onConfirm = vi.fn()
    render(<PromptOptimizeModal {...baseProps} onConfirm={onConfirm} />)
    const ta = screen.getByLabelText('優化後提示詞') as HTMLTextAreaElement
    expect(ta.value).toBe('優化後 prompt')
    fireEvent.change(ta, { target: { value: '手動再改過' } })
    fireEvent.click(screen.getByRole('button', { name: '確認生成' }))
    expect(onConfirm).toHaveBeenCalledWith('手動再改過')
  })

  it('use-original and cancel fire their callbacks', () => {
    const onUseOriginal = vi.fn()
    const onCancel = vi.fn()
    render(<PromptOptimizeModal {...baseProps} onUseOriginal={onUseOriginal} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '用原文生成' }))
    expect(onUseOriginal).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows task type badge and fix note', () => {
    render(<PromptOptimizeModal {...baseProps} taskType="edit" fixNote="長度已自動改為 Auto（此任務類型鎖定）" />)
    expect(screen.getByText('影片編輯')).toBeInTheDocument()
    expect(screen.getByText(/長度已自動改為 Auto/)).toBeInTheDocument()
  })

  it('error state offers retry / use original / cancel, hides confirm', () => {
    const onRetry = vi.fn()
    render(<PromptOptimizeModal {...baseProps} error="LLM timeout" onRetry={onRetry} />)
    expect(screen.getByText(/LLM timeout/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '確認生成' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重試' }))
    expect(onRetry).toHaveBeenCalled()
  })

  // 關閉時元件只 return null 而未卸載，state 會存活到下次開啟。
  it('discards last session edits when reopened with the same optimized prompt', () => {
    const { rerender } = render(<PromptOptimizeModal {...baseProps} />)
    const ta = () => screen.getByLabelText('優化後提示詞') as HTMLTextAreaElement

    fireEvent.change(ta(), { target: { value: '上一輪已放棄的手動編輯' } })
    fireEvent.click(screen.getByRole('button', { name: '對照原文' }))
    expect(ta().value).toBe('上一輪已放棄的手動編輯')
    expect(screen.getByText('原文 prompt')).toBeInTheDocument()

    rerender(<PromptOptimizeModal {...baseProps} open={false} />)
    rerender(<PromptOptimizeModal {...baseProps} open />)

    expect(ta().value).toBe('優化後 prompt')
    expect(screen.getByRole('button', { name: '對照原文' })).toBeInTheDocument()
    expect(screen.queryByText('原文 prompt')).not.toBeInTheDocument()
  })

  it('loading state is exitable by Escape and by the cancel button', () => {
    const onCancel = vi.fn()
    render(<PromptOptimizeModal {...baseProps} loading onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('error takes precedence over loading', () => {
    render(<PromptOptimizeModal {...baseProps} loading error="LLM timeout" />)
    expect(screen.getByText(/LLM timeout/)).toBeInTheDocument()
    expect(screen.queryByText('正在優化提示詞…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '確認生成' })).not.toBeInTheDocument()
  })
})
