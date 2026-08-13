import { describe, it, expect } from 'vitest'
import { mergeCorsRules, OUR_RULE_TEMPLATE } from '../../server/signers/tosCors'
import type { CORSRule } from '@volcengine/tos-sdk/dist/methods/bucket/cors'

const ourOrigin = 'https://www.ianlin.com'

describe('mergeCorsRules', () => {
  it('returns input unchanged when our origin is already in some rule', () => {
    const existing = [
      {
        AllowedOrigins: ['https://www.ianlin.com', 'https://other.example'],
        AllowedMethods: ['GET', 'PUT'],
        AllowedHeaders: ['*'],
        ExposeHeaders: [],
        MaxAgeSeconds: 600,
      },
    ] as unknown as CORSRule[]
    const out = mergeCorsRules(existing, ourOrigin)
    expect(out.didChange).toBe(false)
    expect(out.rules).toEqual(existing)
  })

  it('appends a new rule preserving existing rules when our origin is missing', () => {
    const existing = [
      {
        AllowedOrigins: ['https://other.example'],
        AllowedMethods: ['GET'],
        AllowedHeaders: [],
        ExposeHeaders: [],
        MaxAgeSeconds: 0,
      },
    ] as unknown as CORSRule[]
    const out = mergeCorsRules(existing, ourOrigin)
    expect(out.didChange).toBe(true)
    expect(out.rules).toHaveLength(2)
    expect(out.rules[0]).toEqual(existing[0]) // untouched
    expect(out.rules[1].AllowedOrigins).toEqual([ourOrigin])
  })

  it('handles empty existing rules', () => {
    const out = mergeCorsRules([], ourOrigin)
    expect(out.didChange).toBe(true)
    expect(out.rules).toHaveLength(1)
    expect(out.rules[0].AllowedOrigins).toEqual([ourOrigin])
  })

  it('rejects non-https origin', () => {
    expect(() => mergeCorsRules([], 'http://insecure.example')).toThrow(/https/)
  })

  // Ensure OUR_RULE_TEMPLATE is exported and has the expected shape
  it('OUR_RULE_TEMPLATE has required fields', () => {
    expect(OUR_RULE_TEMPLATE.AllowedMethods).toEqual(
      expect.arrayContaining(['PUT', 'GET', 'HEAD']),
    )
    expect(OUR_RULE_TEMPLATE.AllowedHeaders).toEqual(['*'])
    expect(OUR_RULE_TEMPLATE.MaxAgeSeconds).toBe(3600)
  })
})
