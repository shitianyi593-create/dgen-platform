import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSseParser, postSse, SSE_DONE, type SseEvent } from '../api/sse'

describe('createSseParser', () => {
  it('解析单行 data 事件与 [DONE]', () => {
    const p = createSseParser()
    const events = p.feed('data: {"a":1}\n\ndata: [DONE]\n\n')
    expect(events).toEqual([
      { event: undefined, data: '{"a":1}' },
      { event: undefined, data: '[DONE]' },
    ])
  })

  it('跨 chunk 边界的行要正确重组', () => {
    const p = createSseParser()
    expect(p.feed('data: {"content":"he')).toEqual([])
    const events = p.feed('llo"}\n')
    expect(events).toEqual([{ event: undefined, data: '{"content":"hello"}' }])
  })

  it('event: 行附挂到下一个 data 行（Responses API 格式）', () => {
    const p = createSseParser()
    const events = p.feed('event: response.output_text.delta\ndata: {"delta":"x"}\n\n')
    expect(events).toEqual([
      { event: 'response.output_text.delta', data: '{"delta":"x"}' },
    ])
    // event 名称不能黏到下一个无 event 的事件上
    expect(p.feed('data: {"y":2}\n')).toEqual([{ event: undefined, data: '{"y":2}' }])
  })

  it('忽略注解与其他栏位；容忍 \\r\\n', () => {
    const p = createSseParser()
    const events = p.feed(': keep-alive\r\nid: 3\r\ndata: {"z":1}\r\n\r\n')
    expect(events).toEqual([{ event: undefined, data: '{"z":1}' }])
  })

  it('flush 吐出残留的未换行 data 行', () => {
    const p = createSseParser()
    expect(p.feed('data: tail')).toEqual([])
    expect(p.flush()).toEqual([{ event: undefined, data: 'tail' }])
  })
})

// ── postSse ──

function sseResponse(chunks: string[], init?: { status?: number; body?: string }) {
  if (init?.status && init.status >= 400) {
    return {
      ok: false, status: init.status,
      text: async () => init.body ?? '',
    } as unknown as Response
  }
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream } as unknown as Response
}

describe('postSse', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    sessionStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('POST JSON、逐事件回呼、回传原始 chunk log', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(['data: {"n":1}\n\n', 'data: {"n":2}\n\ndata: [DONE]\n\n']),
    )
    const seen: SseEvent[] = []
    const raw = await postSse('/api/v3/chat/completions', { model: 'ep-x' }, {
      onEvent: (e) => seen.push(e),
    })
    expect(seen.map((e) => e.data)).toEqual(['{"n":1}', '{"n":2}', SSE_DONE])
    expect(raw).toEqual(['{"n":1}', '{"n":2}', '[DONE]'])
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/v3/chat/completions')
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init!.body as string)).toEqual({ model: 'ep-x' })
  })

  it('多字节字符跨 chunk（字节层级）：UTF-8 流式解码要正确重组', async () => {
    // 「世」在 UTF-8 占 3 bytes；把它从中间切开，强迫走
    // decoder.decode(value, { stream: true }) 的跨 chunk 重组路径。
    const bytes = new TextEncoder().encode('data: {"c":"世"}\n\n')
    const splitAt = bytes.indexOf(0xe4) + 1 // 0xe4 = 「世」的第一个 byte
    expect(splitAt).toBeGreaterThan(0)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt))
        controller.enqueue(bytes.slice(splitAt))
        controller.close()
      },
    })
    vi.mocked(fetch).mockResolvedValueOnce(
      { ok: true, status: 200, body: stream } as unknown as Response,
    )
    const seen: SseEvent[] = []
    await postSse('/api/v3/chat/completions', {}, { onEvent: (e) => seen.push(e) })
    expect(seen).toEqual([{ event: undefined, data: '{"c":"世"}' }])
  })

  it('非 2xx：抛出带 status 与 body 的正规化错误', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse([], { status: 401, body: '{"error":{"message":"bad key"}}' }),
    )
    await expect(
      postSse('/api/v3/chat/completions', {}, { onEvent: () => {} }),
    ).rejects.toMatchObject({ message: 'bad key', status: 401 })
  })

  it('onEvent 抛错会中断并外传（Responses 的 error 事件用）', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(sseResponse(['data: {"bad":1}\n\n']))
    await expect(
      postSse('/api/v3/responses', {}, { onEvent: () => { throw new Error('stream fail') } }),
    ).rejects.toThrow('stream fail')
  })

  it('流式途中抛错：外传的错误带上已收到的 chunk log（供保留部分内容）', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n']),
    )
    let count = 0
    const err = await postSse('/api/v3/chat/completions', {}, {
      onEvent: () => { if (++count === 2) throw new Error('boom') },
    }).catch((e) => e as Error & { sseChunks?: string[] })
    expect((err as Error).message).toBe('boom')
    expect((err as { sseChunks?: string[] }).sseChunks).toEqual(['{"n":1}', '{"n":2}'])
  })
})
