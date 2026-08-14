/**
 * vite-plugin-tos 纯函数 / handler 单元测试
 *
 * 涵盖需求：
 * - sanitizeFilename 处理特殊字符、中文、过长档名
 * - buildObjectKey 落在 prefix/yyyy/MM/uuid-name 结构
 * - createTosHandlers.signPut 呼叫 SDK 并回传 url+key+expiresAt
 * - createTosHandlers.signGet 默认用 config.defaultGetTtlSeconds
 * - signGet 带 expiresSec 在合理范围可覆写；超过 7 天会抛
 * - signGet 带非法 expiresSec (0 / 负数) 会抛
 * - signPut 缺 filename / signGet 缺 key 会抛
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sanitizeFilename,
  buildObjectKey,
  createTosHandlers,
  type TosClientLike,
  type TosPluginConfig,
} from '../../server/signers/tos'

const baseConfig: TosPluginConfig = {
  accessKeyId: 'AK',
  accessKeySecret: 'SK',
  region: 'ap-southeast-1',
  endpoint: 'tos-ap-southeast-1.bytepluses.com',
  bucket: 'ianlinbp',
  keyPrefix: 'seedance-2-0/',
  defaultGetTtlSeconds: 10800,
}

function makeClient() {
  return {
    getPreSignedUrl: vi.fn(
      (input: { method: string; bucket: string; key: string; expires: number }) =>
        `https://${input.bucket}.tos-ap-southeast-1.bytepluses.com/${input.key}` +
        `?X-Tos-Expires=${input.expires}&X-Tos-Method=${input.method}`,
    ),
  } satisfies TosClientLike
}

describe('sanitizeFilename', () => {
  it('keeps alphanumerics, dot, hyphen, underscore', () => {
    expect(sanitizeFilename('Reference_Video-01.mp4')).toBe('Reference_Video-01.mp4')
  })

  it('replaces spaces and unsafe characters with hyphen', () => {
    const out = sanitizeFilename('My Video (final)!.mp4')
    expect(out).not.toMatch(/[ ()!]/)
    expect(out).toMatch(/^My-Video-final-\.mp4$|^My-Video-final.mp4$/)
  })

  it('replaces non-ASCII (Chinese) characters', () => {
    const out = sanitizeFilename('参考视频.mp4')
    // Should not contain CJK chars
    expect(out).not.toMatch(/[\u4e00-\u9fff]/)
    expect(out.endsWith('.mp4')).toBe(true)
  })

  it('truncates very long names', () => {
    const long = 'a'.repeat(500) + '.mp4'
    const out = sanitizeFilename(long)
    expect(out.length).toBeLessThanOrEqual(80)
  })

  it('returns "file" for empty / all-stripped names', () => {
    expect(sanitizeFilename('')).toBe('file')
    expect(sanitizeFilename('////')).toBe('file')
  })
})

describe('buildObjectKey', () => {
  it('builds prefix/yyyy/MM/uuid-name', () => {
    const date = new Date(Date.UTC(2026, 3, 28))
    const key = buildObjectKey('seedance-2-0/', 'video.mp4', date, 'fixed-uuid')
    expect(key).toBe('seedance-2-0/2026/04/fixed-uuid-video.mp4')
  })

  it('appends a slash if missing on the prefix', () => {
    const date = new Date(Date.UTC(2026, 0, 5))
    const key = buildObjectKey('foo', 'a.wav', date, 'u1')
    expect(key).toBe('foo/2026/01/u1-a.wav')
  })

  it('uses sanitized filename', () => {
    const date = new Date(Date.UTC(2026, 0, 5))
    const key = buildObjectKey('p/', '参考 video!.mp4', date, 'u1')
    expect(key).toMatch(/^p\/2026\/01\/u1-/)
    expect(key).not.toMatch(/[\u4e00-\u9fff() ]/)
  })
})

describe('createTosHandlers.signPut', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T10:00:00Z'))
  })

  it('builds a key under the prefix and calls SDK with method=PUT', () => {
    const client = makeClient()
    const handlers = createTosHandlers(baseConfig, client)
    const out = handlers.signPut({ filename: 'cat.mp4', contentType: 'video/mp4' })

    expect(client.getPreSignedUrl).toHaveBeenCalledTimes(1)
    const arg = client.getPreSignedUrl.mock.calls[0][0]
    expect(arg.method).toBe('PUT')
    expect(arg.bucket).toBe('ianlinbp')
    expect(arg.key.startsWith('seedance-2-0/2026/04/')).toBe(true)
    expect(arg.key.endsWith('-cat.mp4')).toBe(true)
    expect(arg.expires).toBe(15 * 60)

    expect(out.key).toBe(arg.key)
    expect(out.url).toContain('X-Tos-Method=PUT')
    expect(out.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('throws when filename is missing', () => {
    const handlers = createTosHandlers(baseConfig, makeClient())
    expect(() => handlers.signPut({} as never)).toThrow(/filename is required/)
    expect(() => handlers.signPut({ filename: '' })).toThrow(/filename is required/)
  })

  it('signPut uses per-call config override when provided', () => {
    const baseCfg = { ...baseConfig, bucket: 'station' }
    const overrideCfg = { ...baseConfig, bucket: 'tenant' }
    const baseClient = makeClient()
    const overrideClient = makeClient()
    const h = createTosHandlers(baseCfg, baseClient)
    const out = h.signPut({ filename: 'a.mp4' }, { config: overrideCfg, client: overrideClient })
    expect(out.url).toContain('tenant')
    expect(overrideClient.getPreSignedUrl).toHaveBeenCalledTimes(1)
    expect(baseClient.getPreSignedUrl).not.toHaveBeenCalled()
  })
})

describe('createTosHandlers.signGet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T10:00:00Z'))
  })

  it('uses default TTL when expiresSec is not provided', () => {
    const client = makeClient()
    const handlers = createTosHandlers(baseConfig, client)
    const out = handlers.signGet({ key: 'seedance-2-0/x.mp4' })

    const arg = client.getPreSignedUrl.mock.calls[0][0]
    expect(arg.method).toBe('GET')
    expect(arg.expires).toBe(10800)
    expect(out.url).toContain('X-Tos-Expires=10800')
  })

  it('overrides TTL when expiresSec is in range', () => {
    const client = makeClient()
    const handlers = createTosHandlers(baseConfig, client)
    handlers.signGet({ key: 'k', expiresSec: 60 })
    expect(client.getPreSignedUrl.mock.calls[0][0].expires).toBe(60)
  })

  it('throws when expiresSec exceeds 7 days', () => {
    const handlers = createTosHandlers(baseConfig, makeClient())
    expect(() =>
      handlers.signGet({ key: 'k', expiresSec: 7 * 24 * 60 * 60 + 1 }),
    ).toThrow(/must not exceed/)
  })

  it('throws when expiresSec is non-positive or NaN', () => {
    const handlers = createTosHandlers(baseConfig, makeClient())
    expect(() => handlers.signGet({ key: 'k', expiresSec: 0 })).toThrow(/positive/)
    expect(() => handlers.signGet({ key: 'k', expiresSec: -10 })).toThrow(/positive/)
    expect(() =>
      handlers.signGet({ key: 'k', expiresSec: Number.NaN }),
    ).toThrow(/positive/)
  })

  it('throws when key is missing', () => {
    const handlers = createTosHandlers(baseConfig, makeClient())
    expect(() => handlers.signGet({} as never)).toThrow(/key is required/)
    expect(() => handlers.signGet({ key: '' })).toThrow(/key is required/)
  })

  it('signGet uses per-call config override when provided', () => {
    const baseCfg = { ...baseConfig, bucket: 'station' }
    const overrideCfg = { ...baseConfig, bucket: 'tenant' }
    const baseClient = makeClient()
    const overrideClient = makeClient()
    const h = createTosHandlers(baseCfg, baseClient)
    const out = h.signGet({ key: 'k.mp4' }, { config: overrideCfg, client: overrideClient })
    expect(out.url).toContain('tenant')
    expect(overrideClient.getPreSignedUrl).toHaveBeenCalledTimes(1)
    expect(baseClient.getPreSignedUrl).not.toHaveBeenCalled()
  })
})
