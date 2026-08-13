import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const { mockDispatch } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
}))

vi.mock('../../server/signers/asset', async () => {
  const actual = await vi.importActual<typeof import('../../server/signers/asset')>(
    '../../server/signers/asset',
  )
  return {
    ...actual,
    createAssetHandlers: () => ({ dispatch: mockDispatch }),
  }
})

import { createApp } from '../../server/app'

const VALID_CREDS = {
  accessKeyId: 'AK123',
  accessKeySecret: 'SK456',
  region: 'ap-southeast-1',
  service: 'ark',
  host: 'ark.ap-southeast-1.byteplusapi.com',
  projectName: 'my-project',
}

describe('POST /local-api/asset/verify', () => {
  beforeEach(() => mockDispatch.mockClear())

  it('returns ok:true with projectName when ListAssetGroups succeeds', async () => {
    mockDispatch.mockResolvedValueOnce({ Items: [], Total: 0 })
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/verify')
      .send({ creds: VALID_CREDS })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, projectName: 'my-project' })
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith('group/list', { MaxResults: 1 }, VALID_CREDS)
  })

  it('returns ok:false with code when creds are wrong (SignatureDoesNotMatch)', async () => {
    const { AssetUpstreamError } = await vi.importActual<typeof import('../../server/signers/asset')>(
      '../../server/signers/asset',
    )
    mockDispatch.mockRejectedValueOnce(
      new AssetUpstreamError(401, 'SignatureDoesNotMatch', 'Signature does not match', 'req-abc'),
    )
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/verify')
      .send({ creds: VALID_CREDS })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: false,
      code: 'SignatureDoesNotMatch',
      message: 'Signature does not match',
      status: 401,
      requestId: 'req-abc',
    })
  })

  it('returns 400 when creds object is missing required fields', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/local-api/asset/verify')
      .send({ creds: { accessKeyId: 'AK' } })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})
