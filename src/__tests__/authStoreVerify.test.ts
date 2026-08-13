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

describe('authStore.verifyState', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('initializes verifyState entries to pend', async () => {
    const mod = await freshStore()
    const s = mod.useAuthStore.getState()
    expect(s.verifyState.inference.status).toBe('pend')
    expect(s.verifyState.asset.status).toBe('pend')
    expect(s.verifyState.tos.status).toBe('pend')
  })

  it('setField (inference, apiKey) updates apiKey AND triggers live validation (warn for bad format)', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('inference', 'apiKey', 'too-short-not-a-uuid')
    const s = store.getState()
    expect(s.apiKey).toBe('too-short-not-a-uuid')
    expect(s.verifyState.inference.status).toBe('warn')
    expect(s.verifyState.inference.message).toMatch(/API 金鑰/)
  })

  it('setField (inference) with both fields blank → status pend', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    // First put something in then clear it — both fields end up blank
    store.getState().setField('inference', 'apiKey', '00000000-0000-0000-0000-000000000000')
    store.getState().setField('inference', 'apiKey', '')
    expect(store.getState().verifyState.inference.status).toBe('pend')
  })

  it('setField (inference) with both valid → status ok', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('inference', 'apiKey', '00000000-0000-0000-0000-000000000000')
    store.getState().setField('inference', 'endpoint', 'ep-20240101000000-aaaaa')
    expect(store.getState().verifyState.inference.status).toBe('ok')
  })

  it('setField (asset, projectName) updates assetCreds.projectName AND resets verifyState.asset', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('asset', 'projectName', 'team-a')
    expect(store.getState().assetCreds.projectName).toBe('team-a')
    expect(store.getState().verifyState.asset.status).toBe('pend')
  })

  it('setField (tos, bucket) updates tosCreds.bucket AND resets verifyState.tos', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('tos', 'bucket', 'my-bucket')
    expect(store.getState().tosCreds.bucket).toBe('my-bucket')
    expect(store.getState().verifyState.tos.status).toBe('pend')
  })

  it('verify("inference") flips to ok with real BytePlus formats (UUID api key + ep-... endpoint)', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('inference', 'apiKey', '00000000-0000-0000-0000-000000000000')
    store.getState().setField('inference', 'endpoint', 'ep-20240101000000-aaaaa')
    await store.getState().verify('inference')
    expect(store.getState().verifyState.inference.status).toBe('ok')
    expect(typeof store.getState().verifyState.inference.lastTestedAt).toBe('number')
  })

  it('verify("inference") accepts UUID API key', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('inference', 'apiKey', '00000000-0000-0000-0000-000000000000')
    store.getState().setField('inference', 'endpoint', 'ep-20240101000000-bbbbb')
    await store.getState().verify('inference')
    expect(store.getState().verifyState.inference.status).toBe('ok')
  })

  it('verify("inference") flips to warn when API key has wrong format', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('inference', 'apiKey', 'random-string-not-uuid')
    store.getState().setField('inference', 'endpoint', 'ep-20240101000000-aaaaa')
    await store.getState().verify('inference')
    expect(store.getState().verifyState.inference.status).toBe('warn')
    expect(store.getState().verifyState.inference.message).toMatch(/API 金鑰/)
  })

  it('verify("inference") flips to warn when endpoint has wrong format', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('inference', 'apiKey', '00000000-0000-0000-0000-000000000000')
    store.getState().setField('inference', 'endpoint', 'not-an-ep-format')
    await store.getState().verify('inference')
    expect(store.getState().verifyState.inference.status).toBe('warn')
    expect(store.getState().verifyState.inference.message).toMatch(/接入點/)
  })

  it('verify("asset") on success writes ok with projectName as message', async () => {
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('asset', 'accessKeyId', 'AK')
    store.getState().setField('asset', 'accessKeySecret', 'SK')
    store.getState().setField('asset', 'projectName', 'p')
    await store.getState().verify('asset')
    const s = store.getState()
    expect(s.verifyState.asset.status).toBe('ok')
    expect(s.verifyState.asset.message).toContain('proj-x')
  })

  it('verify("asset") sets pending message before resolution', async () => {
    const verifyMod = await import('../api/verify')
    let resolveFn: ((v: unknown) => void) | undefined
    const pending = new Promise((r) => { resolveFn = r })
    ;(verifyMod.verifyAssetCreds as unknown as { mockImplementationOnce: (fn: () => Promise<unknown>) => void })
      .mockImplementationOnce(() => pending as Promise<{ ok: true; projectName: string }>)

    const mod = await freshStore()
    const store = mod.useAuthStore
    const p = store.getState().verify('asset')
    // After verify is called but before the inner promise resolves
    expect(store.getState().verifyState.asset.status).toBe('pend')
    expect(store.getState().verifyState.asset.message).toBe('驗證中…')
    resolveFn!({ ok: true, projectName: 'p' })
    await p
    expect(store.getState().verifyState.asset.status).toBe('ok')
  })

  it('verify("tos") on failure writes warn with the api error message', async () => {
    const verifyMod = await import('../api/verify')
    ;(verifyMod.verifyTosCreds as unknown as { mockImplementationOnce: (fn: () => Promise<unknown>) => void })
      .mockImplementationOnce(async () => ({
        ok: false, failingStep: 'headBucket', message: 'bucket not found',
      }))
    const mod = await freshStore()
    const store = mod.useAuthStore
    await store.getState().verify('tos')
    const s = store.getState()
    expect(s.verifyState.tos.status).toBe('warn')
    expect(s.verifyState.tos.message).toBe('bucket not found')
  })

  it('verify("tos") with bucket/prefix syntax sends only the pure bucket to the verify route', async () => {
    const verifyMod = await import('../api/verify')
    const verifyTosSpy = verifyMod.verifyTosCreds as unknown as {
      mockResolvedValueOnce: (v: unknown) => void
      mock: { calls: unknown[][] }
    }
    verifyTosSpy.mockResolvedValueOnce({
      ok: true,
      steps: { headBucket: 'ok', cors: 'already-configured', roundTrip: 'ok' },
      detail: 'bucket: mybucket',
    })
    const mod = await freshStore()
    const store = mod.useAuthStore
    store.getState().setField('tos', 'accessKeyId', 'AK')
    store.getState().setField('tos', 'accessKeySecret', 'SK')
    store.getState().setField('tos', 'bucket', 'mybucket/foo/bar')
    await store.getState().verify('tos')
    const callArg = verifyTosSpy.mock.calls.at(-1)?.[0] as { bucket?: string }
    expect(callArg?.bucket).toBe('mybucket')
  })
})
