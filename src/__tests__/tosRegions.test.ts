import { describe, it, expect } from 'vitest'
import {
  TOS_REGIONS,
  DEFAULT_REGION,
  regionToEndpoint,
} from '../utils/tosRegions'

describe('tosRegions', () => {
  it('TOS_REGIONS contains ap-southeast-1 as the default', () => {
    expect(TOS_REGIONS).toContain('ap-southeast-1')
    expect(DEFAULT_REGION).toBe('ap-southeast-1')
  })

  it('TOS_REGIONS includes ap-southeast-3', () => {
    expect(TOS_REGIONS).toContain('ap-southeast-3')
  })

  it('regionToEndpoint composes the canonical bytepluses host', () => {
    expect(regionToEndpoint('ap-southeast-1')).toBe('tos-ap-southeast-1.bytepluses.com')
    expect(regionToEndpoint('cn-beijing')).toBe('tos-cn-beijing.bytepluses.com')
  })

  it('regionToEndpoint trims whitespace and lowercases input', () => {
    expect(regionToEndpoint('  AP-SOUTHEAST-1  ')).toBe('tos-ap-southeast-1.bytepluses.com')
  })

  it('regionToEndpoint returns empty string for empty input', () => {
    expect(regionToEndpoint('')).toBe('')
    expect(regionToEndpoint('   ')).toBe('')
  })
})
