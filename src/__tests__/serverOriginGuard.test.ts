import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'

import { isLoopbackEquivalent } from '../../server/config/env'
import { createApp } from '../../server/app'

afterEach(() => {
  delete process.env.PLATFORM_ORIGIN
  delete process.env.NODE_ENV
})

describe('isLoopbackEquivalent', () => {
  it('treats localhost and 127.0.0.1 with the same scheme+port as equivalent', () => {
    expect(isLoopbackEquivalent('http://127.0.0.1:5173', 'http://localhost:5173')).toBe(true)
    expect(isLoopbackEquivalent('http://localhost:5173', 'http://127.0.0.1:5173')).toBe(true)
  })

  it('returns false when ports differ', () => {
    expect(isLoopbackEquivalent('http://127.0.0.1:8080', 'http://localhost:5173')).toBe(false)
  })

  it('returns false when schemes differ', () => {
    expect(isLoopbackEquivalent('https://127.0.0.1:5173', 'http://localhost:5173')).toBe(false)
  })

  it('returns false for non-loopback origins', () => {
    expect(isLoopbackEquivalent('https://example.com', 'http://localhost:5173')).toBe(false)
    expect(isLoopbackEquivalent('http://192.168.1.10:5173', 'http://localhost:5173')).toBe(false)
  })

  it('returns false for malformed origins', () => {
    expect(isLoopbackEquivalent('not-a-url', 'http://localhost:5173')).toBe(false)
    expect(isLoopbackEquivalent('http://localhost:5173', 'not-a-url')).toBe(false)
  })
})

describe('originGuard — loopback-equivalent acceptance', () => {
  it('in development, accepts 127.0.0.1 origin when PLATFORM_ORIGIN is localhost', async () => {
    process.env.NODE_ENV = 'development'
    process.env.PLATFORM_ORIGIN = 'http://localhost:5173'
    const res = await request(createApp())
      .post('/local-api/download-asset')
      .set('Origin', 'http://127.0.0.1:5173')
      .send({})
    // 400 (bad body) — proves the request made it PAST the origin guard.
    // Pre-fix this returned 403 "Origin not allowed".
    expect(res.status).toBe(400)
    expect(res.body.error).not.toMatch(/Origin not allowed/)
  })

  it('in development, accepts localhost origin when PLATFORM_ORIGIN is 127.0.0.1', async () => {
    process.env.NODE_ENV = 'development'
    process.env.PLATFORM_ORIGIN = 'http://127.0.0.1:5173'
    const res = await request(createApp())
      .post('/local-api/download-asset')
      .set('Origin', 'http://localhost:5173')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).not.toMatch(/Origin not allowed/)
  })

  it('rejects unrelated origins in development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.PLATFORM_ORIGIN = 'http://localhost:5173'
    const res = await request(createApp())
      .post('/local-api/download-asset')
      .set('Origin', 'https://attacker.example.com')
      .send({})
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/Origin not allowed/)
  })

  it('in production, does NOT accept the loopback-equivalent (strict match only)', async () => {
    process.env.NODE_ENV = 'production'
    process.env.PLATFORM_ORIGIN = 'http://localhost:5173'
    const res = await request(createApp())
      .post('/local-api/download-asset')
      .set('Origin', 'http://127.0.0.1:5173')
      .send({})
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/Origin not allowed/)
  })
})
