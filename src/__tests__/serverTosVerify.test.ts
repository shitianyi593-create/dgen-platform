import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

// ── Hoist shared spies so vi.mock factories can reference them ────────────────

const {
  mockHeadBucket,
  mockGetBucketCORS,
  mockPutBucketCORS,
  mockGetPreSignedUrl,
  mockDeleteObject,
} = vi.hoisted(() => ({
  mockHeadBucket: vi.fn(),
  mockGetBucketCORS: vi.fn(),
  mockPutBucketCORS: vi.fn(),
  mockGetPreSignedUrl: vi.fn(),
  mockDeleteObject: vi.fn(),
}))

// ── Mock TosClient constructor (use regular function so new works) ────────────
// This also affects createTosRouter, so we additionally mock signers/tos to
// prevent createTosRouter from reaching TosClient at all.

vi.mock('@volcengine/tos-sdk', async () => {
  const actual = await vi.importActual<typeof import('@volcengine/tos-sdk')>(
    '@volcengine/tos-sdk',
  )
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TosClient: vi.fn().mockImplementation(function (this: any) {
      this.headBucket = mockHeadBucket
      this.getBucketCORS = mockGetBucketCORS
      this.putBucketCORS = mockPutBucketCORS
      this.getPreSignedUrl = mockGetPreSignedUrl
      this.deleteObject = mockDeleteObject
    }),
  }
})

// ── Mock signers/tos so createTosRouter short-circuits (no TosClient new) ────

vi.mock('../../server/signers/tos', async () => {
  const actual = await vi.importActual<typeof import('../../server/signers/tos')>(
    '../../server/signers/tos',
  )
  return {
    ...actual,
  }
})

// ── Mock loadServerEnv to inject a fixed platformOrigin ───────────────────────

vi.mock('../../server/config/env', async () => {
  const actual = await vi.importActual<typeof import('../../server/config/env')>(
    '../../server/config/env',
  )
  return {
    ...actual,
    loadServerEnv: vi.fn().mockReturnValue({
      port: 3000,
      nodeEnv: 'test' as const,
      platformOrigin: 'http://localhost:5173',
    }),
  }
})

import { createApp } from '../../server/app'

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_CREDS = {
  accessKeyId: 'AK123',
  accessKeySecret: 'SK456',
  region: 'ap-southeast-1',
  endpoint: 'tos-ap-southeast-1.bytepluses.com',
  bucket: 'my-bucket',
}

