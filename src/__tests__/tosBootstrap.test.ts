/**
 * scripts/tos-bootstrap 测试
 *
 * 涵盖需求：
 * - 缺少必要 env 时应抛错且 SDK 完全不被呼叫
 * - 默认套用 PUT/GET/HEAD CORS rule，origins 来自 TOS_CORS_ORIGINS
 * - showOnly 模式只 get 不 put
 * - 无 TOS_REGION/TOS_ENDPOINT 时走 fallback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runBootstrap, type BootstrapClient } from '../../scripts/tos-bootstrap'
import type { CORSRule } from '@volcengine/tos-sdk/dist/methods/bucket/cors'

interface SpyClient extends BootstrapClient {
  __config: {
    accessKeyId: string
    accessKeySecret: string
    region: string
    endpoint: string
  }
}

function makeClient() {
  const putBucketCORS = vi.fn().mockResolvedValue({})
  // Return empty CORSRules so mergeCorsRules always appends our rule and
  // putBucketCORS is called (didChange === true).
  const getBucketCORS = vi.fn().mockResolvedValue({
    data: { CORSRules: [] as CORSRule[] },
  })
  let captured: SpyClient['__config'] | null = null

  class FakeClient implements SpyClient {
    __config: SpyClient['__config']
    putBucketCORS = putBucketCORS
    getBucketCORS = getBucketCORS

    constructor(cfg: SpyClient['__config']) {
      this.__config = cfg
      captured = cfg
    }
  }

  return {
    Ctor: FakeClient as unknown as new (cfg: SpyClient['__config']) => BootstrapClient,
    putBucketCORS,
    getBucketCORS,
    getCapturedConfig: () => captured,
  }
}

const baseEnv = {
  TOS_ACCESS_KEY: 'AK_test',
  TOS_SECRET_KEY: 'SK_test',
  TOS_REGION: 'ap-southeast-1',
  TOS_ENDPOINT: 'tos-ap-southeast-1.bytepluses.com',
  TOS_BUCKET: 'ianlinbp',
  TOS_CORS_ORIGINS: 'http://localhost:5173',
}

describe('runBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validation', () => {
    it.each(['TOS_ACCESS_KEY', 'TOS_SECRET_KEY', 'TOS_BUCKET'] as const)(
      'should throw when %s is missing',
      async (missing) => {
        const env = { ...baseEnv, [missing]: '' }
        const { Ctor, putBucketCORS, getBucketCORS } = makeClient()
        await expect(runBootstrap(env, { ClientCtor: Ctor })).rejects.toThrow(
          /Missing required env: /,
        )
        expect(putBucketCORS).not.toHaveBeenCalled()
        expect(getBucketCORS).not.toHaveBeenCalled()
      },
    )
  })

  describe('happy path', () => {
    it('should construct the client with provided AK/SK/region/endpoint', async () => {
      const { Ctor, getCapturedConfig } = makeClient()
      await runBootstrap(baseEnv, { ClientCtor: Ctor })

      const cfg = getCapturedConfig()
      expect(cfg).toEqual({
        accessKeyId: 'AK_test',
        accessKeySecret: 'SK_test',
        region: 'ap-southeast-1',
        endpoint: 'tos-ap-southeast-1.bytepluses.com',
      })
    })

    it('should call putBucketCORS once with PUT/GET/HEAD methods and given origins', async () => {
      const { Ctor, putBucketCORS } = makeClient()
      await runBootstrap(baseEnv, { ClientCtor: Ctor })

      expect(putBucketCORS).toHaveBeenCalledTimes(1)
      const arg = putBucketCORS.mock.calls[0][0] as { bucket: string; CORSRules: CORSRule[] }
      expect(arg.bucket).toBe('ianlinbp')
      expect(arg.CORSRules).toHaveLength(1)
      const rule = arg.CORSRules[0]
      expect(rule.AllowedOrigins).toEqual(['http://localhost:5173'])
      expect(rule.AllowedMethods).toEqual(
        expect.arrayContaining(['PUT', 'GET', 'HEAD']),
      )
      expect(rule.AllowedHeaders).toEqual(['*'])
      expect(rule.ExposeHeaders).toEqual(
        expect.arrayContaining(['ETag', 'x-tos-request-id']),
      )
      expect(rule.MaxAgeSeconds).toBeGreaterThan(0)
    })

    it('returns currentCORS sourced from the merge result, calling getBucketCORS once', async () => {
      const { Ctor, getBucketCORS } = makeClient()
      const result = await runBootstrap(baseEnv, { ClientCtor: Ctor })

      expect(getBucketCORS).toHaveBeenCalledTimes(1)
      expect(getBucketCORS).toHaveBeenCalledWith({ bucket: 'ianlinbp' })
      expect(result.currentCORS).toHaveLength(1)
      expect(result.appliedRule?.AllowedOrigins).toEqual(['http://localhost:5173'])
    })

    it('should fall back to default region/endpoint when not set', async () => {
      const { TOS_REGION: _r, TOS_ENDPOINT: _e, ...env } = baseEnv
      void _r
      void _e
      const { Ctor, getCapturedConfig } = makeClient()
      await runBootstrap(env, { ClientCtor: Ctor })

      const cfg = getCapturedConfig()
      expect(cfg?.region).toBe('ap-southeast-1')
      expect(cfg?.endpoint).toBe('tos-ap-southeast-1.bytepluses.com')
    })

    it('should fall back to localhost:5173 when TOS_CORS_ORIGINS not set', async () => {
      const { TOS_CORS_ORIGINS: _o, ...env } = baseEnv
      void _o
      const { Ctor, putBucketCORS } = makeClient()
      await runBootstrap(env, { ClientCtor: Ctor })

      const arg = putBucketCORS.mock.calls[0][0] as { CORSRules: CORSRule[] }
      expect(arg.CORSRules[0].AllowedOrigins).toEqual(['http://localhost:5173'])
    })
  })

  describe('showOnly mode', () => {
    it('should not call putBucketCORS but should call getBucketCORS', async () => {
      const { Ctor, putBucketCORS, getBucketCORS } = makeClient()
      const result = await runBootstrap(baseEnv, { ClientCtor: Ctor, showOnly: true })

      expect(putBucketCORS).not.toHaveBeenCalled()
      expect(getBucketCORS).toHaveBeenCalledTimes(1)
      expect(result.appliedRule).toBeUndefined()
      expect(result.currentCORS).toHaveLength(1)
    })
  })
})
