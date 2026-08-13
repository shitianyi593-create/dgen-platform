import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const { signPutSpy, signGetSpy } = vi.hoisted(() => ({
  signPutSpy: vi.fn(async () => ({
    url: 'https://example/put',
    key: 'p/x',
    expiresAt: 1,
  })),
  signGetSpy: vi.fn(async () => ({ url: 'https://example/get', expiresAt: 1 })),
}))

vi.mock('../../server/signers/tos', async () => {
  const actual = await vi.importActual<typeof import('../../server/signers/tos')>(
    '../../server/signers/tos',
  )
  return {
    ...actual,
    createTosHandlers: () => ({ signPut: signPutSpy, signGet: signGetSpy }),
  }
})

import { createApp } from '../../server/app'

const testCreds = {
  accessKeyId: 'test-AK',
  accessKeySecret: 'test-SK',
  region: 'ap-southeast-1',
  endpoint: 'tos-ap-southeast-1.bytepluses.com',
  bucket: 'test-bucket',
  keyPrefix: 'p/',
  defaultGetTtlSeconds: 3600,
}

describe('TOS routes', () => {
  beforeEach(() => {
    signPutSpy.mockClear()
    signGetSpy.mockClear()
  })

  it('POST /local-api/tos/sign-put returns 400 when creds are missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/sign-put')
      .send({ filename: 'test.mp4', contentType: 'video/mp4' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('creds required')
    expect(signPutSpy).not.toHaveBeenCalled()
  })

  it('POST /local-api/tos/sign-get returns 400 when creds are missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/sign-get')
      .send({ key: 'p/x', expiresSec: 600 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('creds required')
    expect(signGetSpy).not.toHaveBeenCalled()
  })

  it('POST /local-api/tos/sign-put forwards body to signPut handler when creds provided', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/sign-put')
      .send({ filename: 'test.mp4', contentType: 'video/mp4', creds: testCreds })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ url: 'https://example/put', key: 'p/x' })
    expect(signPutSpy).toHaveBeenCalledTimes(1)
    expect(signPutSpy).toHaveBeenCalledWith(
      { filename: 'test.mp4', contentType: 'video/mp4' },
      expect.objectContaining({
        config: expect.objectContaining({ bucket: 'test-bucket' }),
        client: expect.anything(),
      }),
    )
    expect(signGetSpy).not.toHaveBeenCalled()
  })

  it('POST /local-api/tos/sign-get forwards body to signGet handler when creds provided', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/tos/sign-get')
      .send({ key: 'p/x', expiresSec: 600, creds: testCreds })
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://example/get')
    expect(signGetSpy).toHaveBeenCalledTimes(1)
    expect(signGetSpy).toHaveBeenCalledWith(
      { key: 'p/x', expiresSec: 600 },
      expect.objectContaining({
        config: expect.objectContaining({ bucket: 'test-bucket' }),
        client: expect.anything(),
      }),
    )
    expect(signPutSpy).not.toHaveBeenCalled()
  })

  it('uses creds from req.body.creds when provided', async () => {
    const app = createApp()
    const res = await request(app).post('/local-api/tos/sign-put').send({
      filename: 'x.mp4',
      creds: {
        accessKeyId: 'tenant-AK',
        accessKeySecret: 'tenant-SK',
        region: 'ap-southeast-1',
        endpoint: 'tos-ap-southeast-1.bytepluses.com',
        bucket: 'tenant-bucket',
        keyPrefix: 'x/',
        defaultGetTtlSeconds: 600,
      },
    })
    expect(res.status).toBe(200)
    expect(signPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'x.mp4' }),
      expect.objectContaining({
        config: expect.objectContaining({ bucket: 'tenant-bucket' }),
        client: expect.anything(),
      }),
    )
    expect(signGetSpy).not.toHaveBeenCalled()
  })

  it('signGet uses creds from req.body.creds when provided', async () => {
    const app = createApp()
    const res = await request(app).post('/local-api/tos/sign-get').send({
      key: 'k.mp4',
      creds: {
        accessKeyId: 'tenant-AK',
        accessKeySecret: 'tenant-SK',
        region: 'ap-southeast-1',
        endpoint: 'tos-ap-southeast-1.bytepluses.com',
        bucket: 'tenant-bucket',
        keyPrefix: 'x/',
        defaultGetTtlSeconds: 600,
      },
    })
    expect(res.status).toBe(200)
    expect(signGetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k.mp4' }),
      expect.objectContaining({
        config: expect.objectContaining({ bucket: 'tenant-bucket' }),
        client: expect.anything(),
      }),
    )
    expect(signPutSpy).not.toHaveBeenCalled()
  })
})

describe('TOS routes — endpoint fallback', () => {
  beforeEach(() => {
    signPutSpy.mockClear()
    signGetSpy.mockClear()
  })

  it('signs PUT successfully when creds.endpoint is omitted (derived from region)', async () => {
    const app = createApp()
    const res = await request(app).post('/local-api/tos/sign-put').send({
      filename: 'x.mp4',
      creds: {
        accessKeyId: 'AK',
        accessKeySecret: 'SK',
        region: 'ap-southeast-1',
        bucket: 'b1',
        keyPrefix: 'p/',
      },
    })
    expect(res.status).toBe(200)
    expect(signPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'x.mp4' }),
      expect.objectContaining({
        config: expect.objectContaining({
          endpoint: 'tos-ap-southeast-1.bytepluses.com',
          bucket: 'b1',
        }),
      }),
    )
  })

  it('signs GET successfully when creds.endpoint is omitted', async () => {
    const app = createApp()
    const res = await request(app).post('/local-api/tos/sign-get').send({
      key: 'k.mp4',
      creds: {
        accessKeyId: 'AK',
        accessKeySecret: 'SK',
        region: 'cn-beijing',
        bucket: 'b1',
      },
    })
    expect(res.status).toBe(200)
    expect(signGetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k.mp4' }),
      expect.objectContaining({
        config: expect.objectContaining({
          endpoint: 'tos-cn-beijing.bytepluses.com',
        }),
      }),
    )
  })

  it('keeps user-supplied endpoint when present (backward compat)', async () => {
    const app = createApp()
    const res = await request(app).post('/local-api/tos/sign-put').send({
      filename: 'x.mp4',
      creds: {
        accessKeyId: 'AK',
        accessKeySecret: 'SK',
        region: 'ap-southeast-1',
        endpoint: 'tos-custom.example.com',
        bucket: 'b1',
      },
    })
    expect(res.status).toBe(200)
    expect(signPutSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        config: expect.objectContaining({
          endpoint: 'tos-custom.example.com',
        }),
      }),
    )
  })
})
