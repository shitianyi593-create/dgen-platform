import { describe, it, expect } from 'vitest'
import { mapToCreds } from '../components/credentials/envImport'

describe('envImport: SEEDANCE_2_5_ENDPOINT', () => {
  it('maps SEEDANCE_2_5_ENDPOINT to videoEndpoint25, not to the 2.0 endpoint', () => {
    const out = mapToCreds({ SEEDANCE_2_5_ENDPOINT: 'ep-25' })
    expect(out.inference?.videoEndpoint25).toBe('ep-25')
    expect(out.inference?.endpoint).toBeUndefined()
  })

  it('fallback scan still fills the 2.0 endpoint from other SEEDANCE vars', () => {
    const out = mapToCreds({ SEEDANCE_PRO_ENDPOINT: 'ep-20' })
    expect(out.inference?.endpoint).toBe('ep-20')
  })

  it('both present: each goes to its own field', () => {
    const out = mapToCreds({
      SEEDANCE_2_0_ENDPOINT: 'ep-20',
      SEEDANCE_2_5_ENDPOINT: 'ep-25',
    })
    expect(out.inference?.endpoint).toBe('ep-20')
    expect(out.inference?.videoEndpoint25).toBe('ep-25')
  })
})

describe('envImport: TEXT_LLM_SEED_ENDPOINT', () => {
  it('maps TEXT_LLM_SEED_ENDPOINT to textEndpoint', () => {
    const out = mapToCreds({ TEXT_LLM_SEED_ENDPOINT: 'ep-text' })
    expect(out.inference?.textEndpoint).toBe('ep-text')
  })

  it('does not leak into the video endpoints', () => {
    const out = mapToCreds({ TEXT_LLM_SEED_ENDPOINT: 'ep-text' })
    expect(out.inference?.endpoint).toBeUndefined()
    expect(out.inference?.videoEndpoint25).toBeUndefined()
  })

  // 未來變體（TEXT_LLM_SEED_1_6_ENDPOINT 之類）靠 fallback 掃描接住；
  // SEEDANCE_/SEEDREAM_ 是 SEED 接字母、不含 "SEED_"，不會被誤抓。
  it('fallback scan catches TEXT_*_SEED_*_ENDPOINT variants', () => {
    const out = mapToCreds({ TEXT_LLM_SEED_1_6_ENDPOINT: 'ep-text-next' })
    expect(out.inference?.textEndpoint).toBe('ep-text-next')
  })

  it('fallback does NOT mistake SEEDANCE/SEEDREAM vars for the text endpoint', () => {
    const out = mapToCreds({
      SEEDANCE_2_0_ENDPOINT: 'ep-20',
      SEEDREAM_5_0_ENDPOINT: 'ep-img',
    })
    expect(out.inference?.textEndpoint).toBeUndefined()
  })
})

/** 鏡射實際 .env.local 的變數組合 — 拖放匯入後四個接入點必須各自歸位。 */
describe('envImport: 實際 .env 拖放的完整推論憑證組合', () => {
  it('API_KEY + 四個接入點全部對到正確欄位', () => {
    const out = mapToCreds({
      API_KEY: 'ark-key',
      SEEDANCE_2_0_ENDPOINT: 'ep-20',
      SEEDREAM_5_0_ENDPOINT: 'ep-img',
      SEEDANCE_2_5_ENDPOINT: 'ep-25',
      TEXT_LLM_SEED_ENDPOINT: 'ep-text',
    })
    expect(out.inference).toEqual({
      apiKey: 'ark-key',
      endpoint: 'ep-20',
      imageEndpoint: 'ep-img',
      videoEndpoint25: 'ep-25',
      textEndpoint: 'ep-text',
    })
  })
})
