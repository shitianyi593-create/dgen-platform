import type { CredKey } from './schema'
import type { AssetCreds, TosCreds } from '../../stores/authStore'
import { DEFAULT_KEY_PREFIX } from '../../utils/tosBucket'

/**
 * Parse a .env file's text into a plain key→value record.
 *
 * Intentionally minimal: supports `KEY=value`, `export KEY=value`, single/double
 * quoted values, trailing ` # comment`, and trims unquoted values. Does NOT
 * support multi-line values or `${VAR}` expansion — those lines are silently
 * dropped (the importer is a convenience, not a dotenv replacement).
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*export\s+/, '').trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let rest = line.slice(eq + 1)
    let value: string
    const quoted = rest.match(/^\s*"((?:[^"\\]|\\.)*)"|^\s*'([^']*)'/)
    if (quoted) {
      value = quoted[1] ?? quoted[2] ?? ''
    } else {
      const hash = rest.indexOf(' #')
      if (hash !== -1) rest = rest.slice(0, hash)
      value = rest.trim()
    }
    out[key] = value
  }
  return out
}

export interface EnvCredsPartial {
  inference?: Partial<{ apiKey: string; endpoint: string; imageEndpoint: string; textEndpoint: string; videoEndpoint25: string }>
  asset?: Partial<AssetCreds>
  tos?: Partial<TosCreds>
}

interface AliasEntry {
  credKey: CredKey
  fieldKey: string
  /** Listed in priority order — the first non-empty hit wins. */
  names: readonly string[]
}

const ALIASES: readonly AliasEntry[] = [
  { credKey: 'inference', fieldKey: 'apiKey',          names: ['ARK_API_KEY', 'API_KEY', 'MODELARK_API_KEY'] },
  { credKey: 'inference', fieldKey: 'videoEndpoint25', names: ['SEEDANCE_2_5_ENDPOINT'] },
  { credKey: 'inference', fieldKey: 'endpoint',        names: ['ARK_ENDPOINT_ID', 'ARK_ENDPOINT', 'ENDPOINT_ID', 'SEEDANCE_2_0_ENDPOINT', 'SEEDANCE_ENDPOINT', 'ENDPOINT'] },
  { credKey: 'inference', fieldKey: 'imageEndpoint',   names: ['SEEDREAM_5_0_ENDPOINT', 'SEEDREAM_ENDPOINT', 'IMAGE_ENDPOINT'] },
  { credKey: 'inference', fieldKey: 'textEndpoint',    names: ['TEXT_LLM_SEED_ENDPOINT', 'SEED_2_0_PRO_ENDPOINT', 'SEED_ENDPOINT', 'TEXT_ENDPOINT', 'CHAT_ENDPOINT'] },
  { credKey: 'asset',     fieldKey: 'accessKeyId',     names: ['BYTEPLUS_AK', 'BYTEPLUS_ACCESS_KEY', 'BYTEPLUS_ACCESS_KEY_ID', 'ARK_AK', 'ARK_ACCESS_KEY_ID'] },
  { credKey: 'asset',     fieldKey: 'accessKeySecret', names: ['BYTEPLUS_SK', 'BYTEPLUS_SECRET_KEY', 'BYTEPLUS_SECRET_ACCESS_KEY', 'ARK_SK', 'ARK_SECRET_ACCESS_KEY'] },
  { credKey: 'asset',     fieldKey: 'projectName',     names: ['BYTEPLUS_PROJECT_NAME', 'BYTEPLUS_PROJECT', 'ARK_PROJECT_NAME', 'ARK_PROJECT'] },
  { credKey: 'tos',       fieldKey: 'accessKeyId',     names: ['TOS_ACCESS_KEY', 'TOS_AK', 'TOS_ACCESS_KEY_ID'] },
  { credKey: 'tos',       fieldKey: 'accessKeySecret', names: ['TOS_SECRET_KEY', 'TOS_SK', 'TOS_SECRET_ACCESS_KEY'] },
  { credKey: 'tos',       fieldKey: 'region',          names: ['TOS_REGION', 'REGION'] },
  { credKey: 'tos',       fieldKey: 'bucket',          names: ['TOS_BUCKET', 'BUCKET'] },
]

export function mapToCreds(kv: Record<string, string>): EnvCredsPartial {
  const norm: Record<string, string> = {}
  for (const [k, v] of Object.entries(kv)) {
    const nk = k.toUpperCase().replace(/^VITE_/, '')
    norm[nk] = v
  }
  const out: EnvCredsPartial = {}
  for (const { credKey, fieldKey, names } of ALIASES) {
    for (const name of names) {
      const v = norm[name]
      if (v !== undefined && v !== '') {
        const group = (out[credKey] ??= {}) as Record<string, string>
        group[fieldKey] = v
        break
      }
    }
  }
  // Fallback scan: endpoint vars named after a model family that the exact
  // alias list doesn't know (e.g. SEEDREAM_4_5_ENDPOINT). Sorted for
  // deterministic pick when multiple candidates exist.
  const inf = (out.inference ??= {}) as Record<string, string>
  const keys = Object.keys(norm).sort()
  if (!inf.imageEndpoint) {
    const k = keys.find((n) => n.includes('SEEDREAM') && n.includes('ENDPOINT') && norm[n])
    if (k) inf.imageEndpoint = norm[k]
  }
  if (!inf.endpoint) {
    const k = keys.find((n) => n.includes('SEEDANCE') && n.includes('ENDPOINT') && !n.includes('2_5') && norm[n])
    if (k) inf.endpoint = norm[k]
  }
  if (!inf.textEndpoint) {
    // 找 "SEED_"（SEED 後接底線）出現在名稱任一處，而非只看開頭 —— 實際使用的
    // TEXT_LLM_SEED_ENDPOINT 就把 SEED_ 夾在中間。底線本身即排除 SEEDANCE_* /
    // SEEDREAM_*（它們是 SEED 後接 A / R，不含 "SEED_"）。
    const k = keys.find((n) => n.includes('SEED_') && n.includes('ENDPOINT') && norm[n])
    if (k) inf.textEndpoint = norm[k]
  }
  if (Object.keys(inf).length === 0) delete out.inference

  const prefix = norm['TOS_KEY_PREFIX']
  if (out.tos?.bucket && prefix && prefix !== DEFAULT_KEY_PREFIX) {
    const trimmed = prefix.replace(/\/$/, '')
    if (trimmed) {
      out.tos = { ...out.tos, bucket: `${out.tos.bucket}/${trimmed}` }
    }
  }
  return out
}
