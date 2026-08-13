import { describe, it, expect } from 'vitest'
import {
  defaultRoleForMode,
  computeCompatibility,
  type ImageRole,
} from '../utils/videoMode'
import type { LocalMedia, AssetRef } from '../types'

const img = (role: ImageRole): LocalMedia => ({
  preview: 'blob:x',
  uploading: false,
  role,
})
const vid = (): LocalMedia => ({ preview: 'blob:v', uploading: false })
const aud = (): LocalMedia => ({ preview: 'blob:a', uploading: false })
const assetImg = (role?: ImageRole): AssetRef => ({ id: 'asset-x', type: 'image', role })
const assetVid = (): AssetRef => ({ id: 'asset-v', type: 'video' })

describe('defaultRoleForMode', () => {
  it('returns first_frame for first_frame mode at index 0', () => {
    expect(defaultRoleForMode('first_frame', 0)).toBe('first_frame')
  })
  it('returns first_frame at index 0, last_frame at index 1 for first_last_frame', () => {
    expect(defaultRoleForMode('first_last_frame', 0)).toBe('first_frame')
    expect(defaultRoleForMode('first_last_frame', 1)).toBe('last_frame')
    expect(defaultRoleForMode('first_last_frame', 2)).toBe('first_frame')
  })
  it('returns reference_image for multimodal at any index', () => {
    expect(defaultRoleForMode('multimodal', 0)).toBe('reference_image')
    expect(defaultRoleForMode('multimodal', 5)).toBe('reference_image')
  })
})

describe('computeCompatibility — multimodal', () => {
  it('marks everything compatible when within limits', () => {
    const r = computeCompatibility('multimodal',
      [img('reference_image'), img('reference_image')], [vid()], [aud()], [assetImg('reference_image')])
    expect(r.canGenerate).toBe(true)
    expect(r.incompatibleImageIndexes).toEqual([])
    expect(r.incompatibleVideosFlag).toBe(false)
    expect(r.incompatibleAudiosFlag).toBe(false)
    expect(r.incompatibleAssetRefIndexes).toEqual([])
  })
  it('marks images with non-reference_image role as incompatible', () => {
    const r = computeCompatibility('multimodal',
      [img('first_frame'), img('reference_image')], [], [], [])
    expect(r.incompatibleImageIndexes).toEqual([0])
    expect(r.canGenerate).toBe(false)
  })
  it('fails imageCountOK when more than 9 images total', () => {
    const ten = Array.from({ length: 10 }, () => img('reference_image'))
    const r = computeCompatibility('multimodal', ten, [], [], [])
    expect(r.imageCountOK).toBe(false)
    expect(r.canGenerate).toBe(false)
  })
})

describe('computeCompatibility — first_frame', () => {
  it('passes with exactly 1 image role=first_frame', () => {
    const r = computeCompatibility('first_frame', [img('first_frame')], [], [], [])
    expect(r.canGenerate).toBe(true)
    expect(r.imageCountOK).toBe(true)
  })
  it('flags videos and audios as incompatible', () => {
    const r = computeCompatibility('first_frame', [img('first_frame')], [vid()], [aud()], [])
    expect(r.incompatibleVideosFlag).toBe(true)
    expect(r.incompatibleAudiosFlag).toBe(true)
    expect(r.canGenerate).toBe(false)
  })
  it('flags an image with role=reference_image as incompatible', () => {
    const r = computeCompatibility('first_frame', [img('reference_image')], [], [], [])
    expect(r.incompatibleImageIndexes).toEqual([0])
  })
  it('fails imageCountOK with 2 images', () => {
    const r = computeCompatibility('first_frame',
      [img('first_frame'), img('first_frame')], [], [], [])
    expect(r.imageCountOK).toBe(false)
  })
  it('counts asset image refs toward the total', () => {
    const r = computeCompatibility('first_frame', [], [], [],
      [assetImg('first_frame'), assetImg('first_frame')])
    expect(r.imageCountOK).toBe(false)
  })
  it('flags asset video refs as incompatible', () => {
    const r = computeCompatibility('first_frame',
      [img('first_frame')], [], [], [assetVid()])
    expect(r.incompatibleAssetRefIndexes).toEqual([0])
  })
})

describe('computeCompatibility — first_last_frame', () => {
  it('passes with one first_frame + one last_frame', () => {
    const r = computeCompatibility('first_last_frame',
      [img('first_frame'), img('last_frame')], [], [], [])
    expect(r.canGenerate).toBe(true)
    expect(r.roleSetOK).toBe(true)
  })
  it('fails roleSetOK when both are first_frame', () => {
    const r = computeCompatibility('first_last_frame',
      [img('first_frame'), img('first_frame')], [], [], [])
    expect(r.roleSetOK).toBe(false)
    expect(r.canGenerate).toBe(false)
  })
  it('passes roleSetOK when uploaded first + asset last together', () => {
    const r = computeCompatibility('first_last_frame',
      [img('first_frame')], [], [], [assetImg('last_frame')])
    expect(r.roleSetOK).toBe(true)
    expect(r.imageCountOK).toBe(true)
  })
  it('flags images with role=reference_image as incompatible', () => {
    const r = computeCompatibility('first_last_frame',
      [img('reference_image'), img('last_frame')], [], [], [])
    expect(r.incompatibleImageIndexes).toEqual([0])
  })
  it('fails imageCountOK with 3 images', () => {
    const r = computeCompatibility('first_last_frame',
      [img('first_frame'), img('last_frame'), img('first_frame')], [], [], [])
    expect(r.imageCountOK).toBe(false)
  })
})
