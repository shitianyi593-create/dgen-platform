import { randomUUID } from 'node:crypto'

// ── Constants ────────────────────────────────────────────────

/** Validity window for the PUT URL handed to the browser (in seconds). */
const PUT_URL_TTL = 15 * 60
/** Hard cap enforced by TOS for any pre-signed URL. */
const MAX_TTL = 7 * 24 * 60 * 60

// ── Types ────────────────────────────────────────────────────

export interface TosClientLike {
  getPreSignedUrl(input: {
    method: 'GET' | 'PUT'
    bucket: string
    key: string
    expires: number
  }): string
}

export interface TosPluginConfig {
  accessKeyId: string
  accessKeySecret: string
  region: string
  endpoint: string
  bucket: string
  keyPrefix: string
  defaultGetTtlSeconds: number
}

export interface SignPutInput {
  filename: string
  contentType?: string
  sizeBytes?: number
}
export interface SignPutOutput {
  url: string
  key: string
  expiresAt: number
}

export interface SignGetInput {
  key: string
  expiresSec?: number
}
export interface SignGetOutput {
  url: string
  expiresAt: number
}

// ── Pure helpers (testable) ──────────────────────────────────

/** Sanitize a filename so it's safe to use as part of a TOS key. */
export function sanitizeFilename(name: string): string {
  // Keep ASCII letters/digits/dot/dash/underscore; replace the rest with '-'.
  // Truncate to 80 chars to keep the key reasonable.
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return cleaned || 'file'
}

/** Build an object key under TOS_KEY_PREFIX/yyyy/MM/. */
export function buildObjectKey(
  prefix: string,
  filename: string,
  now: Date = new Date(),
  uuid: string = randomUUID(),
): string {
  const yyyy = now.getUTCFullYear().toString()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const safe = sanitizeFilename(filename)
  const cleanPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
  return `${cleanPrefix}${yyyy}/${mm}/${uuid}-${safe}`
}

// ── Handlers (testable independently of Vite) ────────────────

interface TosHandlerOverride {
  config: TosPluginConfig
  client: TosClientLike
}

export interface TosHandlers {
  signPut(input: SignPutInput, override?: TosHandlerOverride): SignPutOutput
  signGet(input: SignGetInput, override?: TosHandlerOverride): SignGetOutput
}

export function createTosHandlers(
  config: TosPluginConfig | null,
  client: TosClientLike | null,
): TosHandlers {
  return {
    signPut(input, override) {
      const effectiveConfig = override?.config ?? config
      const effectiveClient = override?.client ?? client
      if (!effectiveConfig) throw new Error('TOS config not provided (neither per-call nor server fallback)')
      if (!effectiveClient) throw new Error('TOS client not provided (neither per-call nor server fallback)')
      if (!input?.filename || typeof input.filename !== 'string') {
        throw new Error('filename is required')
      }
      const key = buildObjectKey(effectiveConfig.keyPrefix, input.filename)
      const url = effectiveClient.getPreSignedUrl({
        method: 'PUT',
        bucket: effectiveConfig.bucket,
        key,
        expires: PUT_URL_TTL,
      })
      return {
        url,
        key,
        expiresAt: Math.floor(Date.now() / 1000) + PUT_URL_TTL,
      }
    },

    signGet(input, override) {
      const effectiveConfig = override?.config ?? config
      const effectiveClient = override?.client ?? client
      if (!effectiveConfig) throw new Error('TOS config not provided (neither per-call nor server fallback)')
      if (!effectiveClient) throw new Error('TOS client not provided (neither per-call nor server fallback)')
      if (!input?.key || typeof input.key !== 'string') {
        throw new Error('key is required')
      }
      const requested = input.expiresSec
      let expires = effectiveConfig.defaultGetTtlSeconds
      if (typeof requested === 'number') {
        if (!Number.isFinite(requested) || requested <= 0) {
          throw new Error('expiresSec must be a positive integer')
        }
        if (requested > MAX_TTL) {
          throw new Error(`expiresSec must not exceed ${MAX_TTL} (7 days)`)
        }
        expires = Math.floor(requested)
      }
      const url = effectiveClient.getPreSignedUrl({
        method: 'GET',
        bucket: effectiveConfig.bucket,
        key: input.key,
        expires,
      })
      return {
        url,
        expiresAt: Math.floor(Date.now() / 1000) + expires,
      }
    },
  }
}
