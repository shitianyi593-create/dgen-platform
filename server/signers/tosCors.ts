import { HttpMethodType } from '@volcengine/tos-sdk'
import type { CORSRule } from '@volcengine/tos-sdk/dist/methods/bucket/cors'

export const OUR_RULE_TEMPLATE: Omit<CORSRule, 'AllowedOrigins'> = {
  AllowedMethods: [
    HttpMethodType.HttpMethodPut,
    HttpMethodType.HttpMethodGet,
    HttpMethodType.HttpMethodHead,
  ],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'x-tos-request-id'],
  MaxAgeSeconds: 3600,
}

export interface MergeResult {
  /** True iff a write to TOS is required to materialize the change. */
  didChange: boolean
  /** The full rule set that should now be on the bucket. */
  rules: CORSRule[]
}

/**
 * Idempotent merge: if any existing rule's AllowedOrigins already contains
 * `ourOrigin`, the input is returned unchanged. Otherwise a new rule with
 * just our origin (and our standard methods/headers) is appended. Existing
 * rules are NEVER modified or removed — this is critical because the user's
 * bucket may host CORS rules for unrelated apps.
 * Note: existing wildcards like AllowedOrigins: ['*'] are NOT treated as
 * covering ourOrigin — we always want our explicit rule with our standard
 * methods/headers.
 */
export function mergeCorsRules(
  existing: CORSRule[],
  ourOrigin: string,
): MergeResult {
  if (!ourOrigin.startsWith('https://') && !ourOrigin.startsWith('http://localhost')) {
    throw new Error(`Refusing to write non-https origin to CORS: ${ourOrigin}`)
  }
  const alreadyPresent = existing.some(
    (r) => r.AllowedOrigins?.includes(ourOrigin),
  )
  if (alreadyPresent) return { didChange: false, rules: existing }
  const newRule: CORSRule = { ...OUR_RULE_TEMPLATE, AllowedOrigins: [ourOrigin] }
  return { didChange: true, rules: [...existing, newRule] }
}
