import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmModal from '../components/common/ConfirmModal'

describe('ConfirmModal', () => {
  const baseProps = {
    open: true,
    title: 'Delete asset?',
    confirmLabel: 'Delete',
    variant: 'danger' as const,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders title, subtitle, and meta', () => {
    render(<ConfirmModal {...baseProps} subtitle="2 image · 1 video" meta="~ 1 second" />)
    expect(screen.getByText('Delete asset?')).toBeInTheDocument()
    expect(screen.getByText('2 image · 1 video')).toBeInTheDocument()
    expect(screen.getByText('~ 1 second')).toBeInTheDocument()
  })

  it('does not render when open=false', () => {
    render(<ConfirmModal {...baseProps} open={false} />)
    expect(screen.queryByText('Delete asset?')).not.toBeInTheDocument()
  })

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmModal {...baseProps} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn()
    render(<ConfirmModal {...baseProps} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /取消|Cancel/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onCancel on ESC key', () => {
    const onCancel = vi.fn()
    render(<ConfirmModal {...baseProps} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders thumbs when provided', () => {
    render(
      <ConfirmModal
        {...baseProps}
        thumbs={[{ label: 'IMG', kind: 'image' }, { label: 'VID', kind: 'video' }]}
      />,
    )
    expect(screen.getByText('IMG')).toBeInTheDocument()
    expect(screen.getByText('VID')).toBeInTheDocument()
  })

  it('renders custom body', () => {
    render(<ConfirmModal {...baseProps} body={<div>Failed items list</div>} />)
    expect(screen.getByText('Failed items list')).toBeInTheDocument()
  })

  it('typed confirmation disables confirm until text matches', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmModal
        {...baseProps}
        onConfirm={onConfirm}
        typedConfirmation={{ requiredText: 'mygroup', placeholder: 'Type group name' }}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toBeDisabled()
    const input = screen.getByPlaceholderText('Type group name')
    await userEvent.type(input, 'mygroup')
    expect(btn).not.toBeDisabled()
    await userEvent.click(btn)
    expect(onConfirm).toHaveBeenCalled()
  })
})
