/**
 * src/api/tos.ts 前端 client 测试
 *
 * 涵盖需求：
 * - signPutUrl / signGetUrl 呼叫正确 endpoint 并序列化 body
 * - 两支 sign API 在 server 回 4xx/5xx 时抛出带 error 消息的例外
 * - uploadToTos 完整流程：sign-put → PUT → sign-get
 * - PUT 失败时抛错且不再呼叫 sign-get
 * - 带 expiresSec 时序列化进 sign-get body
 * - file.type 为空时 PUT 带 application/octet-stream
 * - B6: 有 tosCreds 时 body 包含 creds 栏位；无时不含
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signPutUrl, signGetUrl, uploadToTos } from '../api/tos'
import { useAuthStore } from '../stores/authStore'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  // Seed tosCreds so creds injection is active by default
  useAuthStore.setState({
    tosCreds: {
      accessKeyId: 'test-ak',
      accessKeySecret: 'test-sk',
      region: 'ap-southeast-1',
      bucket: 'test-bucket',
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({
    tosCreds: {
      accessKeyId: '',
      accessKeySecret: '',
      region: 'ap-southeast-1',
      bucket: '',
    },
  })
})

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('signPutUrl', () => {
  it('POSTs filename / contentType / sizeBytes to /local-api/tos/sign-put', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        url: 'https://tos.example/p?sig=put',
        key: 'seedance-2-0/2026/04/uuid-x.mp4',
        expiresAt: 999,
      }),
    )

    const out = await signPutUrl('x.mp4', 'video/mp4', 12345)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/local-api/tos/sign-put')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({
      filename: 'x.mp4',
      contentType: 'video/mp4',
      sizeBytes: 12345,
    })
    expect(out.key).toBe('seedance-2-0/2026/04/uuid-x.mp4')
  })

  it('throws with the server-provided error message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'creds required' }, { ok: false, status: 400 }),
    )

    await expect(signPutUrl('x.mp4')).rejects.toThrow('creds required')
  })

  it('falls back to HTTP status when error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)

    await expect(signPutUrl('x.mp4')).rejects.toThrow('HTTP 502')
  })
})

describe('signGetUrl', () => {
  it('POSTs key + expiresSec to /local-api/tos/sign-get', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ url: 'https://tos.example/g?sig=get', expiresAt: 1234 }),
    )

    await signGetUrl('seedance-2-0/x.mp4', 600)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/local-api/tos/sign-get')
    expect(JSON.parse(init.body as string)).toMatchObject({
      key: 'seedance-2-0/x.mp4',
      expiresSec: 600,
    })
  })

  it('omits expiresSec when not provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ url: 'u', expiresAt: 1 }),
    )

    await signGetUrl('seedance-2-0/x.mp4')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.key).toBe('seedance-2-0/x.mp4')
    // explicit undefined is fine, server-side defaults kick in
    expect(body.expiresSec).toBeUndefined()
  })
})

describe('uploadToTos', () => {
  it('signs PUT, uploads, then signs GET', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          url: 'https://tos.example/put?sig=put',
          key: 'seedance-2-0/2026/04/uuid-cat.mp4',
          expiresAt: 100,
        }),
      )
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce(
        jsonResponse({
          url: 'https://tos.example/get?sig=get&X-Tos-Expires=10800',
          expiresAt: 10800,
        }),
      )

    const file = new File(['hello'], 'cat.mp4', { type: 'video/mp4' })
    const result = await uploadToTos(file)

    // sign-put call
    expect(fetchMock.mock.calls[0][0]).toBe('/local-api/tos/sign-put')

    // PUT call to TOS
    const [putUrl, putInit] = fetchMock.mock.calls[1]
    expect(putUrl).toBe('https://tos.example/put?sig=put')
    expect(putInit.method).toBe('PUT')
    expect(putInit.body).toBe(file)
    expect(putInit.headers).toMatchObject({ 'Content-Type': 'video/mp4' })

    // sign-get call
    expect(fetchMock.mock.calls[2][0]).toBe('/local-api/tos/sign-get')

    expect(result.key).toBe('seedance-2-0/2026/04/uuid-cat.mp4')
    expect(result.viewUrl).toContain('X-Tos-Expires=10800')
    expect(result.expiresAt).toBe(10800)
  })

  it('forwards expiresSec to sign-get', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ url: 'https://put', key: 'k', expiresAt: 1 }))
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce(jsonResponse({ url: 'https://get', expiresAt: 60 }))

    const file = new File(['x'], 'a.mp4', { type: 'video/mp4' })
    await uploadToTos(file, { expiresSec: 60 })

    const signGetBody = JSON.parse(fetchMock.mock.calls[2][1].body as string)
    expect(signGetBody.expiresSec).toBe(60)
  })

  it('throws and skips sign-get when PUT fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ url: 'https://put', key: 'k', expiresAt: 1 }))
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response)

    const file = new File(['x'], 'a.mp4', { type: 'video/mp4' })
    await expect(uploadToTos(file)).rejects.toThrow(/TOS upload failed: HTTP 403/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses application/octet-stream when file has no MIME type', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ url: 'https://put', key: 'k', expiresAt: 1 }))
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce(jsonResponse({ url: 'https://get', expiresAt: 60 }))

    const file = new File(['x'], 'a.bin')
    await uploadToTos(file)

    // sign-put body uses fallback
    const signPutBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(signPutBody.contentType).toBe('application/octet-stream')

    // PUT header uses fallback
    const putHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>
    expect(putHeaders['Content-Type']).toBe('application/octet-stream')
  })
})

describe('B6: creds injection', () => {
  it('injects body.creds when tosCreds are set', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ url: 'https://tos.example/p?sig=put', key: 'k', expiresAt: 999 }),
    )

    await signPutUrl('x.mp4', 'video/mp4', 100)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.creds).toMatchObject({
      accessKeyId: 'test-ak',
      accessKeySecret: 'test-sk',
      region: 'ap-southeast-1',
      bucket: 'test-bucket',
      keyPrefix: 'seedance-2-0/',
      defaultGetTtlSeconds: 10800,
    })
  })

  it('parses bucket/prefix syntax — body.creds.bucket has no slash, keyPrefix carries the user prefix', async () => {
    useAuthStore.setState({
      tosCreds: {
        accessKeyId: 'test-ak',
        accessKeySecret: 'test-sk',
        region: 'ap-southeast-1',
        bucket: 'mybucket/foo/bar',
      },
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ url: 'https://tos.example/p?sig=put', key: 'k', expiresAt: 999 }),
    )

    await signPutUrl('x.mp4', 'video/mp4', 100)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.creds.bucket).toBe('mybucket')
    expect(body.creds.keyPrefix).toBe('foo/bar/')
  })

  it('plain bucket (no slash) → keeps default keyPrefix seedance-2-0/', async () => {
    // tosCreds already set in beforeEach to bucket: 'test-bucket' (no slash)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ url: 'https://tos.example/p?sig=put', key: 'k', expiresAt: 999 }),
    )

    await signPutUrl('x.mp4', 'video/mp4', 100)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.creds.bucket).toBe('test-bucket')
    expect(body.creds.keyPrefix).toBe('seedance-2-0/')
  })

  it('omits body.creds when tosCreds are all empty', async () => {
    useAuthStore.setState({
      tosCreds: {
        accessKeyId: '',
        accessKeySecret: '',
        region: 'ap-southeast-1',
        bucket: '',
      },
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ url: 'https://tos.example/p?sig=put', key: 'k', expiresAt: 999 }),
    )

    await signPutUrl('x.mp4', 'video/mp4', 100)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.creds).toBeUndefined()
  })
})
