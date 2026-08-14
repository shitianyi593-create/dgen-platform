import { describe, it, expect } from 'vitest'
import { mapToCreds } from '../components/credentials/envImport'
import { CREDENTIALS_BY_KEY } from '../components/credentials/schema'

describe('envImport textEndpoint', () => {
  it('SEED_2_0_PRO_ENDPOINT → inference.textEndpoint', () => {
    const out = mapToCreds({ SEED_2_0_PRO_ENDPOINT: 'ep-20260101000000-txttx' })
    expect(out.inference?.textEndpoint).toBe('ep-20260101000000-txttx')
  })

  it('别名优先序：SEED_2_0_PRO_ENDPOINT > TEXT_ENDPOINT', () => {
    const out = mapToCreds({
      TEXT_ENDPOINT: 'ep-20260101000000-lowpr',
      SEED_2_0_PRO_ENDPOINT: 'ep-20260101000000-highp',
    })
    expect(out.inference?.textEndpoint).toBe('ep-20260101000000-highp')
  })

  it('fallback：SEED_ 前缀的未知 ENDPOINT 变数（如 SEED_2_1_ENDPOINT）也吃得到', () => {
    const out = mapToCreds({ SEED_2_1_ENDPOINT: 'ep-20260101000000-fallb' })
    expect(out.inference?.textEndpoint).toBe('ep-20260101000000-fallb')
  })

  it('fallback 不误吃 SEEDANCE / SEEDREAM 变数', () => {
    const out = mapToCreds({
      SEEDANCE_2_0_ENDPOINT: 'ep-20260101000000-video',
      SEEDREAM_5_0_ENDPOINT: 'ep-20260101000000-image',
    })
    expect(out.inference?.textEndpoint).toBeUndefined()
    expect(out.inference?.endpoint).toBe('ep-20260101000000-video')
    expect(out.inference?.imageEndpoint).toBe('ep-20260101000000-image')
  })

  it('三个 ep 同时导入互不干扰（.env.local 实际形状）', () => {
    const out = mapToCreds({
      API_KEY: '12345678-1234-1234-1234-1234567890ab',
      SEEDANCE_2_0_ENDPOINT: 'ep-20260101000000-video',
      SEEDREAM_5_0_ENDPOINT: 'ep-20260101000000-image',
      SEED_2_0_PRO_ENDPOINT: 'ep-20260101000000-txttx',
    })
    expect(out.inference).toEqual({
      apiKey: '12345678-1234-1234-1234-1234567890ab',
      endpoint: 'ep-20260101000000-video',
      imageEndpoint: 'ep-20260101000000-image',
      textEndpoint: 'ep-20260101000000-txttx',
    })
  })
})

describe('credentials schema', () => {
  it('inference 区块含 textEndpoint 栏位', () => {
    const keys = CREDENTIALS_BY_KEY.inference.fields.map((f) => f.key)
    expect(keys).toContain('textEndpoint')
  })
})
