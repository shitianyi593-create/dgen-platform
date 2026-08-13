import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../api/verify', () => ({
  verifyAssetCreds: vi.fn(async () => ({ ok: true, projectName: 'team-a' })),
  verifyTosCreds: vi.fn(async () => ({
    ok: true, steps: { headBucket: 'ok', cors: 'ok', roundTrip: 'ok' }, detail: 'bucket: b',
  })),
}))

import { CredentialSection } from '../components/credentials/CredentialSection'
import { useAuthStore } from '../stores/authStore'

describe('CredentialSection', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({
      apiKey: '', endpoint: '',
      assetCreds: { accessKeyId: '', accessKeySecret: '', projectName: '' },
      tosCreds: {
        accessKeyId: '', accessKeySecret: '',
        region: 'ap-southeast-1',
        bucket: '',
      },
      verifyState: {
        inference: { status: 'pend', message: '尚未驗證' },
        asset: { status: 'pend', message: '尚未驗證' },
        tos: { status: 'pend', message: '尚未驗證' },
      },
    })
  })

  it('shows the section title and hint from schema', () => {
    render(<CredentialSection credKey="asset" expanded={false} onToggle={() => {}} />)
    expect(screen.getByText('私有素材庫憑證')).toBeInTheDocument()
    expect(screen.getByText(/ARK AKSK/)).toBeInTheDocument()
  })

  it('clicking the header invokes onToggle', () => {
    const onToggle = vi.fn()
    render(<CredentialSection credKey="asset" expanded={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /私有素材庫憑證/ }))
    expect(onToggle).toHaveBeenCalledWith('asset')
  })

  it('renders the form only when expanded', () => {
    const { rerender } = render(
      <CredentialSection credKey="asset" expanded={false} onToggle={() => {}} />,
    )
    expect(screen.queryByLabelText('Project Name')).not.toBeInTheDocument()
    rerender(<CredentialSection credKey="asset" expanded={true} onToggle={() => {}} />)
    expect(screen.getByLabelText('Project Name')).toBeInTheDocument()
  })

  it('clicking 測試連線 calls store.verify and shows ok pill on success', async () => {
    useAuthStore.setState({
      assetCreds: { accessKeyId: 'AK', accessKeySecret: 'SK', projectName: 'p' },
    })
    render(<CredentialSection credKey="asset" expanded={true} onToggle={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /測試連線/ }))
    await waitFor(() => {
      expect(useAuthStore.getState().verifyState.asset.status).toBe('ok')
    })
  })

  it('adds the "target" class when target prop is true', () => {
    const { container } = render(
      <CredentialSection credKey="asset" expanded={true} onToggle={() => {}} target />,
    )
    expect(container.querySelector('.cred-section.target')).toBeInTheDocument()
  })

  it('shows 驗證中… and disables the button while a test is in flight', () => {
    useAuthStore.setState({
      verifyState: {
        ...useAuthStore.getState().verifyState,
        asset: { status: 'pend', message: '驗證中…' },
      },
    })
    render(<CredentialSection credKey="asset" expanded={true} onToggle={() => {}} />)
    const btn = screen.getByRole('button', { name: /驗證中…/ }) as HTMLButtonElement
    expect(btn).toBeDisabled()
  })

  it('focuses the first form input when target=true and expanded=true', () => {
    render(
      <CredentialSection credKey="asset" expanded={true} onToggle={() => {}} target />,
    )
    expect(screen.getByLabelText('Access Key ID')).toHaveFocus()
  })

  it('does NOT focus the first form input when target=false', () => {
    render(
      <CredentialSection credKey="asset" expanded={true} onToggle={() => {}} />,
    )
    expect(screen.getByLabelText('Access Key ID')).not.toHaveFocus()
  })

  it('inference section does NOT render the 測試連線 button (live-validation)', () => {
    render(<CredentialSection credKey="inference" expanded={true} onToggle={() => {}} />)
    expect(screen.queryByRole('button', { name: /測試連線/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /驗證中/ })).toBeNull()
  })

  it('asset section still renders the 測試連線 button', () => {
    render(<CredentialSection credKey="asset" expanded={true} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /測試連線/ })).toBeInTheDocument()
  })
})
