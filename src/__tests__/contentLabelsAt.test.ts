import { describe, it, expect } from 'vitest'
import { formatLabel, computeContentLabels } from '../utils/contentLabels'

describe('contentLabels @ format (Seedance 2.5)', () => {
  it('formatLabel defaults to bracket form (2.0 behavior unchanged)', () => {
    expect(formatLabel('image', 1)).toBe('[Image 1]')
  })

  it('formatLabel produces @ form without space', () => {
    expect(formatLabel('image', 1, 'at')).toBe('@Image1')
    expect(formatLabel('video', 2, 'at')).toBe('@Video2')
    expect(formatLabel('audio', 3, 'at')).toBe('@Audio3')
  })

  it('computeContentLabels threads format through, asset counters continue per type', () => {
    const labels = computeContentLabels(
      {
        imageCount: 2,
        videoCount: 1,
        audioCount: 0,
        assets: [{ type: 'image' }, { type: 'audio' }],
      },
      'at',
    )
    expect(labels.imageLabels).toEqual(['@Image1', '@Image2'])
    expect(labels.videoLabels).toEqual(['@Video1'])
    expect(labels.assetLabels).toEqual(['@Image3', '@Audio1'])
  })

  it('computeContentLabels default stays bracket', () => {
    const labels = computeContentLabels({ imageCount: 1, videoCount: 0, audioCount: 0, assets: [] })
    expect(labels.imageLabels).toEqual(['[Image 1]'])
  })
})
