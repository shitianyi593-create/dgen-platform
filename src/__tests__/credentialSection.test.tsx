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
import { I18nProvider } from '../i18n/I18nProvider'

function renderSection(props: Parameters<typeof CredentialSection>[0]) {
  return render(
    <I18nProvider initialLocale="zh-CN">
      <CredentialSection {...props} />
    </I18nProvider>,
  )
}

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
    renderSection({ credKey: 'asset', expanded: false, onToggle: () => {} })
    expect(screen.getByText('私有素材库凭证')).toBeInTheDocument()
    expect(screen.getByText(/上传和管理私有素材/)).toBeInTheDocument()
  })

  it('clicking the header invokes onToggle', () => {
    const onToggle = vi.fn()
    renderSection({ credKey: 'asset', expanded: false, onToggle })
    fireEvent.click(screen.getByRole('button', { name: /私有素材库凭证/ }))
    expect(onToggle).toHaveBeenCalledWith('asset')
  })

  it('renders the form only when expanded', () => {
    const { rerender } = render(
      <I18nProvider initialLocale="zh-CN">
        <CredentialSection credKey="asset" expanded={false} onToggle={() => {}} />
      </I18nProvider>,
    )
    expect(screen.queryByLabelText('Project Name')).not.toBeInTheDocument()
    rerender(
      <I18nProvider initialLocale="zh-CN">
        <CredentialSection credKey="asset" expanded={true} onToggle={() => {}} />
      </I18nProvider>,
    )
    expect(screen.getByLabelText('Project Name')).toBeInTheDocument()
  })

  it('clicking 測試連線 calls store.verify and shows ok pill on success', async () => {
    useAuthStore.setState({
      assetCreds: { accessKeyId: 'AK', accessKeySecret: 'SK', projectName: 'p' },
    })
    renderSection({ credKey: 'asset', expanded: true, onToggle: () => {} })
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }))
    await waitFor(() => {
      expect(useAuthStore.getState().verifyState.asset.status).toBe('ok')
    })
  })

  it('adds the "target" class when target prop is true', () => {
    const { container } = render(
      <I18nProvider initialLocale="zh-CN">
        <CredentialSection credKey="asset" expanded={true} onToggle={() => {}} target />
      </I18nProvider>,
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
    renderSection({ credKey: 'asset', expanded: true, onToggle: () => {} })
    const btn = screen.getByRole('button', { name: /驗證中…/ }) as HTMLButtonElement
    expect(btn).toBeDisabled()
  })

  it('focuses the first form input when target=true and expanded=true', () => {
    render(
      <I18nProvider initialLocale="zh-CN">
        <CredentialSection credKey="asset" expanded={true} onToggle={() => {}} target />
      </I18nProvider>,
    )
    expect(screen.getByLabelText('Access Key ID')).toHaveFocus()
  })

  it('does NOT focus the first form input when target=false', () => {
    render(
      <I18nProvider initialLocale="zh-CN">
        <CredentialSection credKey="asset" expanded={true} onToggle={() => {}} />
      </I18nProvider>,
    )
    expect(screen.getByLabelText('Access Key ID')).not.toHaveFocus()
  })

  it('inference section does NOT render the 測試連線 button (live-validation)', () => {
    renderSection({ credKey: 'inference', expanded: true, onToggle: () => {} })
    expect(screen.queryByRole('button', { name: /测试连接/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /驗證中/ })).toBeNull()
  })

  it('asset section still renders the 測試連線 button', () => {
    renderSection({ credKey: 'asset', expanded: true, onToggle: () => {} })
    expect(screen.getByRole('button', { name: /测试连接/ })).toBeInTheDocument()
  })
})
