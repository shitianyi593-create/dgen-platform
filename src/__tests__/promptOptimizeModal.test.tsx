// src/__tests__/promptOptimizeModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PromptOptimizeModal from '../components/video25/PromptOptimizeModal'
import { messages } from '../i18n/locales'

const t = messages['zh-CN']

const baseProps = {
  open: true,
  loading: false,
  error: undefined as string | undefined,
  taskType: 'reference' as const,
  originalPrompt: '原文 prompt',
  optimizedPrompt: '优化后 prompt',
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
    expect(screen.getByText(t['video25.optimize.optimizing'])).toBeInTheDocument()
  })

  it('editable textarea confirms with the edited text', () => {
    const onConfirm = vi.fn()
    render(<PromptOptimizeModal {...baseProps} onConfirm={onConfirm} />)
    const ta = screen.getByLabelText(t['video25.optimize.optimizedPrompt']) as HTMLTextAreaElement
    expect(ta.value).toBe('优化后 prompt')
    fireEvent.change(ta, { target: { value: '手动再改过' } })
    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.confirmGenerate'] }))
    expect(onConfirm).toHaveBeenCalledWith('手动再改过')
  })

  it('use-original and cancel fire their callbacks', () => {
    const onUseOriginal = vi.fn()
    const onCancel = vi.fn()
    render(<PromptOptimizeModal {...baseProps} onUseOriginal={onUseOriginal} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.useOriginal'] }))
    expect(onUseOriginal).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t['common.cancel'] }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows task type badge and fix note', () => {
    render(<PromptOptimizeModal {...baseProps} taskType="edit" fixNote={t['video25.optimize.fixDuration']} />)
    expect(screen.getByText(t['video25.taskType.edit'])).toBeInTheDocument()
    expect(screen.getByText(/长度已自动改为 Auto/)).toBeInTheDocument()
  })

  it('error state offers retry / use original / cancel, hides confirm', () => {
    const onRetry = vi.fn()
    render(<PromptOptimizeModal {...baseProps} error="LLM timeout" onRetry={onRetry} />)
    expect(screen.getByText(/LLM timeout/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t['video25.optimize.confirmGenerate'] })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t['common.retry'] }))
    expect(onRetry).toHaveBeenCalled()
  })

  // 关闭时组件只 return null 而未卸载，state 会存活到下次打开。
  it('discards last session edits when reopened with the same optimized prompt', () => {
    const { rerender } = render(<PromptOptimizeModal {...baseProps} />)
    const ta = () => screen.getByLabelText(t['video25.optimize.optimizedPrompt']) as HTMLTextAreaElement

    fireEvent.change(ta(), { target: { value: '上一轮已放弃的手动编辑' } })
    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.compareOriginal'] }))
    expect(ta().value).toBe('上一轮已放弃的手动编辑')
    expect(screen.getByText('原文 prompt')).toBeInTheDocument()

    rerender(<PromptOptimizeModal {...baseProps} open={false} />)
    rerender(<PromptOptimizeModal {...baseProps} open />)

    expect(ta().value).toBe('优化后 prompt')
    expect(screen.getByRole('button', { name: t['video25.optimize.compareOriginal'] })).toBeInTheDocument()
    expect(screen.queryByText('原文 prompt')).not.toBeInTheDocument()
  })

  it('loading state is exitable by Escape and by the cancel button', () => {
    const onCancel = vi.fn()
    render(<PromptOptimizeModal {...baseProps} loading onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: t['common.cancel'] }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('error takes precedence over loading', () => {
    render(<PromptOptimizeModal {...baseProps} loading error="LLM timeout" />)
    expect(screen.getByText(/LLM timeout/)).toBeInTheDocument()
    expect(screen.queryByText(t['video25.optimize.optimizing'])).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t['video25.optimize.confirmGenerate'] })).not.toBeInTheDocument()
  })
})
