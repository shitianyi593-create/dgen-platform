/**
 * vite-plugin-asset 纯函数 / handler 单元测试
 *
 * Covers: signing primitives, signRequest, createAssetHandlers, route table.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  signRequest,
  hexSha256,
  hmacHex,
  createAssetHandlers,
  AssetUpstreamError,
  ROUTE_TO_ACTION,
} from '../../server/signers/asset'

const FIXED_NOW = new Date('2026-05-06T03:00:00Z')

const baseConfig = {
  accessKeyId: 'AKAPexample',
  accessKeySecret: 'SK-example',
  region: 'ap-southeast-1',
  service: 'ark',
  host: 'ark.ap-southeast-1.byteplusapi.com',
  projectName: 'my-project',
}

describe('hexSha256', () => {
  it('hashes empty string to the canonical empty hash', () => {
    expect(hexSha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('hashes a known JSON body deterministically', () => {
    expect(hexSha256('{"a":1}')).toBe(hexSha256('{"a":1}'))
    // expected value computed via:
    //   node -e 'console.log(require("crypto").createHash("sha256").update(`{"a":1}`).digest("hex"))'
    expect(hexSha256('{"a":1}')).toBe(
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    )
  })
})

describe('hmacHex', () => {
  it('produces a deterministic 64-char hex result', () => {
    const out = hmacHex('key', 'message')
    expect(out).toMatch(/^[0-9a-f]{64}$/)
  })

  it('chains for derived keys (kDate → kRegion)', () => {
    const kDate = hmacHex('SK', '20260506')
    const kRegion = hmacHex(kDate, 'ap-southeast-1')
    expect(kRegion).toMatch(/^[0-9a-f]{64}$/)
    expect(kRegion).not.toBe(kDate)
  })
})

describe('signRequest', () => {
  it('produces stable Authorization header for identical inputs', () => {
    const a = signRequest({
      action: 'ListAssetGroups',
      version: '2024-01-01',
      body: '{"Filter":{"GroupType":"AIGC"},"PageNumber":1,"PageSize":10}',
      config: baseConfig,
      now: FIXED_NOW,
    })
    const b = signRequest({
      action: 'ListAssetGroups',
      version: '2024-01-01',
      body: '{"Filter":{"GroupType":"AIGC"},"PageNumber":1,"PageSize":10}',
      config: baseConfig,
      now: FIXED_NOW,
    })
    expect(a.headers.Authorization).toBe(b.headers.Authorization)
  })

  it('includes required headers and the right credential scope', () => {
    const result = signRequest({
      action: 'ListAssetGroups',
      version: '2024-01-01',
      body: '{}',
      config: baseConfig,
      now: FIXED_NOW,
    })
    expect(result.headers['Content-Type']).toBe('application/json')
    expect(result.headers.Host).toBe('ark.ap-southeast-1.byteplusapi.com')
    expect(result.headers['X-Date']).toBe('20260506T030000Z')
    expect(result.headers['X-Content-Sha256']).toMatch(/^[0-9a-f]{64}$/)

    const auth = result.headers.Authorization
    expect(
      auth.startsWith(
        'HMAC-SHA256 Credential=AKAPexample/20260506/ap-southeast-1/ark/request',
      ),
    ).toBe(true)
    expect(auth).toContain(
      'SignedHeaders=content-type;host;x-content-sha256;x-date',
    )
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('targets the right URL with action+version query', () => {
    const result = signRequest({
      action: 'CreateAsset',
      version: '2024-01-01',
      body: '{}',
      config: baseConfig,
      now: FIXED_NOW,
    })
    expect(result.url).toBe(
      'https://ark.ap-southeast-1.byteplusapi.com/?Action=CreateAsset&Version=2024-01-01',
    )
  })

  it('different bodies produce different signatures', () => {
    const a = signRequest({
      action: 'ListAssetGroups',
      version: '2024-01-01',
      body: '{"x":1}',
      config: baseConfig,
      now: FIXED_NOW,
    })
    const b = signRequest({
      action: 'ListAssetGroups',
      version: '2024-01-01',
      body: '{"x":2}',
      config: baseConfig,
      now: FIXED_NOW,
    })
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })

  it('different timestamps produce different signatures', () => {
    const a = signRequest({
      action: 'ListAssetGroups',
      version: '2024-01-01',
      body: '{}',
      config: baseConfig,
      now: FIXED_NOW,
    })
    const b = signRequest({
      action: 'ListAssetGroups',
      version: '2024-01-01',
      body: '{}',
      config: baseConfig,
      now: new Date('2026-05-06T03:00:01Z'),
    })
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })

  // suppress unused-import lint noise from test runner if vi isn't otherwise used
  void vi
})

describe('createAssetHandlers', () => {
  const config = {
    accessKeyId: 'AK',
    accessKeySecret: 'SK',
    region: 'ap-southeast-1',
    service: 'ark',
    host: 'ark.ap-southeast-1.byteplusapi.com',
    projectName: 'my-project',
  }

  // typed to match `fetch` so mock.calls preserves the [url, init] tuple
  type FetchLike = (
    url: string,
    init: RequestInit,
  ) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

  function makeFetchOk(result: unknown) {
    const fn: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ResponseMetadata: { RequestId: 'rid-1' },
          Result: result,
        }),
    })
    return vi.fn(fn)
  }

  function makeFetchErr(status: number, body: unknown) {
    const fn: FetchLike = async () => ({
      ok: false,
      status,
      text: async () => JSON.stringify(body),
    })
    return vi.fn(fn)
  }

  it('forwards body to ARK and unwraps Result', async () => {
    const fetchSpy = makeFetchOk({
      Items: [],
      TotalCount: 0,
      PageNumber: 1,
      PageSize: 10,
    })
    const handlers = createAssetHandlers(config, { fetch: fetchSpy as never })
    const out = await handlers.dispatch('group/list', {
      Filter: { GroupType: 'AIGC' },
      PageNumber: 1,
      PageSize: 10,
    })
    expect(out).toEqual({
      Items: [],
      TotalCount: 0,
      PageNumber: 1,
      PageSize: 10,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toContain('Action=ListAssetGroups')
    expect(url).toContain('Version=2024-01-01')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).ProjectName).toBe('my-project')
  })

  it('FORCES ProjectName to config value, ignoring client-supplied value', async () => {
    const fetchSpy = makeFetchOk({ Items: [] })
    const handlers = createAssetHandlers(config, { fetch: fetchSpy as never })
    await handlers.dispatch('list', {
      Filter: { GroupType: 'AIGC' },
      PageNumber: 1,
      PageSize: 10,
      ProjectName: 'malicious-other-project',
    })
    const init = fetchSpy.mock.calls[0][1] as unknown as { body: string }
    expect(JSON.parse(init.body).ProjectName).toBe('my-project')
  })

  it('automatically applies Moderation Skip on asset/create', async () => {
    const fetchSpy = makeFetchOk({ Id: 'asset-x' })
    const handlers = createAssetHandlers(config, { fetch: fetchSpy as never })
    await handlers.dispatch('create', {
      GroupId: 'g1',
      URL: 'https://example.com/x.jpg',
      AssetType: 'Image',
    })
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as unknown as { body: string }).body,
    )
    expect(body.Moderation).toEqual({ Strategy: 'Skip' })
  })

  it('forces Filter.GroupType=AIGC on list endpoints even if missing', async () => {
    const fetchSpy = makeFetchOk({ Items: [] })
    const handlers = createAssetHandlers(config, { fetch: fetchSpy as never })
    await handlers.dispatch('list', {
      Filter: { Name: 'x' },
      PageNumber: 1,
      PageSize: 10,
    })
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as unknown as { body: string }).body,
    )
    expect(body.Filter.GroupType).toBe('AIGC')
    expect(body.Filter.Name).toBe('x')
  })

  it('throws AssetUpstreamError on 4xx with code+message', async () => {
    const fetchSpy = makeFetchErr(400, {
      ResponseMetadata: {
        Error: { Code: 'InvalidParam', Message: 'GroupId required' },
        RequestId: 'rid-2',
      },
    })
    const handlers = createAssetHandlers(config, { fetch: fetchSpy as never })
    await expect(
      handlers.dispatch('create', {
        URL: 'x',
        AssetType: 'Image',
        GroupId: '',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'InvalidParam',
      message: 'GroupId required',
    })
    // Also assert the thrown is the right class
    try {
      await handlers.dispatch('create', {
        URL: 'x',
        AssetType: 'Image',
        GroupId: '',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(AssetUpstreamError)
    }
  })

  it('throws on unknown route', async () => {
    const handlers = createAssetHandlers(config, { fetch: vi.fn() as never })
    await expect(handlers.dispatch('unknown/route', {})).rejects.toThrow(
      /unknown action/i,
    )
  })

  it('accepts a per-call config override that wins over the module-level config', async () => {
    const overrideCfg = { ...config, projectName: 'tenant-A' }
    const fetchSpy = makeFetchOk({ ok: 1 })
    const handlers = createAssetHandlers(config, { fetch: fetchSpy as never })
    await handlers.dispatch('list', {}, overrideCfg)

    // The signed URL / body should reflect tenant-A's projectName
    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as unknown as { body: string }).body)
    expect(sentBody.ProjectName).toBe('tenant-A')
  })
})

/**
 * Integration-level guard: every URL the frontend's src/api/asset.ts
 * actually POSTs to MUST resolve, after the connect prefix `/local-api/asset`
 * is stripped, into a key that exists in ROUTE_TO_ACTION.
 *
 * We had a bug where 'asset/create' was a key in the route table but the
 * frontend posts to `/local-api/asset/create`, which arrives at the handler
 * as just `create` after the strip — leading to silent 404s on every asset
 * (non-group) endpoint. Pin it down here so it can never regress.
 */
describe('frontend URL ↔ ROUTE_TO_ACTION contract', () => {
  // Mirrors the path strings used in src/api/asset.ts.
  const FRONTEND_PATHS = [
    '/local-api/asset/group/list',
    '/local-api/asset/group/create',
    '/local-api/asset/group/get',
    '/local-api/asset/group/update',
    '/local-api/asset/group/delete',
    '/local-api/asset/list',
    '/local-api/asset/create',
    '/local-api/asset/get',
    '/local-api/asset/update',
    '/local-api/asset/delete',
  ]

  it.each(FRONTEND_PATHS)(
    'POST %s resolves to a known route after the middleware strip',
    (fullPath) => {
      // Connect's `use('/local-api/asset', ...)` strips the prefix; the
      // handler then drops the leading slash and the query string.
      const stripped = fullPath
        .replace(/^\/local-api\/asset/, '')
        .replace(/^\//, '')
        .split('?')[0]
      expect(ROUTE_TO_ACTION[stripped]).toBeTruthy()
    },
  )
})
