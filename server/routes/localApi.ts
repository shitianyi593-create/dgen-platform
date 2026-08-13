import { Router } from 'express'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

const DOWNLOAD_TIMEOUT_MS = 120_000

// SSRF guard: only allow https fetches to BytePlus-issued URLs (signed video,
// pre-signed TOS, ARK asset URLs). Without this, any caller can ask the server
// to fetch arbitrary internal URLs (cloud metadata, intranet hosts, etc.) and
// stream them back through /download-asset.
const ALLOWED_HOST_SUFFIXES = [
  'bytepluses.com',
  'byteplus.com',
  'volces.com',
] as const

function isAllowedDownloadUrl(rawUrl: string): boolean {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return false
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
}

function sanitizeAsciiFilename(filename: string): string {
  return filename.replace(/[\r\n"\\]/g, '_')
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export function createLocalApiRouter(): Router {
  const router = Router()

  // POST /download-asset — stateless SSRF-allowlisted proxy. Streams the
  // upstream body back to the client as an attachment, never writes to disk.
  router.post('/download-asset', async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Invalid JSON body' })
      return
    }
    const { url: assetUrl, filename } = req.body as { url?: string; filename?: string }
    if (!assetUrl || !filename) {
      res.status(400).json({ error: 'url and filename are required' })
      return
    }
    if (!isAllowedDownloadUrl(assetUrl)) {
      res.status(400).json({ error: 'url host not allowed' })
      return
    }

    try {
      const upstream = await fetchWithTimeout(assetUrl, DOWNLOAD_TIMEOUT_MS)
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: `Upstream HTTP ${upstream.status}` })
        return
      }
      const ct = upstream.headers.get('content-type') ?? 'application/octet-stream'
      const cl = upstream.headers.get('content-length')
      res.setHeader('Content-Type', ct)
      if (cl) res.setHeader('Content-Length', cl)
      const safeAscii = sanitizeAsciiFilename(filename)
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      await pipeline(
        Readable.fromWeb(upstream.body as NodeReadableStream),
        res,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Download failed'
      res.status(502).json({ error: msg })
    }
  })

  return router
}
