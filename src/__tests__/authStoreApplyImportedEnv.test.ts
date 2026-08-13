import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api/verify', () => ({
  verifyAssetCreds: vi.fn(async () => ({ ok: true, projectName: 'proj-x' })),
  verifyTosCreds: vi.fn(async () => ({
    ok: true,
    steps: { headBucket: 'ok', cors: 'ok', roundTrip: 'ok' },
    detail: 'bucket: my-bucket',
  })),
}))

let _seq = 0
const freshStore = () => import('../stores/authStore?t=' + Date.now() + '_' + ++_seq)

describe('authStore.applyImportedEnv', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('writes inference fields and computes inference verifyState locally', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().applyImportedEnv({
      inference: {
        apiKey: '00000000-0000-0000-0000-000000000000',
        endpoint: 'ep-20240101000000-aaaaa',
      },
    })
    const s = store.getState()
    expect(s.apiKey).toBe('00000000-0000-0000-0000-000000000000')
    expect(s.endpoint).toBe('ep-20240101000000-aaaaa')
    expect(s.verifyState.inference.status).toBe('ok')
  })

  it('writes asset partial AND fires verifyAssetCreds', async () => {
    const mod = await freshStore()
    const { verifyAssetCreds } = await import('../api/verify')
    const store = mod.useAuthStore
    store.getState().applyImportedEnv({
      asset: { accessKeyId: 'a', accessKeySecret: 's', projectName: 'proj-x' },
    })
    expect(store.getState().assetCreds).toEqual({
      accessKeyId: 'a', accessKeySecret: 's', projectName: 'proj-x',
    })
    // verify is fire-and-forget; flush microtasks
    await new Promise((r) => setTimeout(r, 0))
    expect(verifyAssetCreds).toHaveBeenCalledTimes(1)
  })

  it('writes tos partial AND fires verifyTosCreds', async () => {
    const mod = await freshStore()
    const { verifyTosCreds } = await import('../api/verify')
    const store = mod.useAuthStore
    store.getState().applyImportedEnv({
      tos: { accessKeyId: 'a', accessKeySecret: 's', region: 'ap-southeast-1', bucket: 'my-bucket' },
    })
    expect(store.getState().tosCreds.bucket).toBe('my-bucket')
    await new Promise((r) => setTimeout(r, 0))
    expect(verifyTosCreds).toHaveBeenCalledTimes(1)
  })

  it('leaves untouched groups completely alone (no verify call, no state churn)', async () => {
    const mod = await freshStore()
    const { verifyAssetCreds, verifyTosCreds } = await import('../api/verify')
    const store = mod.useAuthStore
    // Pre-seed asset with a known value and verifyState
    store.getState().setField('asset', 'projectName', 'preexisting')
    vi.clearAllMocks()
    // Now import only tos
    store.getState().applyImportedEnv({
      tos: { bucket: 'b' },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(store.getState().assetCreds.projectName).toBe('preexisting')
    expect(verifyAssetCreds).not.toHaveBeenCalled()
    expect(verifyTosCreds).toHaveBeenCalledTimes(1)
  })

  it('merges partial into existing assetCreds without dropping non-mentioned fields', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('asset', 'projectName', 'keep-me')
    store.getState().applyImportedEnv({
      asset: { accessKeyId: 'new-ak' },
    })
    const a = store.getState().assetCreds
    expect(a.accessKeyId).toBe('new-ak')
    expect(a.projectName).toBe('keep-me')
  })
})
