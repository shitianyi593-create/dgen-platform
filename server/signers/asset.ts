/**
 * Pure ARK Asset signing logic.
 *
 * IMPORTANT: Uses the user-supplied Asset Library AK/SK (sent per-request
 * as creds). It MUST NOT reuse TOS_ACCESS_KEY / TOS_SECRET_KEY which may
 * live on a different BytePlus account.
 */
import { createHash, createHmac } from 'node:crypto'

// ── Types ────────────────────────────────────────────────────

export interface AssetPluginConfig {
  accessKeyId: string
  accessKeySecret: string
  region: string
  service: string
  host: string
  projectName: string
}

export interface SignRequestInput {
  action: string
  version: string
  body: string
  config: AssetPluginConfig
  now?: Date
}

export interface SignRequestOutput {
  url: string
  headers: Record<string, string>
}

// ── Pure helpers ─────────────────────────────────────────────

/** Hex SHA-256 of a string or Buffer. */
export function hexSha256(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex')
}

/** HMAC-SHA256 returning hex. Accepts string or Buffer key. */
export function hmacHex(key: string | Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex')
}

/** HMAC-SHA256 returning a Buffer (used for chained key derivation). */
function hmacBuf(key: string | Buffer, message: string): Buffer {
  return createHmac('sha256', key).update(message).digest()
}

function formatXDate(now: Date): string {
  // YYYYMMDDTHHMMSSZ — UTC, no separators
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z'
  )
}

function dateStamp(xDate: string): string {
  // First 8 chars of YYYYMMDDTHHMMSSZ
  return xDate.slice(0, 8)
}

/**
 * Build a signed POST request to ARK Open API.
 * The signature follows the BytePlus / Volcengine V4 algorithm:
 *
 *   canonicalRequest = METHOD\nURI\nQUERY\nHEADERS\n\nSIGNED_HEADERS\nPAYLOAD_HASH
 *   stringToSign     = "HMAC-SHA256"\nX-Date\nCREDENTIAL_SCOPE\nHASH(canonicalRequest)
 *   kDate    = HMAC(SK, YYYYMMDD)
 *   kRegion  = HMAC(kDate, region)
 *   kService = HMAC(kRegion, service)
 *   kSigning = HMAC(kService, "request")
 *   signature = HMAC(kSigning, stringToSign) → hex
 */
export function signRequest(input: SignRequestInput): SignRequestOutput {
  const { action, version, body, config } = input
  const now = input.now ?? new Date()
  const xDate = formatXDate(now)
  const date = dateStamp(xDate)

  const payloadHash = hexSha256(body)

  const canonicalUri = '/'
  // ARK uses query-string-based action dispatch; alphabetical key order.
  const canonicalQuery = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(
    version,
  )}`

  // Headers we sign (lowercase names, trimmed values, sorted)
  const headersToSign: Array<[string, string]> = (
    [
      ['content-type', 'application/json'],
      ['host', config.host],
      ['x-content-sha256', payloadHash],
      ['x-date', xDate],
    ] as Array<[string, string]>
  ).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const canonicalHeaders =
    headersToSign.map(([k, v]) => `${k}:${v.trim()}`).join('\n') + '\n'
  const signedHeaders = headersToSign.map(([k]) => k).join(';')

  const canonicalRequest = [
    'POST',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${date}/${config.region}/${config.service}/request`

  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    hexSha256(canonicalRequest),
  ].join('\n')

  // Derive signing key
  const kDate = hmacBuf(config.accessKeySecret, date)
  const kRegion = hmacBuf(kDate, config.region)
  const kService = hmacBuf(kRegion, config.service)
  const kSigning = hmacBuf(kService, 'request')
  const signature = createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex')

  const authorization =
    `HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`

  return {
    url: `https://${config.host}/?Action=${encodeURIComponent(
      action,
    )}&Version=${encodeURIComponent(version)}`,
    headers: {
      'Content-Type': 'application/json',
      Host: config.host,
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
  }
}