/** Returns a minimal fetch stub that succeeds for both PUT and GET. */
function makeFakeFetch(putStatus = 200, getStatus = 200) {
  return vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
    const method = opts?.method ?? 'GET'
    const status = method === 'PUT' ? putStatus : getStatus
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
    } as Response)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: getPreSignedUrl returns stable URLs
  mockGetPreSignedUrl.mockImplementation(
    ({ method }: { method: string }) => `https://fake-tos.example.com/${method.toLowerCase()}-presigned`,
  )
  // Default: deleteObject succeeds
  mockDeleteObject.mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /local-api/tos/verify', () => {
  it('happy path — CORS already configured, round-trip succeeds (no putBucketCORS call)', async () => {
    // HeadBucket OK
    mockHeadBucket.mockResolvedValue({})
    // CORS already has our origin — no write needed
    mockGetBucketCORS.mockResolvedValue({
      data: {
        CORSRules: [
          {
            AllowedOrigins: ['http://localhost:5173'],
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
    // fetch stub: PUT then GET both succeed
    vi.stubGlobal('fetch', makeFakeFetch(200, 200))

    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/verify')
      .send({ creds: VALID_CREDS })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.steps).toEqual({
      headBucket: 'ok',
      cors: 'already-configured',
      roundTrip: 'ok',
    })
    expect(mockPutBucketCORS).not.toHaveBeenCalled()
  })

  it('writes CORS when our origin is missing from existing rules', async () => {
    mockHeadBucket.mockResolvedValue({})
    // CORS exists but does NOT include our origin
    mockGetBucketCORS.mockResolvedValue({
      data: {
        CORSRules: [
          {
            AllowedOrigins: ['https://other-app.example.com'],
            AllowedMethods: ['GET'],
            AllowedHeaders: ['*'],
            ExposeHeaders: [],
            MaxAgeSeconds: 600,
          },
        ],
      },
    })
    mockPutBucketCORS.mockResolvedValue({})
    vi.stubGlobal('fetch', makeFakeFetch(200, 200))

    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/verify')
      .send({ creds: VALID_CREDS })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.steps).toEqual({ headBucket: 'ok', cors: 'written', roundTrip: 'ok' })
    expect(mockPutBucketCORS).toHaveBeenCalledTimes(1)
  })

  it('returns ok:false with failingStep=headBucket when HeadBucket rejects', async () => {
    const err = Object.assign(new Error('bucket not found'), { statusCode: 404 })
    mockHeadBucket.mockRejectedValue(err)

    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/verify')
      .send({ creds: VALID_CREDS })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.failingStep).toBe('headBucket')
    expect(res.body.message).toMatch(/bucket not found/)
  })

  it('returns 400 when creds object is incomplete', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/verify')
      .send({ creds: { accessKeyId: 'AK' } })

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(mockHeadBucket).not.toHaveBeenCalled()
  })

  it('reports cors step failure when getBucketCORS throws', async () => {
    mockHeadBucket.mockResolvedValueOnce({})
    mockGetBucketCORS.mockRejectedValueOnce(new Error('Access denied to GetBucketCORS'))

    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/verify')
      .send({ creds: VALID_CREDS })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.failingStep).toBe('cors')
    expect(res.body.steps).toMatchObject({ headBucket: 'ok' })
    expect(res.body.message).toMatch(/Access denied/)
  })

  it('recovers when getBucketCORS throws "CORS configuration does not exist" (fresh bucket)', async () => {
    mockHeadBucket.mockResolvedValueOnce({})
    // Fresh bucket scenario: TOS surfaces this exact error on first
    // GetBucketCORS call. Verify must treat it as "no rules" + write our
    // rule, NOT as a step failure.
    mockGetBucketCORS.mockRejectedValueOnce(new Error('The CORS configuration does not exist'))
    mockPutBucketCORS.mockResolvedValueOnce({})
    vi.stubGlobal('fetch', makeFakeFetch(200, 200))

    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/verify')
      .send({ creds: VALID_CREDS })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.steps).toMatchObject({
      headBucket: 'ok',
      cors: 'written',
      roundTrip: 'ok',
    })
    expect(mockPutBucketCORS).toHaveBeenCalledTimes(1)
    // The PUT should have included our origin in the new rules.
    const putCall = mockPutBucketCORS.mock.calls[0][0] as { CORSRules: { AllowedOrigins?: string[] }[] }
    const allOrigins = putCall.CORSRules.flatMap((r) => r.AllowedOrigins ?? [])
    expect(allOrigins).toContain('http://localhost:5173')
  })

  it('reports round-trip failure when PUT fetch returns non-2xx', async () => {
    mockHeadBucket.mockResolvedValueOnce({})
    mockGetBucketCORS.mockResolvedValueOnce({
      data: {
        CORSRules: [
          {
            AllowedOrigins: ['http://localhost:5173'],
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: [],
            MaxAgeSeconds: 0,
          },
        ],
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('forbidden', { status: 500 })))

    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/verify')
      .send({ creds: VALID_CREDS })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.failingStep).toBe('roundTrip')
    expect(res.body.steps).toMatchObject({ headBucket: 'ok', cors: 'already-configured' })
    expect(res.body.message).toMatch(/PUT failed/)
  })

  it('succeeds when creds.endpoint is omitted — derived from region', async () => {
    // Same happy-path setup, but creds without endpoint
    mockHeadBucket.mockResolvedValue({})
    mockGetBucketCORS.mockResolvedValue({
      data: {
        CORSRules: [
          {
            AllowedOrigins: ['http://localhost:5173'],
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
    vi.stubGlobal('fetch', makeFakeFetch(200, 200))

    const app = createApp()
    const credsNoEndpoint = {
      accessKeyId: VALID_CREDS.accessKeyId,
      accessKeySecret: VALID_CREDS.accessKeySecret,
      region: VALID_CREDS.region,
      bucket: VALID_CREDS.bucket,
    }
    const res = await request(app).post('/local-api/tos/verify').send({ creds: credsNoEndpoint })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.steps?.headBucket).toBe('ok')
    expect(res.body.steps?.cors).toBe('already-configured')
    expect(res.body.steps?.roundTrip).toBe('ok')
  })

  it('returns 400 when creds.endpoint is the wrong type', async () => {
    const app = createApp()
    const res = await request(app).post('/local-api/tos/verify').send({
      creds: { ...VALID_CREDS, endpoint: 42 },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/endpoint/)
  })
})
