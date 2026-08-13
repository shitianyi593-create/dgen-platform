/**
 * Default object-key prefix used when the user does not specify one.
 * All app-generated keys land under this prefix so the bucket can be shared
 * with non-app data without collision.
 */
export const DEFAULT_KEY_PREFIX = 'seedance-2-0/'

export interface BucketAndPrefix {
  /** The TOS bucket name (no slashes). */
  bucket: string
  /** Object-key prefix, ALWAYS including a trailing '/' (or empty if intentional). */
  keyPrefix: string
}

/**
 * Parse a single user-typed string into separate bucket + keyPrefix values.
 *
 * Accepted forms:
 *   'mybucket'           → { bucket: 'mybucket', keyPrefix: 'seedance-2-0/' }
 *   'mybucket/'          → { bucket: 'mybucket', keyPrefix: 'seedance-2-0/' }
 *   'mybucket/foo'       → { bucket: 'mybucket', keyPrefix: 'foo/' }
 *   'mybucket/foo/bar/'  → { bucket: 'mybucket', keyPrefix: 'foo/bar/' }
 *
 * The bucket name is whatever appears before the first '/'. Anything after
 * the first '/' is treated as a custom prefix; if empty, falls back to
 * DEFAULT_KEY_PREFIX. The prefix always carries a trailing '/' so callers
 * can concatenate `${keyPrefix}${objectName}` safely.
 *
 * Whitespace is trimmed at both ends; case is preserved (no lowercasing).
 */
export function parseBucketAndPrefix(input: string): BucketAndPrefix {
  const trimmed = input.trim()
  if (!trimmed) return { bucket: '', keyPrefix: DEFAULT_KEY_PREFIX }

  const slashIdx = trimmed.indexOf('/')
  if (slashIdx === -1) {
    return { bucket: trimmed, keyPrefix: DEFAULT_KEY_PREFIX }
  }

  const bucket = trimmed.slice(0, slashIdx)
  const rawPrefix = trimmed.slice(slashIdx + 1)
  if (!rawPrefix) {
    return { bucket, keyPrefix: DEFAULT_KEY_PREFIX }
  }
  const keyPrefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`
  return { bucket, keyPrefix }
}
