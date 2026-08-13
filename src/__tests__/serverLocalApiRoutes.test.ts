import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import { Readable } from 'node:stream'

import { createApp } from '../../server/app'

afterEach(() => {
  vi.unstubAllGlobals()
})

function app() {
  return createApp()
}

describe('POST /local-api/download-asset', () => {
  it('returns 400 when body is missing url or filename', async () => {
    const res = await request(app())
      .post('/local-api/download-asset')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 when host is not on the allowlist', async () => {
    const res = await request(app())
      .post('/local-api/download-asset')
      .send({ url: 'https://attacker.example.com/x', filename: 'x.bin' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/host not allowed/)
  })

  it('streams upstream bytes back with attachment Content-Disposition', async () => {
    const fakeBody = Readable.toWeb(Readable.from(['hello world']))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fakeBody as ReadableStream, {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '11' },
    })))

    const res = await request(app())
      .post('/local-api/download-asset')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .send({ url: 'https://signed.bytepluses.com/v.mp4', filename: 'video.mp4' })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('video/mp4')
    expect(res.headers['content-disposition']).toMatch(/attachment.*video\.mp4/)
    expect((res.body as Buffer).toString('utf-8')).toBe('hello world')
  })
})
