import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listAssetGroups,
  createAssetGroup,
  updateAssetGroup,
  deleteAssetGroup,
  listAssets,
  createAsset,
  getAsset,
  updateAsset,
  deleteAsset,
  countAssetsInGroup,
  pollUntilCancelled,
  HttpError,
  isTransientError,
} from '../api/asset'
import { useAuthStore } from '../stores/authStore'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({
    assetCreds: { accessKeyId: 'AK', accessKeySecret: 'SK', projectName: 'p' },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function mockOk(payload: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => payload,
  })
}

function mockErr(status: number, payload: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => payload,
  })
}

describe('asset API client — creds injection', () => {
  it('injects creds object with all 6 fields when assetCreds are filled', async () => {
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 50 })
    await listAssetGroups()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.creds).toMatchObject({
      accessKeyId: 'AK',
      accessKeySecret: 'SK',
      region: 'ap-southeast-1',
      service: 'ark',
      host: 'ark.ap-southeast-1.byteplusapi.com',
      projectName: 'p',
    })
  })

  it('omits creds entirely when assetCreds are all empty (env fallback path)', async () => {
    useAuthStore.setState({
      assetCreds: { accessKeyId: '', accessKeySecret: '', projectName: '' },
    })
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 50 })
    await listAssetGroups()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('creds')
  })
})

describe('asset API client — group endpoints', () => {
  it('listAssetGroups POSTs the right path with paging body', async () => {
    mockOk({
      Items: [
        {
          Id: 'group-1',
          Name: 'g1',
          Description: 'd',
          GroupType: 'AIGC',
          ProjectName: 'my-project',
          CreateTime: '2026-05-06T00:00:00Z',
          UpdateTime: '2026-05-06T00:00:00Z',
        },
      ],
      TotalCount: 1,
      PageNumber: 1,
      PageSize: 10,
    })

    const out = await listAssetGroups(
      { name: 'g' },
      { pageNumber: 1, pageSize: 10 },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/local-api/asset/group/list')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.Filter).toMatchObject({ Name: 'g' })
    expect(body.PageNumber).toBe(1)
    expect(body.PageSize).toBe(10)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toMatchObject({
      id: 'group-1',
      name: 'g1',
      groupType: 'AIGC',
    })
    expect(out.page.totalCount).toBe(1)
  })

  it('createAssetGroup sends Name + Description + GroupType', async () => {
    mockOk({ Id: 'group-1' })
    await createAssetGroup({ name: 'g1', description: 'd' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ Name: 'g1', Description: 'd', GroupType: 'AIGC' })
  })

  it('updateAssetGroup sends Name and Description', async () => {
    mockOk({ Id: 'group-1' })
    await updateAssetGroup('group-1', { name: 'n', description: 'd' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ Id: 'group-1', Name: 'n', Description: 'd' })
  })

  it('deleteAssetGroup sends only Id', async () => {
    mockOk({})
    await deleteAssetGroup('group-1')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ Id: 'group-1' })
  })
})

describe('asset API client — asset endpoints', () => {
  it('createAsset auto-fills nothing browser-side (server applies Moderation)', async () => {
    mockOk({ Id: 'asset-x' })
    const out = await createAsset({
      groupId: 'g1',
      url: 'https://example.com/x.jpg',
      assetType: 'Image',
      name: 'cat',
    })
    expect(out.id).toBe('asset-x')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({
      GroupId: 'g1',
      URL: 'https://example.com/x.jpg',
      AssetType: 'Image',
      Name: 'cat',
    })
    // The server-side plugin is responsible for adding Moderation.
    expect(body.Moderation).toBeUndefined()
  })

  it('throws an Error with code+message on upstream failure', async () => {
    mockErr(400, {
      error: { code: 'InvalidParam', message: 'X is required' },
    })
    await expect(
      createAsset({ groupId: 'g', url: 'u', assetType: 'Image' }),
    ).rejects.toThrow(/InvalidParam.*X is required/)
  })

  it('updateAsset only sends Name', async () => {
    mockOk({ Id: 'asset-x' })
    await updateAsset('asset-x', { name: 'new' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ Id: 'asset-x', Name: 'new' })
  })

  it('deleteAsset sends only Id', async () => {
    mockOk({})
    await deleteAsset('asset-x')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ Id: 'asset-x' })
  })

  it('listAssets passes filter + paging + sort', async () => {
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 10 })
    await listAssets(
      { groupId: 'g1', statuses: ['Active'], name: 'x' },
      { pageNumber: 1, pageSize: 10 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.Filter).toMatchObject({
      GroupIds: ['g1'],
      Statuses: ['Active'],
      Name: 'x',
    })
    expect(body.SortBy).toBe('CreateTime')
    expect(body.SortOrder).toBe('Desc')
  })

  it('getAsset normalises camelCase fields', async () => {
    mockOk({
      Id: 'asset-x',
      Name: 'n',
      URL: 'https://u',
      GroupId: 'g',
      AssetType: 'Image',
      Status: 'Active',
      ProjectName: 'p',
      CreateTime: '2026-05-06T00:00:00Z',
      UpdateTime: '2026-05-06T00:00:00Z',
    })
    const out = await getAsset('asset-x')
    expect(out).toMatchObject({
      id: 'asset-x',
      name: 'n',
      url: 'https://u',
      groupId: 'g',
      assetType: 'Image',
      status: 'Active',
    })
  })

  it('countAssetsInGroup hits /asset/list with PageSize=1 and returns TotalCount', async () => {
    mockOk({ Items: [], TotalCount: 86, PageNumber: 1, PageSize: 1 })
    const n = await countAssetsInGroup('group-x')
    expect(n).toBe(86)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/local-api/asset/list')
    const body = JSON.parse(init.body as string)
    expect(body.PageSize).toBe(1)
    expect(body.Filter.GroupIds).toEqual(['group-x'])
  })
})

