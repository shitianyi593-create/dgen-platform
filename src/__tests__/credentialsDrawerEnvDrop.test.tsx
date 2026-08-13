import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('../api/verify', () => ({
  verifyAssetCreds: vi.fn(async () => ({ ok: true, projectName: 'p' })),
  verifyTosCreds: vi.fn(async () => ({
    ok: true,
    steps: { headBucket: 'ok', cors: 'ok', roundTrip: 'ok' },
  })),
}))

import { CredentialsDrawer } from '../components/credentials/CredentialsDrawer'
import { useCredentialsUiStore } from '../components/credentials/uiStore'
import { useAuthStore } from '../stores/authStore'

function makeDropEvent(file: File): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: [file], items: [{ kind: 'file' }] },
  })
  return event
}

const flush = () => new Promise((r) => setTimeout(r, 0))

const FULL_ENV = [
  'ARK_API_KEY=00000000-0000-0000-0000-000000000000',
  'ARK_ENDPOINT_ID=ep-20240101000000-aaaaa',
  'BYTEPLUS_AK=asset-ak',
  'BYTEPLUS_SK=asset-sk',
  'BYTEPLUS_PROJECT_NAME=proj-x',
  'TOS_ACCESS_KEY=tos-ak',
  'TOS_SECRET_KEY=tos-sk',
  'TOS_REGION=ap-southeast-1',
  'TOS_BUCKET=my-bucket',
].join('\n')

describe('CredentialsDrawer env drop', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useCredentialsUiStore.setState({
      drawerOpen: false,
      drawerTarget: null,
      expandedSection: null,
    })
    useAuthStore.setState({
      apiKey: '',
      endpoint: '',
      assetCreds: { accessKeyId: '', accessKeySecret: '', projectName: 'default' },
      tosCreds: { accessKeyId: '', accessKeySecret: '', region: 'ap-southeast-1', bucket: '' },
    })
  })

  it('drops a full .env with the drawer OPEN → store gets populated', async () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    render(<CredentialsDrawer />)
    const file = new File([FULL_ENV], '.env', { type: 'text/plain' })
    const ev = makeDropEvent(file)
    await act(async () => {
      document.dispatchEvent(ev)
      await flush()
    })
    expect(ev.defaultPrevented).toBe(true)
    const s = useAuthStore.getState()
    expect(s.apiKey).toBe('00000000-0000-0000-0000-000000000000')
    expect(s.endpoint).toBe('ep-20240101000000-aaaaa')
    expect(s.assetCreds.accessKeyId).toBe('asset-ak')
    expect(s.tosCreds.bucket).toBe('my-bucket')
  })

  it('drops .env with the drawer CLOSED → store unchanged', async () => {
    render(<CredentialsDrawer />)
    const file = new File([FULL_ENV], '.env', { type: 'text/plain' })
    await act(async () => {
      document.dispatchEvent(makeDropEvent(file))
      await flush()
    })
    expect(useAuthStore.getState().tosCreds.bucket).toBe('')
  })

  it('drops an oversized file → store unchanged', async () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    render(<CredentialsDrawer />)
    const huge = 'TOS_BUCKET=mybucket\n' + 'x'.repeat(70_000)
    const file = new File([huge], '.env', { type: 'text/plain' })
    await act(async () => {
      document.dispatchEvent(makeDropEvent(file))
      await flush()
    })
    expect(useAuthStore.getState().tosCreds.bucket).toBe('')
  })

  it('drops a file whose content matches no aliases → store unchanged', async () => {
    useCredentialsUiStore.setState({ drawerOpen: true })
    render(<CredentialsDrawer />)
    const file = new File(['SOME_OTHER_KEY=irrelevant'], '.env', { type: 'text/plain' })
    await act(async () => {
      document.dispatchEvent(makeDropEvent(file))
      await flush()
    })
    expect(useAuthStore.getState().apiKey).toBe('')
    expect(useAuthStore.getState().tosCreds.bucket).toBe('')
  })

  it('drops only a TOS subset → asset/inference stay untouched', async () => {
    useAuthStore.setState({
      apiKey: 'pre-existing',
      endpoint: '',
      assetCreds: { accessKeyId: 'asset-pre', accessKeySecret: '', projectName: 'default' },
      tosCreds: { accessKeyId: '', accessKeySecret: '', region: 'ap-southeast-1', bucket: '' },
    })
    useCredentialsUiStore.setState({ drawerOpen: true })
    render(<CredentialsDrawer />)
    const file = new File(['TOS_BUCKET=only-bucket'], '.env', { type: 'text/plain' })
    await act(async () => {
      document.dispatchEvent(makeDropEvent(file))
      await flush()
    })
    const s = useAuthStore.getState()
    expect(s.tosCreds.bucket).toBe('only-bucket')
    expect(s.apiKey).toBe('pre-existing')
    expect(s.assetCreds.accessKeyId).toBe('asset-pre')
  })
})
