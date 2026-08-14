import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HeaderStatusPills } from '../components/credentials/HeaderStatusPills'
import { useAuthStore } from '../stores/authStore'
import { I18nProvider } from '../i18n/I18nProvider'

function renderPills(initialLocale: 'zh-CN' | 'en-US' = 'zh-CN', onPillClick = () => {}) {
  return render(
    <I18nProvider initialLocale={initialLocale}>
      <HeaderStatusPills onPillClick={onPillClick} />
    </I18nProvider>,
  )
}

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
    renderPills()
    expect(screen.getByRole('button', { name: /模型服务/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /素材库/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /对象存储/ })).toBeInTheDocument()
  })

  it('renders English pill labels', () => {
    renderPills('en-US')
    expect(screen.getByRole('button', { name: /Model Service/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assets/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Object Storage/ })).toBeInTheDocument()
  })

  it('reflects current verifyState status via data-state attribute', () => {
    renderPills()
    const inference = screen.getByRole('button', { name: /模型服务/ })
    const asset = screen.getByRole('button', { name: /素材库/ })
    const tos = screen.getByRole('button', { name: /对象存储/ })
    expect(inference.dataset.state).toBe('ok')
    expect(asset.dataset.state).toBe('warn')
    expect(tos.dataset.state).toBe('pend')
  })

  it('hidden a11y span combines full credential label with status text', () => {
    renderPills()
    expect(screen.getByLabelText('模型服务凭证 已验证')).toBeInTheDocument()
    expect(screen.getByLabelText('私有素材库凭证 失败')).toBeInTheDocument()
    expect(screen.getByLabelText('对象存储凭证 未验证')).toBeInTheDocument()
  })

  it('clicking a pill fires onPillClick with the credKey', () => {
    const onPillClick = vi.fn()
    renderPills('zh-CN', onPillClick)
    fireEvent.click(screen.getByRole('button', { name: /素材库/ }))
    expect(onPillClick).toHaveBeenCalledWith('asset')
  })
})
