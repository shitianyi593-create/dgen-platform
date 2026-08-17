import { describe, it, expect, beforeEach } from 'vitest'

let _importSeq = 0
const freshStore = () => import('../stores/authStore?t=' + Date.now() + '_' + ++_importSeq)

describe('authStore v1 → v2 migration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('preserves apiKey/endpoint and adds empty assetCreds', async () => {
    sessionStorage.setItem(
      'byteplus-ai-gen-platform-auth',
      JSON.stringify({
        version: 1,
        state: { apiKey: 'preserved', endpoint: 'preserved-endpoint' },
      }),
    )
    const mod = await freshStore()
    const s = mod.useAuthStore.getState()
    expect(s.apiKey).toBe('preserved')
    expect(s.endpoint).toBe('preserved-endpoint')
    expect(s.assetCreds).toEqual({
      accessKeyId: '', accessKeySecret: '', projectName: 'default',
    })
  })
})

describe('authStore v2 → v3 migration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('v2 → v3: preserves apiKey/endpoint/assetCreds and adds empty tosCreds', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-auth', JSON.stringify({
      version: 2,
      state: {
        apiKey: 'a', endpoint: 'e',
        assetCreds: { accessKeyId: 'ak', accessKeySecret: 'sk', projectName: 'p' },
      },
    }))
    const mod = await freshStore()
    const s = mod.useAuthStore.getState()
    expect(s.apiKey).toBe('a')
    expect(s.assetCreds.accessKeyId).toBe('ak')
    expect(s.tosCreds).toEqual({
      accessKeyId: '', accessKeySecret: '',
      region: 'ap-southeast-1',
      bucket: '',
    })
  })
})

describe('authStore v3 → v4 migration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('preserves all prior fields and initializes verifyState as pend', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-auth', JSON.stringify({
      version: 3,
      state: {
        apiKey: 'a', endpoint: 'e',
        assetCreds: { accessKeyId: 'ak', accessKeySecret: 'sk', projectName: 'p' },
        tosCreds: {
          accessKeyId: 'tk', accessKeySecret: 'ts',
          region: 'ap-southeast-1',
          endpoint: 'tos-ap-southeast-1.bytepluses.com',
          bucket: 'b',
        },
      },
    }))
    const mod = await freshStore()
    const s = mod.useAuthStore.getState()
    expect(s.apiKey).toBe('a')
    expect(s.tosCreds.bucket).toBe('b')
    expect(s.verifyState.inference.status).toBe('pend')
    expect(s.verifyState.asset.status).toBe('pend')
    expect(s.verifyState.tos.status).toBe('pend')
  })
})

describe('authStore: leftover localStorage cleanup', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('removes any pre-existing localStorage["ai-gen-auth"] on module init', async () => {
    localStorage.setItem('ai-gen-auth', '{"version":3,"state":{"apiKey":"old"}}')
    await freshStore()
    expect(localStorage.getItem('ai-gen-auth')).toBeNull()
  })
})

describe('authStore v4 → v5 migration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('strips endpoint from persisted tosCreds and keeps other fields', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-auth', JSON.stringify({
      version: 4,
      state: {
        apiKey: '', endpoint: '',
        assetCreds: { accessKeyId: '', accessKeySecret: '', projectName: '' },
        tosCreds: {
          accessKeyId: 'ak', accessKeySecret: 'sk',
          region: 'ap-southeast-1',
          endpoint: 'tos-ap-southeast-1.bytepluses.com',
          bucket: 'b',
        },
        verifyState: {
          inference: { status: 'pend', message: '尚未验证' },
          asset:     { status: 'pend', message: '尚未验证' },
          tos:       { status: 'pend', message: '尚未验证' },
        },
      },
    }))
    const mod = await freshStore()
    const tos = mod.useAuthStore.getState().tosCreds as Record<string, unknown>
    expect(tos.endpoint).toBeUndefined()
    expect(tos.accessKeyId).toBe('ak')
    expect(tos.accessKeySecret).toBe('sk')
    expect(tos.region).toBe('ap-southeast-1')
    expect(tos.bucket).toBe('b')
  })
})

describe('authStore v7 → v8 migration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('adds empty videoEndpoint25 and preserves prior fields', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-auth', JSON.stringify({
      version: 7,
      state: { apiKey: 'a', endpoint: 'e', imageEndpoint: 'ie', textEndpoint: 'te' },
    }))
    const mod = await freshStore()
    const s = mod.useAuthStore.getState()
    expect(s.apiKey).toBe('a')
    expect(s.endpoint).toBe('e')
    expect(s.textEndpoint).toBe('te')
    expect(s.videoEndpoint25).toBe('')
  })
})

describe('authStore legacy storage key migration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('reads the legacy BytePlus key and writes back to the DGen key', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-auth', JSON.stringify({
      version: 8,
      state: { apiKey: 'legacy-key', endpoint: 'ep-20260101000000-abcde' },
    }))

    const mod = await freshStore()
    expect(mod.useAuthStore.getState().apiKey).toBe('legacy-key')
    mod.useAuthStore.getState().setApiKey('new-key')
    await new Promise((r) => setTimeout(r, 0))

    expect(sessionStorage.getItem('byteplus-ai-gen-platform-auth')).toBeNull()
    const raw = sessionStorage.getItem('dgen-platform-auth')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.apiKey).toBe('new-key')
  })
})
