import { describe, it, expect, vi } from 'vitest'

type FakeRes = { status: (n: number) => { json: (b: unknown) => void } }

const { mockedCreateProxyMiddleware, mockedFixRequestBody } = vi.hoisted(() => ({
  mockedCreateProxyMiddleware: vi.fn(() => {
    // Return a middleware that 200s with a known marker
    return (_req: unknown, res: FakeRes) => {
      res.status(200).json({ proxied: true })
    }
  }),
  mockedFixRequestBody: vi.fn(),
}))

vi.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: mockedCreateProxyMiddleware,
  fixRequestBody: mockedFixRequestBody,
}))

import request from 'supertest'
import { createApp } from '../../server/app'

describe('ARK proxy', () => {
  it('mounts at /api and forwards via createProxyMiddleware', async () => {
    const app = createApp()
    const res = await request(app).get('/api/v3/some-endpoint')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ proxied: true })
    expect(mockedCreateProxyMiddleware).toHaveBeenCalledTimes(1)
    expect(mockedCreateProxyMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'https://ark.ap-southeast.bytepluses.com',
        changeOrigin: true,
        secure: true,
      }),
    )
  })

  it('forwards POST under /api', async () => {
    const app = createApp()
    const res = await request(app).post('/api/v3/anything').send({ x: 1 })
    expect(res.status).toBe(200)
  })

  // Regression guards for two bugs found via dev smoke after the cutover:
  //   1. Express's app.use('/api', ...) strips the mount prefix; without
  //      pathRewrite the upstream URL was missing /api and ARK 404'd.
  //   2. express.json() consumes the request body; without fixRequestBody
  //      the proxied request hung because Content-Length was set but no
  //      bytes followed.
  it('configures pathRewrite to restore /api prefix stripped by Express mount', () => {
    createApp()
    const calls = mockedCreateProxyMiddleware.mock.calls as unknown as Array<
      [{ pathRewrite?: Record<string, string> }]
    >
    const opts = calls.at(-1)?.[0]
    expect(opts?.pathRewrite).toEqual({ '^/': '/api/' })
  })

  it('wires fixRequestBody onto proxyReq so JSON-parsed bodies forward', () => {
    createApp()
    const calls = mockedCreateProxyMiddleware.mock.calls as unknown as Array<
      [{ on?: { proxyReq?: unknown } }]
    >
    const opts = calls.at(-1)?.[0]
    expect(opts?.on?.proxyReq).toBe(mockedFixRequestBody)
  })
})
