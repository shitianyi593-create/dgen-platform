import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createApp } from '../../server/app'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-fallback-test-'))

afterEach(() => {
  delete process.env.DIST_DIR
})

// Clean up the shared tmp root after all tests
import { afterAll } from 'vitest'
afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('SPA fallback: static asset hit', () => {
  it('GET /assets/main.js returns 200 with file contents and JS content-type', async () => {
    const distDir = path.join(tmpRoot, 'dist-static-asset')
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(distDir, 'assets', 'main.js'), 'console.log("hello")')
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>app</body></html>')
    process.env.DIST_DIR = distDir

    const res = await request(createApp()).get('/assets/main.js')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/javascript/)
    expect(res.text).toBe('console.log("hello")')
  })
})

describe('SPA fallback: unknown route returns index.html', () => {
  it('GET /any/random/route returns 200 with index.html content', async () => {
    const distDir = path.join(tmpRoot, 'dist-fallback')
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>spa</body></html>')
    process.env.DIST_DIR = distDir

    const res = await request(createApp()).get('/any/random/route')

    expect(res.status).toBe(200)
    expect(res.text).toContain('<html>')
  })
})

describe('SPA fallback: missing dist/ in production', () => {
  it('GET / returns 500 with helpful error message', async () => {
    const savedNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.DIST_DIR = path.join(tmpRoot, 'nonexistent-dist')

    try {
      const res = await request(createApp()).get('/')

      expect(res.status).toBe(500)
      expect(res.text).toMatch(/dist\/ missing/)
    } finally {
      process.env.NODE_ENV = savedNodeEnv
    }
  })
})

describe('SPA fallback: missing dist/ in development', () => {
  it('GET / returns 404 (Express default, no route handles it)', async () => {
    const savedNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    process.env.DIST_DIR = path.join(tmpRoot, 'nonexistent-dist')

    try {
      const res = await request(createApp()).get('/')

      expect(res.status).toBe(404)
    } finally {
      process.env.NODE_ENV = savedNodeEnv
    }
  })
})

describe('SPA fallback: /health route still wins', () => {
  it('GET /health returns { ok: true } JSON, not SPA index.html', async () => {
    const distDir = path.join(tmpRoot, 'dist-health')
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>spa</body></html>')
    process.env.DIST_DIR = distDir

    const res = await request(createApp()).get('/health')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/json/)
    expect(res.body).toEqual({ ok: true })
  })
})
