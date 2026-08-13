import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const { dispatchSpy } = vi.hoisted(() => ({
  dispatchSpy: vi.fn(async () => ({ Items: [{ id: '1' }], Total: 1 })),
}))

vi.mock('../../server/signers/asset', async () => {
  const actual = await vi.importActual<typeof import('../../server/signers/asset')>(
    '../../server/signers/asset',
  )
  return {
    ...actual,
    createAssetHandlers: () => ({ dispatch: dispatchSpy }),
  }
})

import { createApp } from '../../server/app'

const testCreds = {
  accessKeyId: 'AK',
  accessKeySecret: 'SK',
  region: 'ap-southeast-1',
  service: 'ark',
  host: 'ark.ap-southeast-1.byteplusapi.com',
  projectName: 'default',
}

describe('Asset routes', () => {
  beforeEach(() => dispatchSpy.mockClear())

  it('POST /local-api/asset/list returns 400 when creds are missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/list')
      .send({ pageNum: 1, pageSize: 10 })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('creds required')
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('POST /local-api/asset/list dispatches "list" with body and returns payload', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/list')
      .send({ pageNum: 1, pageSize: 10, creds: testCreds })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ Items: [{ id: '1' }], Total: 1 })
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      'list',
      { pageNum: 1, pageSize: 10 },
      expect.objectContaining({ projectName: 'default' }),
    )
  })

  it('POST /local-api/asset/group/list dispatches "group/list"', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/group/list')
      .send({ pageNum: 1, creds: testCreds })
    expect(res.status).toBe(200)
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      'group/list',
      { pageNum: 1 },
      expect.objectContaining({ projectName: 'default' }),
    )
  })

  it('returns 404 for unknown asset route', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/nonexistent')
      .send({})
    expect(res.status).toBe(404)
    expect(res.body.error.message).toMatch(/Unknown asset route/)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('maps AssetUpstreamError to upstream status with structured body', async () => {
    const { AssetUpstreamError } = await vi.importActual<typeof import('../../server/signers/asset')>(
      '../../server/signers/asset',
    )
    dispatchSpy.mockRejectedValueOnce(new AssetUpstreamError(403, 'NoPermission', 'denied', 'req-xyz'))
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/list')
      .send({ creds: testCreds })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error: { code: 'NoPermission', message: 'denied', requestId: 'req-xyz' },
    })
  })

  it('uses creds from req.body.creds when provided, ignoring module-level config', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/list')
      .send({
        pageNum: 1,
        creds: {
          accessKeyId: 'tenant-AK',
          accessKeySecret: 'tenant-SK',
          region: 'ap-southeast-1',
          service: 'ark',
          host: 'ark.ap-southeast-1.byteplusapi.com',
          projectName: 'tenant-project',
        },
      })
    expect(res.status).toBe(200)
    expect(dispatchSpy).toHaveBeenCalledWith(
      'list',
      expect.objectContaining({ pageNum: 1 }),
      expect.objectContaining({
        projectName: 'tenant-project',
        accessKeyId: 'tenant-AK',
      }),
    )
  })
})