describe('asset API client — HttpError shape', () => {
  it('throws an HttpError carrying status and code on non-2xx responses', async () => {
    mockErr(400, { error: { code: 'InvalidParam', message: 'oops' } })
    let caught: unknown
    try {
      await updateAsset('a1', { name: 'n' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(HttpError)
    const err = caught as HttpError
    expect(err.status).toBe(400)
    expect(err.code).toBe('InvalidParam')
    expect(err.message).toContain('InvalidParam')
    expect(err.message).toContain('oops')
  })

  it('throws an HttpError with status only when payload has no error object', async () => {
    mockErr(503, {})
    let caught: unknown
    try {
      await updateAsset('a1', { name: 'n' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(HttpError)
    expect((caught as HttpError).status).toBe(503)
    expect((caught as HttpError).code).toBeUndefined()
    expect((caught as HttpError).message).toContain('503')
  })

  it('HttpError is an instance of Error (back-compat with existing catch sites)', async () => {
    mockErr(400, { error: { code: 'InvalidParam', message: 'oops' } })
    await expect(
      updateAsset('a1', { name: 'n' }),
    ).rejects.toBeInstanceOf(Error)
  })
})

describe('asset API client — createAsset rate-limit retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries on 429 and resolves once upstream recovers', async () => {
    mockErr(429, { error: { code: 'TooManyRequests', message: 'slow down' } })
    mockOk({ Id: 'asset-1' })

    const promise = createAsset({
      groupId: 'g',
      url: 'u',
      assetType: 'Image',
    })
    await vi.runAllTimersAsync()
    const out = await promise

    expect(out.id).toBe('asset-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries on throttling-coded 4xx errors (e.g. 400 + Throttling)', async () => {
    mockErr(400, { error: { code: 'Throttling', message: 'too many requests' } })
    mockOk({ Id: 'asset-1' })

    const promise = createAsset({
      groupId: 'g',
      url: 'u',
      assetType: 'Image',
    })
    await vi.runAllTimersAsync()
    const out = await promise

    expect(out.id).toBe('asset-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on non-rate-limit errors (e.g. 400 InvalidParam)', async () => {
    mockErr(400, { error: { code: 'InvalidParam', message: 'bad' } })

    await expect(
      createAsset({ groupId: 'g', url: 'u', assetType: 'Image' }),
    ).rejects.toThrow(/InvalidParam/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after 4 attempts (1 initial + 3 retries) of 429', async () => {
    mockErr(429, {})
    mockErr(429, {})
    mockErr(429, {})
    mockErr(429, {})

    const promise = createAsset({
      groupId: 'g',
      url: 'u',
      assetType: 'Image',
    })
    // Attach a rejection handler synchronously so the unhandled rejection
    // doesn't trip Vitest while we drain the timers.
    const settled = promise.catch((e) => e)
    await vi.runAllTimersAsync()
    const err = await settled

    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does NOT retry on 5xx server errors that are not throttling', async () => {
    mockErr(500, { error: { code: 'InternalError', message: 'boom' } })

    await expect(
      createAsset({ groupId: 'g', url: 'u', assetType: 'Image' }),
    ).rejects.toThrow(/InternalError/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('pollUntilCancelled', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('resolves when fetcher returns a terminal asset', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ id: 'a1', status: 'Processing' })
      .mockResolvedValueOnce({ id: 'a1', status: 'Active' })
    const onTick = vi.fn()
    const { promise } = pollUntilCancelled('a1', { intervalMs: 100, fetcher: fetcher as unknown as (id: string) => Promise<import('../types/asset').Asset>, onTick })
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result.status).toBe('Active')
    expect(onTick).toHaveBeenCalledTimes(2)
  })

  it('stops polling when cancel() is called', async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 'a1', status: 'Processing' })
    const { promise, cancel } = pollUntilCancelled('a1', { intervalMs: 100, fetcher: fetcher as unknown as (id: string) => Promise<import('../types/asset').Asset> })
    await vi.advanceTimersByTimeAsync(100)
    cancel()
    await expect(promise).rejects.toThrow(/cancelled/i)
    const callsAtCancel = fetcher.mock.calls.length
    await vi.advanceTimersByTimeAsync(500)
    expect(fetcher.mock.calls.length).toBe(callsAtCancel)
  })
})

describe('isTransientError classification', () => {
  it('429 is transient', () => {
    expect(isTransientError(new HttpError(429, 'slow', 'TooManyRequests'))).toBe(true)
  })
  it('throttle-coded 4xx is transient', () => {
    expect(isTransientError(new HttpError(400, 'x', 'Throttling'))).toBe(true)
  })
  it('5xx is transient', () => {
    expect(isTransientError(new HttpError(503, 'down'))).toBe(true)
  })
  it('network/fetch reject (non-HttpError) is transient', () => {
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true)
  })
  it('400 InvalidParam is NOT transient', () => {
    expect(isTransientError(new HttpError(400, 'bad', 'InvalidParam'))).toBe(false)
  })
  it('403 AccessDenied is NOT transient', () => {
    expect(isTransientError(new HttpError(403, 'no', 'AccessDenied'))).toBe(false)
  })
  it('404 NotFound is NOT transient (handled as success elsewhere)', () => {
    expect(isTransientError(new HttpError(404, 'gone', 'NotFound'))).toBe(false)
  })
})