// ── Action mapping ───────────────────────────────────────────
//
// Keys are EXACTLY what's left after the connect middleware strips its
// prefix `/local-api/asset/`:
//   /local-api/asset/group/list   → 'group/list'   → ListAssetGroups
//   /local-api/asset/list         → 'list'         → ListAssets
// (asset routes deliberately have no 'asset/' prefix because the strip
// already consumed it; group routes still carry 'group/'.)

export const ROUTE_TO_ACTION: Record<string, string> = {
  'group/create': 'CreateAssetGroup',
  'group/list':   'ListAssetGroups',
  'group/get':    'GetAssetGroup',
  'group/update': 'UpdateAssetGroup',
  'group/delete': 'DeleteAssetGroup',
  'create':       'CreateAsset',
  'list':         'ListAssets',
  'get':          'GetAsset',
  'update':       'UpdateAsset',
  'delete':       'DeleteAsset',
}

const VERSION = '2024-01-01'

const LIST_ACTIONS = new Set(['ListAssetGroups', 'ListAssets'])

/**
 * Thrown when ARK returns a non-2xx response. Surfaces the BytePlus
 * Error.Code / Error.Message so the browser can render them faithfully.
 */
export class AssetUpstreamError extends Error {
  status: number
  code?: string
  requestId?: string
  constructor(
    status: number,
    code: string | undefined,
    message: string,
    requestId?: string,
  ) {
    super(message)
    this.name = 'AssetUpstreamError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

export interface AssetHandlersDeps {
  /** Inject `fetch` for tests; defaults to global fetch. */
  fetch?: typeof fetch
}

export interface AssetHandlers {
  /** Called per request. If overrideConfig is provided, it replaces the
   *  module-level config for this dispatch only. */
  dispatch(
    route: string,
    body: Record<string, unknown>,
    overrideConfig?: AssetPluginConfig,
  ): Promise<unknown>
}

interface ArkErrorEnvelope {
  ResponseMetadata?: {
    Error?: { Code?: string; Message?: string }
    RequestId?: string
  }
}

interface ArkResultEnvelope {
  Result?: unknown
}

export function createAssetHandlers(
  config: AssetPluginConfig | null,
  deps: AssetHandlersDeps = {},
): AssetHandlers {
  const fetchFn = deps.fetch ?? globalThis.fetch
  return {
    async dispatch(route, body, overrideConfig) {
      const effectiveConfig = overrideConfig ?? config
      if (!effectiveConfig) {
        throw new Error('Asset config not provided (neither per-call nor server fallback)')
      }

      const action = ROUTE_TO_ACTION[route]
      if (!action) throw new Error(`unknown action: ${route}`)

      // Server-forced ProjectName + per-action defaults
      const finalBody: Record<string, unknown> = {
        ...body,
        ProjectName: effectiveConfig.projectName,
      }
      if (action === 'CreateAsset') {
        finalBody.Moderation = { Strategy: 'Skip' }
      }
      // ListAssetGroups / ListAssets always require Filter.GroupType=AIGC.
      if (LIST_ACTIONS.has(action)) {
        const filter = (finalBody.Filter ?? {}) as Record<string, unknown>
        finalBody.Filter = { ...filter, GroupType: 'AIGC' }
      }

      const bodyStr = JSON.stringify(finalBody)
      const signed = signRequest({
        action,
        version: VERSION,
        body: bodyStr,
        config: effectiveConfig,
      })

      const res = await fetchFn(signed.url, {
        method: 'POST',
        headers: signed.headers,
        body: bodyStr,
      })

      const text = await res.text()
      let parsed: unknown
      try {
        parsed = text ? JSON.parse(text) : {}
      } catch {
        parsed = { raw: text }
      }

      if (!res.ok) {
        const meta = (parsed as ArkErrorEnvelope).ResponseMetadata
        throw new AssetUpstreamError(
          res.status,
          meta?.Error?.Code,
          meta?.Error?.Message ?? `HTTP ${res.status}`,
          meta?.RequestId,
        )
      }
      const result = (parsed as ArkResultEnvelope).Result
      return result ?? parsed
    },
  }
}
