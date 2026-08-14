import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../api/verify', () => ({
  verifyAssetCreds: vi.fn(async () => ({ ok: true, projectName: 'p' })),
  verifyTosCreds: vi.fn(async () => ({
    ok: true, steps: { headBucket: 'ok', cors: 'ok', roundTrip: 'ok' },
  })),
}))

import { CredentialsDrawer } from '../components/credentials/CredentialsDrawer'
import { useCredentialsUiStore } from '../components/credentials/uiStore'
import { I18nProvider } from '../i18n/I18nProvider'

function renderDrawer(initialLocale: 'zh-CN' | 'en-US' = 'zh-CN') {
  return render(
    <I18nProvider initialLocale={initialLocale}>
      <CredentialsDrawer />
    </I18nProvider>,
  )
}

describe('CredentialsDrawer', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useCredentialsUiStore.setState({
      drawerOpen: false,
      drawerTarget: null,
      expandedSection: null,
    })
  })

  it('renders three sections', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    renderDrawer()
    expect(screen.getByText('模型服务凭证')).toBeInTheDocument()
    expect(screen.getByText('私有素材库凭证')).toBeInTheDocument()
    expect(screen.getByText('对象存储凭证')).toBeInTheDocument()
    expect(screen.getByText(/凭证仅保存在当前浏览器标签页会话中/)).toBeInTheDocument()
  })

  it('renders neutral credential copy in English', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    renderDrawer('en-US')
    expect(screen.getByText('Model Service Credentials')).toBeInTheDocument()
    expect(screen.getByText('Private Asset Library Credentials')).toBeInTheDocument()
    expect(screen.getByText('Object Storage Credentials')).toBeInTheDocument()
    expect(screen.getByText(/current browser tab session/)).toBeInTheDocument()
  })

  it('applies the "open" class when drawerOpen is true', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    const { container } = renderDrawer()
    expect(container.querySelector('.cred-drawer.open')).toBeInTheDocument()
  })

  it('does not have the "open" class when drawerOpen is false', () => {
    const { container } = renderDrawer()
    expect(container.querySelector('.cred-drawer.open')).not.toBeInTheDocument()
  })

  it('auto-expands the section matching drawerTarget', () => {
    useCredentialsUiStore.setState({
      drawerOpen: true,
      drawerTarget: 'tos',
      expandedSection: 'tos',
    })
    renderDrawer()
    expect(screen.getByLabelText('存储桶')).toBeInTheDocument()
  })

  it('only one section is expanded at a time — clicking another collapses the first', () => {
    useCredentialsUiStore.setState({ drawerOpen: true, expandedSection: 'inference' })
    renderDrawer()
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /私有素材库凭证/ }))
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Project Name')).toBeInTheDocument()
  })

  it('clicking the close button calls closeDrawer', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    renderDrawer()
    fireEvent.click(screen.getByLabelText('关闭凭证设置'))
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
  })

  it('clicking the backdrop calls closeDrawer', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    const { container } = renderDrawer()
    const backdrop = container.querySelector('.cred-drawer-backdrop') as HTMLElement
    fireEvent.click(backdrop)
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
  })

  it('Esc key closes the drawer', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    renderDrawer()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
  })

  it('closeDrawer resets expandedSection (so reopening without a target shows nothing expanded)', () => {
    useCredentialsUiStore.setState({
      drawerOpen: true,
      expandedSection: 'inference',
    })
    renderDrawer()
    fireEvent.click(screen.getByLabelText('关闭凭证设置'))
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
    expect(useCredentialsUiStore.getState().expandedSection).toBeNull()
  })

  it('aside has inert attribute when drawer is closed', () => {
    const { container } = renderDrawer()
    const aside = container.querySelector('.cred-drawer') as HTMLElement
    expect(aside.hasAttribute('inert')).toBe(true)
  })

  it('aside has no inert attribute when drawer is open', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    const { container } = renderDrawer()
    const aside = container.querySelector('.cred-drawer') as HTMLElement
    expect(aside.hasAttribute('inert')).toBe(false)
  })
})
