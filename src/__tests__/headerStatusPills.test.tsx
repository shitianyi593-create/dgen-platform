import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HeaderStatusPills } from '../components/credentials/HeaderStatusPills'
import { useAuthStore } from '../stores/authStore'

describe('HeaderStatusPills', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({
      verifyState: {
        inference: { status: 'ok', message: 'ok' },
        asset: { status: 'warn', message: 'bad keys' },
        tos: { status: 'pend', message: '尚未驗證' },
      },
    })
  })

  it('renders three pills with the schema short labels', () => {
    render(<HeaderStatusPills onPillClick={() => {}} />)
    expect(screen.getByRole('button', { name: /推論/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /素材庫/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TOS/ })).toBeInTheDocument()
  })

  it('reflects current verifyState status via data-state attribute', () => {
    render(<HeaderStatusPills onPillClick={() => {}} />)
    const inference = screen.getByRole('button', { name: /推論/ })
    const asset = screen.getByRole('button', { name: /素材庫/ })
    const tos = screen.getByRole('button', { name: /TOS/ })
    expect(inference.dataset.state).toBe('ok')
    expect(asset.dataset.state).toBe('warn')
    expect(tos.dataset.state).toBe('pend')
  })

  it('hidden a11y span combines full credential label with status text', () => {
    render(<HeaderStatusPills onPillClick={() => {}} />)
    expect(screen.getByLabelText('推論憑證 已驗證')).toBeInTheDocument()
    expect(screen.getByLabelText('私有素材庫憑證 失敗')).toBeInTheDocument()
    expect(screen.getByLabelText('物件儲存憑證 未驗證')).toBeInTheDocument()
  })

  it('clicking a pill fires onPillClick with the credKey', () => {
    const onPillClick = vi.fn()
    render(<HeaderStatusPills onPillClick={onPillClick} />)
    fireEvent.click(screen.getByRole('button', { name: /素材庫/ }))
    expect(onPillClick).toHaveBeenCalledWith('asset')
  })
})
