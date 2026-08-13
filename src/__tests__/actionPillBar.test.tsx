import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActionPillBar from '../components/common/ActionPillBar'

describe('ActionPillBar', () => {
  it('does not render when show=false', () => {
    render(
      <ActionPillBar
        show={false}
        badge="已選 0"
        actions={[{ label: 'do', onClick: vi.fn() }]}
      />,
    )
    expect(screen.queryByText('已選 0')).not.toBeInTheDocument()
  })

  it('renders badge and actions when show=true', () => {
    render(
      <ActionPillBar
        show
        badge="已選 3"
        actions={[
          { label: '全選本頁', onClick: vi.fn() },
          { label: '清除', onClick: vi.fn() },
          { label: '刪除 3 個', onClick: vi.fn(), variant: 'danger' },
        ]}
      />,
    )
    expect(screen.getByText('已選 3')).toBeInTheDocument()
    expect(screen.getByText('全選本頁')).toBeInTheDocument()
    expect(screen.getByText('清除')).toBeInTheDocument()
    expect(screen.getByText('刪除 3 個')).toBeInTheDocument()
  })

  it('fires action onClick', async () => {
    const onClick = vi.fn()
    render(
      <ActionPillBar
        show
        badge="x"
        actions={[{ label: 'fire', onClick }]}
      />,
    )
    await userEvent.click(screen.getByText('fire'))
    expect(onClick).toHaveBeenCalled()
  })

  it('applies danger styling marker via data attribute', () => {
    render(
      <ActionPillBar
        show
        badge="x"
        actions={[{ label: 'kill', onClick: vi.fn(), variant: 'danger' }]}
      />,
    )
    expect(screen.getByText('kill')).toHaveAttribute('data-variant', 'danger')
  })

  it('renders a trash icon inside danger actions only', () => {
    render(
      <ActionPillBar
        show
        badge="x"
        actions={[
          { label: '清除', onClick: vi.fn() },
          { label: '刪除 2 個', onClick: vi.fn(), variant: 'danger' },
        ]}
      />,
    )
    expect(screen.getByText('刪除 2 個').querySelector('svg')).toBeTruthy()
    expect(screen.getByText('清除').querySelector('svg')).toBeNull()
  })
})
