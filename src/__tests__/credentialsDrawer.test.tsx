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
    render(<CredentialsDrawer />)
    expect(screen.getByText('推論憑證')).toBeInTheDocument()
    expect(screen.getByText('私有素材庫憑證')).toBeInTheDocument()
    expect(screen.getByText('物件儲存憑證')).toBeInTheDocument()
  })

  it('applies the "open" class when drawerOpen is true', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    const { container } = render(<CredentialsDrawer />)
    expect(container.querySelector('.cred-drawer.open')).toBeInTheDocument()
  })

  it('does not have the "open" class when drawerOpen is false', () => {
    const { container } = render(<CredentialsDrawer />)
    expect(container.querySelector('.cred-drawer.open')).not.toBeInTheDocument()
  })

  it('auto-expands the section matching drawerTarget', () => {
    useCredentialsUiStore.setState({
      drawerOpen: true,
      drawerTarget: 'tos',
      expandedSection: 'tos',
    })
    render(<CredentialsDrawer />)
    expect(screen.getByLabelText('Bucket')).toBeInTheDocument()
  })

  it('only one section is expanded at a time — clicking another collapses the first', () => {
    useCredentialsUiStore.setState({ drawerOpen: true, expandedSection: 'inference' })
    render(<CredentialsDrawer />)
    expect(screen.getByLabelText('API 金鑰')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /私有素材庫憑證/ }))
    expect(screen.queryByLabelText('API 金鑰')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Project Name')).toBeInTheDocument()
  })

  it('clicking the close button calls closeDrawer', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    render(<CredentialsDrawer />)
    fireEvent.click(screen.getByLabelText('關閉憑證設定'))
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
  })

  it('clicking the backdrop calls closeDrawer', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    const { container } = render(<CredentialsDrawer />)
    const backdrop = container.querySelector('.cred-drawer-backdrop') as HTMLElement
    fireEvent.click(backdrop)
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
  })

  it('Esc key closes the drawer', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    render(<CredentialsDrawer />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
  })

  it('closeDrawer resets expandedSection (so reopening without a target shows nothing expanded)', () => {
    useCredentialsUiStore.setState({
      drawerOpen: true,
      expandedSection: 'inference',
    })
    render(<CredentialsDrawer />)
    fireEvent.click(screen.getByLabelText('關閉憑證設定'))
    expect(useCredentialsUiStore.getState().drawerOpen).toBe(false)
    expect(useCredentialsUiStore.getState().expandedSection).toBeNull()
  })

  it('aside has inert attribute when drawer is closed', () => {
    const { container } = render(<CredentialsDrawer />)
    const aside = container.querySelector('.cred-drawer') as HTMLElement
    expect(aside.hasAttribute('inert')).toBe(true)
  })

  it('aside has no inert attribute when drawer is open', () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    const { container } = render(<CredentialsDrawer />)
    const aside = container.querySelector('.cred-drawer') as HTMLElement
    expect(aside.hasAttribute('inert')).toBe(false)
  })
})
