import { describe, it, expect } from 'vitest'
import { parseBucketAndPrefix, DEFAULT_KEY_PREFIX } from '../utils/tosBucket'

describe('parseBucketAndPrefix', () => {
  it('exports the canonical default prefix', () => {
    expect(DEFAULT_KEY_PREFIX).toBe('seedance-2-0/')
  })

  it('plain bucket name → default prefix', () => {
    expect(parseBucketAndPrefix('mybucket')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'seedance-2-0/',
    })
  })

  it('bucket with trailing slash but empty after → default prefix', () => {
    expect(parseBucketAndPrefix('mybucket/')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'seedance-2-0/',
    })
  })

  it('bucket/prefix → uses user prefix with auto-trailing slash', () => {
    expect(parseBucketAndPrefix('mybucket/foo')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'foo/',
    })
  })

  it('bucket/prefix/ → uses user prefix as-is', () => {
    expect(parseBucketAndPrefix('mybucket/foo/')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'foo/',
    })
  })

  it('multi-segment prefix (no trailing slash) → preserves segments + adds trailing slash', () => {
    expect(parseBucketAndPrefix('mybucket/a/b/c')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'a/b/c/',
    })
  })

  it('multi-segment prefix (with trailing slash) → preserved as-is', () => {
    expect(parseBucketAndPrefix('mybucket/a/b/c/')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'a/b/c/',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseBucketAndPrefix('  mybucket  ')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'seedance-2-0/',
    })
    expect(parseBucketAndPrefix('  mybucket/foo  ')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'foo/',
    })
  })

  it('empty input → empty bucket + default prefix', () => {
    expect(parseBucketAndPrefix('')).toEqual({
      bucket: '',
      keyPrefix: 'seedance-2-0/',
    })
    expect(parseBucketAndPrefix('   ')).toEqual({
      bucket: '',
      keyPrefix: 'seedance-2-0/',
    })
  })

  it('bucket name preserved with original case (no lowercase)', () => {
    // Bucket names on TOS are typically lowercase, but the parser does NOT
    // enforce that — it preserves whatever the user typed. Validation
    // happens server-side via HeadBucket.
    expect(parseBucketAndPrefix('MyBucket')).toEqual({
      bucket: 'MyBucket',
      keyPrefix: 'seedance-2-0/',
    })
  })

  it('prefix preserves case', () => {
    expect(parseBucketAndPrefix('mybucket/FooBar')).toEqual({
      bucket: 'mybucket',
      keyPrefix: 'FooBar/',
    })
  })
})
