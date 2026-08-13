import { describe, it, expect } from 'vitest'
import { computeCompatibility } from '../utils/videoMode'
import type { LocalMedia } from '../types'

function fakeImages(n: number): LocalMedia[] {
  return Array.from({ length: n }, (_, i) => ({
    preview: `blob:${i}`,
    uploading: false,
    role: 'reference_image' as const,
  }))
}

describe('computeCompatibility limits (Seedance 2.5)', () => {
  it('default keeps the 2.0 cap: 10 images in multimodal is NOT ok', () => {
    const r = computeCompatibility('multimodal', fakeImages(10), [], [], [])
    expect(r.imageCountOK).toBe(false)
  })

  it('maxMultimodalImages=30 allows 30 images, rejects 31', () => {
    const ok = computeCompatibility('multimodal', fakeImages(30), [], [], [], {
      maxMultimodalImages: 30,
    })
    expect(ok.imageCountOK).toBe(true)
    expect(ok.canGenerate).toBe(true)

    const over = computeCompatibility('multimodal', fakeImages(31), [], [], [], {
      maxMultimodalImages: 30,
    })
    expect(over.imageCountOK).toBe(false)
  })

  it('limits does not affect first_frame / first_last_frame counts', () => {
    const r = computeCompatibility('first_frame', fakeImages(1).map((m) => ({ ...m, role: 'first_frame' as const })), [], [], [], {
      maxMultimodalImages: 30,
    })
    expect(r.imageCountOK).toBe(true)
  })
})
