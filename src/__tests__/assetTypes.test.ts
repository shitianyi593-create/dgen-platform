import { describe, it, expect } from 'vitest'
import {
  toApiAssetType,
  toUiAssetType,
  parseAssetUri,
  formatAssetUri,
} from '../types/asset'

describe('asset type mappers', () => {
  it('toApiAssetType maps lowercase to capitalised', () => {
    expect(toApiAssetType('image')).toBe('Image')
    expect(toApiAssetType('video')).toBe('Video')
    expect(toApiAssetType('audio')).toBe('Audio')
  })

  it('toUiAssetType maps capitalised to lowercase', () => {
    expect(toUiAssetType('Image')).toBe('image')
    expect(toUiAssetType('Video')).toBe('video')
    expect(toUiAssetType('Audio')).toBe('audio')
  })
})

describe('asset URI helpers', () => {
  it('parseAssetUri extracts the asset id from valid asset:// URIs', () => {
    expect(parseAssetUri('asset://asset-20260224213258-pnqkh')).toBe(
      'asset-20260224213258-pnqkh',
    )
  })

  it('parseAssetUri trims whitespace before matching', () => {
    expect(parseAssetUri('  asset://asset-20260224213258-pnqkh  ')).toBe(
      'asset-20260224213258-pnqkh',
    )
  })

  it('parseAssetUri returns null for non-asset URIs', () => {
    expect(parseAssetUri('https://example.com/x.jpg')).toBeNull()
    expect(parseAssetUri('asset-20260224213258-pnqkh')).toBeNull()
    expect(parseAssetUri('asset://')).toBeNull()
    expect(parseAssetUri('asset://garbage')).toBeNull()
  })

  it('formatAssetUri prepends asset://', () => {
    expect(formatAssetUri('asset-20260224213258-pnqkh')).toBe(
      'asset://asset-20260224213258-pnqkh',
    )
  })
})
