import { describe, it, expect, beforeEach } from 'vitest'

let _importSeq = 0
const freshStore = () => import('../stores/authStore?t=' + Date.now() + '_' + ++_importSeq)

const VALID_KEY = '12345678-1234-1234-1234-1234567890ab'
const VALID_EP = 'ep-20260101000000-abcde'

describe('authStore textEndpoint', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('v6 → v7 migration：補上空 textEndpoint、保留其他欄位', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-auth', JSON.stringify({
      version: 6,
      state: { apiKey: 'k', endpoint: 'e', imageEndpoint: 'img' },
    }))
    const mod = await freshStore()
    const s = mod.useAuthStore.getState()
    expect(s.apiKey).toBe('k')
    expect(s.imageEndpoint).toBe('img')
    expect(s.textEndpoint).toBe('')
  })

  it('setTextEndpoint 更新值並觸發 inference 格式驗證', async () => {
    const mod = await freshStore()
    mod.useAuthStore.getState().setApiKey(VALID_KEY)
    mod.useAuthStore.getState().setTextEndpoint(VALID_EP)
    const s = mod.useAuthStore.getState()
    expect(s.textEndpoint).toBe(VALID_EP)
    expect(s.verifyState.inference.status).toBe('ok')  // 只填文字 ep 也算「至少一個接入點」
  })

  it('textEndpoint 格式錯誤 → warn', async () => {
    const mod = await freshStore()
    mod.useAuthStore.getState().setApiKey(VALID_KEY)
    mod.useAuthStore.getState().setTextEndpoint('not-an-ep')
    expect(mod.useAuthStore.getState().verifyState.inference.status).toBe('warn')
    expect(mod.useAuthStore.getState().verifyState.inference.message).toContain('文字生成接入點')
  })

  it('setField("inference","textEndpoint",…) 分派到 setTextEndpoint', async () => {
    const mod = await freshStore()
    mod.useAuthStore.getState().setField('inference', 'textEndpoint', VALID_EP)
    expect(mod.useAuthStore.getState().textEndpoint).toBe(VALID_EP)
  })

  it('applyImportedEnv 帶入 textEndpoint', async () => {
    const mod = await freshStore()
    mod.useAuthStore.getState().applyImportedEnv({
      inference: { apiKey: VALID_KEY, textEndpoint: VALID_EP },
    })
    const s = mod.useAuthStore.getState()
    expect(s.textEndpoint).toBe(VALID_EP)
    expect(s.verifyState.inference.status).toBe('ok')
  })
})
