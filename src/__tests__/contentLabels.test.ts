/**
 * contentLabels 纯函数测试
 *
 * 涵盖需求：
 * - 纯 reference 媒体（无 asset）→ image/video/audio 各自从 1 起算
 * - 含 image-type asset → 接续在 referenceImages 后计数
 * - asset 顺序混合（video → image → image）→ 各自独立计数
 * - 全空 → 全空阵列
 * - formatLabel 输出 `[Image 1]`（有空格）形式
 */
import { describe, it, expect } from 'vitest'
import { computeContentLabels, formatLabel } from '../utils/contentLabels'

describe('formatLabel', () => {
  it('returns the spaced format from official docs', () => {
    expect(formatLabel('image', 1)).toBe('[Image 1]')
    expect(formatLabel('video', 2)).toBe('[Video 2]')
    expect(formatLabel('audio', 3)).toBe('[Audio 3]')
  })
})

describe('computeContentLabels', () => {
  it('numbers pure reference media per-type from 1', () => {
    const out = computeContentLabels({
      imageCount: 2,
      videoCount: 1,
      audioCount: 0,
      assets: [],
    })
    expect(out.imageLabels).toEqual(['[Image 1]', '[Image 2]'])
    expect(out.videoLabels).toEqual(['[Video 1]'])
    expect(out.audioLabels).toEqual([])
    expect(out.assetLabels).toEqual([])
  })

  it('continues the counter into assets of the same type', () => {
    const out = computeContentLabels({
      imageCount: 2,
      videoCount: 0,
      audioCount: 0,
      assets: [{ type: 'image' }, { type: 'image' }, { type: 'video' }],
    })
    expect(out.imageLabels).toEqual(['[Image 1]', '[Image 2]'])
    expect(out.assetLabels).toEqual(['[Image 3]', '[Image 4]', '[Video 1]'])
  })

  it('handles mixed asset ordering with non-zero base counts', () => {
    const out = computeContentLabels({
      imageCount: 1,
      videoCount: 1,
      audioCount: 0,
      assets: [{ type: 'video' }, { type: 'image' }, { type: 'image' }],
    })
    expect(out.imageLabels).toEqual(['[Image 1]'])
    expect(out.videoLabels).toEqual(['[Video 1]'])
    // assets[0] is video → [Video 2]; assets[1..2] are images → [Image 2], [Image 3]
    expect(out.assetLabels).toEqual(['[Video 2]', '[Image 2]', '[Image 3]'])
  })

  it('returns all empty when nothing is provided', () => {
    const out = computeContentLabels({
      imageCount: 0,
      videoCount: 0,
      audioCount: 0,
      assets: [],
    })
    expect(out.imageLabels).toEqual([])
    expect(out.videoLabels).toEqual([])
    expect(out.audioLabels).toEqual([])
    expect(out.assetLabels).toEqual([])
  })

  it('audio numbering follows the same convention', () => {
    const out = computeContentLabels({
      imageCount: 0,
      videoCount: 0,
      audioCount: 1,
      assets: [{ type: 'audio' }, { type: 'audio' }],
    })
    expect(out.audioLabels).toEqual(['[Audio 1]'])
    expect(out.assetLabels).toEqual(['[Audio 2]', '[Audio 3]'])
  })
})
