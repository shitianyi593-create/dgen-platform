import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../stores/authStore'

const VALID_KEY = '12345678-1234-1234-1234-123456789012'
const VALID_EP = 'ep-20260101000000-aaaaa'
const VALID_IMG_EP = 'ep-20260202000000-bbbbb'

describe('authStore imageEndpoint', () => {
  beforeEach(() => {
    useAuthStore.setState({
      apiKey: '',
      endpoint: '',
      imageEndpoint: '',
      verifyState: {
        inference: { status: 'pend', message: '尚未验证' },
        asset: { status: 'pend', message: '尚未验证' },
        tos: { status: 'pend', message: '尚未验证' },
      },
    })
  })

  it('setImageEndpoint stores the value', () => {
    useAuthStore.getState().setImageEndpoint(VALID_IMG_EP)
    expect(useAuthStore.getState().imageEndpoint).toBe(VALID_IMG_EP)
  })

  it('inference is ok with key + image endpoint only (video ep empty)', () => {
    useAuthStore.getState().setApiKey(VALID_KEY)
    useAuthStore.getState().setImageEndpoint(VALID_IMG_EP)
    expect(useAuthStore.getState().verifyState.inference.status).toBe('ok')
  })

  it('inference is ok with key + video endpoint only (image ep empty)', () => {
    useAuthStore.getState().setApiKey(VALID_KEY)
    useAuthStore.getState().setEndpoint(VALID_EP)
    expect(useAuthStore.getState().verifyState.inference.status).toBe('ok')
  })

  it('warns when key is set but no endpoint at all', () => {
    useAuthStore.getState().setApiKey(VALID_KEY)
    const inf = useAuthStore.getState().verifyState.inference
    expect(inf.status).toBe('warn')
    expect(inf.message).toContain('至少')
  })

  it('warns on malformed image endpoint even when video ep is valid', () => {
    useAuthStore.getState().setApiKey(VALID_KEY)
    useAuthStore.getState().setEndpoint(VALID_EP)
    useAuthStore.getState().setImageEndpoint('not-an-ep')
    const inf = useAuthStore.getState().verifyState.inference
    expect(inf.status).toBe('warn')
    expect(inf.message).toContain('图片')
  })

  it('setField routes imageEndpoint under the inference cred', () => {
    useAuthStore.getState().setField('inference', 'imageEndpoint', VALID_IMG_EP)
    expect(useAuthStore.getState().imageEndpoint).toBe(VALID_IMG_EP)
  })

  it('applyImportedEnv fills imageEndpoint and revalidates', () => {
    useAuthStore.getState().applyImportedEnv({
      inference: { apiKey: VALID_KEY, imageEndpoint: VALID_IMG_EP },
    })
    expect(useAuthStore.getState().imageEndpoint).toBe(VALID_IMG_EP)
    expect(useAuthStore.getState().verifyState.inference.status).toBe('ok')
  })

  it('persist migrate v5→v6 seeds empty imageEndpoint', () => {
    // persist options are attached to the store; call migrate directly
    const migrate = (useAuthStore.persist.getOptions().migrate!) as (
      s: unknown, v: number,
    ) => Record<string, unknown>
    const migrated = migrate({ apiKey: 'k', endpoint: 'e' }, 5)
    expect(migrated.imageEndpoint).toBe('')
  })
})
