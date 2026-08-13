/**
 * One-shot script that uses the TOS AK/SK to set the bucket CORS rules
 * required for browser-based PUT/GET pre-signed URL uploads.
 *
 * Usage:
 *   npm run tos:bootstrap          # set CORS
 *   npm run tos:cors:show          # print current CORS only (no mutation)
 *
 * Reads configuration from environment variables (.env.local is loaded
 * automatically). See .env.example for the full list.
 */
import { fileURLToPath } from 'node:url'
import { TosClient } from '@volcengine/tos-sdk'
import type { CORSRule } from '@volcengine/tos-sdk/dist/methods/bucket/cors'
import { loadDotenv } from './loadDotenv'
import { mergeCorsRules } from '../server/signers/tosCors'

// Load .env then .env.local so .env.local overrides committed defaults.
loadDotenv()

export interface BootstrapEnv {
  TOS_ACCESS_KEY?: string
  TOS_SECRET_KEY?: string
  TOS_REGION?: string
  TOS_ENDPOINT?: string
  TOS_BUCKET?: string
  TOS_CORS_ORIGINS?: string
}

/** Minimal contract of the TOS SDK methods we touch — used for typing the
 *  injected client in tests. */
export interface BootstrapClient {
  putBucketCORS(input: { bucket: string; CORSRules: CORSRule[] }): Promise<unknown>
  getBucketCORS(input: { bucket: string }): Promise<{ data?: { CORSRules: CORSRule[] } }>
}

type ClientCtor = new (config: {
  accessKeyId: string
  accessKeySecret: string
  region: string
  endpoint: string
}) => BootstrapClient

const REQUIRED_KEYS = ['TOS_ACCESS_KEY', 'TOS_SECRET_KEY', 'TOS_BUCKET'] as const

export interface BootstrapOptions {
  /** Inject a fake TosClient constructor for testing. */
  ClientCtor?: ClientCtor
  /** When true, only read & return the current CORS rules without mutating them. */
  showOnly?: boolean
}

export interface BootstrapResult {
  bucket: string
  appliedRule?: CORSRule
  currentCORS: CORSRule[]
}

/** Pure function — testable with a mocked client. */
export async function runBootstrap(
  env: BootstrapEnv = process.env as BootstrapEnv,
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) throw new Error(`Missing required env: ${key}`)
  }

  const region = env.TOS_REGION ?? 'ap-southeast-1'
  const endpoint = env.TOS_ENDPOINT ?? `tos-${region}.bytepluses.com`
  const bucket = env.TOS_BUCKET!
  const origins = (env.TOS_CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const Ctor: ClientCtor = (opts.ClientCtor ?? (TosClient as unknown as ClientCtor))
  const client = new Ctor({
    accessKeyId: env.TOS_ACCESS_KEY!,
    accessKeySecret: env.TOS_SECRET_KEY!,
    region,
    endpoint,
  })

  // Multi-origin support dropped at B1; only the first origin is merged.
  // For multiple origins, run the script multiple times or extend the merge
  // helper later.
  //
  // Fresh bucket: getBucketCORS throws 'The CORS configuration does not exist'.
  // Treat that as "no rules yet" so a brand-new bucket boots with our rule
  // instead of aborting the script.
  let existing: CORSRule[] = []
  try {
    existing = (await client.getBucketCORS({ bucket })).data?.CORSRules ?? []
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (!/cors configuration does not exist|nosuchcors/i.test(msg)) throw e
  }
  const merge = mergeCorsRules(existing, origins[0])

  if (!opts.showOnly && merge.didChange) {
    await client.putBucketCORS({ bucket, CORSRules: merge.rules })
  }

  return {
    bucket,
    appliedRule: opts.showOnly ? undefined : merge.didChange ? merge.rules[merge.rules.length - 1] : undefined,
    // We trust merge.rules rather than re-fetching post-PUT: for an admin
    // script run interactively by a human, "what we wrote" is the relevant
    // view, and we save one SDK round-trip.
    currentCORS: merge.rules,
  }
}

// ── CLI entry ────────────────────────────────────────────────
const isCli = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
})()

if (isCli) {
  const showOnly = process.argv.includes('--show-cors')
  runBootstrap(process.env as BootstrapEnv, { showOnly })
    .then((result) => {
      const action = showOnly ? 'Current CORS' : 'TOS CORS bootstrap done'
      console.log(`[tos-bootstrap] ${action} for bucket: ${result.bucket}`)
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[tos-bootstrap] failed:', msg)
      process.exit(1)
    })
}
