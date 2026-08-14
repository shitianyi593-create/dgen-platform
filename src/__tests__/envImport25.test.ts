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

  // 未来变体（TEXT_LLM_SEED_1_6_ENDPOINT 之类）靠 fallback 扫描接住；
  // SEEDANCE_/SEEDREAM_ 是 SEED 接字母、不含 "SEED_"，不会被误抓。
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

/** 镜射实际 .env.local 的变数组合 — 拖放导入后四个接入点必须各自歸位。 */
describe('envImport: 实际 .env 拖放的完整推理凭证组合', () => {
  it('API_KEY + 四个接入点全部对到正确栏位', () => {
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
