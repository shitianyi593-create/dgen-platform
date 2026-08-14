import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToastProgress from '../components/common/ToastProgress'

describe('ToastProgress', () => {
  it('renders running state with spinner and progress', () => {
    render(<ToastProgress kind="delete" title="删除中" current={3} total={5} status="running" />)
    expect(screen.getByText('删除中')).toBeInTheDocument()
    expect(screen.getByText('3 / 5')).toBeInTheDocument()
  })

  it('renders success state', () => {
    render(<ToastProgress kind="upload" title="已上传" current={4} total={4} status="success" />)
    expect(screen.getByText('已上传')).toBeInTheDocument()
    expect(screen.getByTestId('toast-status-icon')).toHaveAttribute('data-status', 'success')
  })

  it('renders error state with action button', async () => {
    const onClick = vi.fn()
    render(
      <ToastProgress
        kind="delete"
        title="2 个失败"
        current={3}
        total={5}
        status="error"
        errorAction={{ label: '查看详情', onClick }}
      />,
    )
    expect(screen.getByText('2 个失败')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '查看详情' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('renders subtitle when provided', () => {
    render(
      <ToastProgress
        kind="delete"
        title="已中止"
        current={2}
        total={5}
        status="error"
        subtitle="network timeout after 3 retries"
      />,
    )
    expect(
      screen.getByText('network timeout after 3 retries'),
    ).toBeInTheDocument()
  })

  it('calls onDismiss when dismiss clicked', async () => {
    const onDismiss = vi.fn()
    render(
      <ToastProgress
        kind="generic"
        title="t" current={0} total={1} status="running"
        onDismiss={onDismiss}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
