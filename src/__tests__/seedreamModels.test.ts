import { describe, it, expect } from 'vitest'
import {
  SEEDREAM_MODELS,
  SEEDREAM_MODEL_OPTIONS,
  DEFAULT_SEEDREAM_MODEL,
  ASPECT_RATIO_OPTIONS,
  SEQUENTIAL_TOTAL_CAP,
  validateCustomSize,
  clampMaxImages,
  buildPromptWithRatio,
} from '../utils/seedreamModels'

describe('SEEDREAM_MODELS capability table', () => {
  it('has exactly the four supported models', () => {
    expect(Object.keys(SEEDREAM_MODELS).sort()).toEqual([
      'seedream-4-0',
      'seedream-4-5',
      'seedream-5-0-lite',
      'seedream-5-0-pro',
    ])
  })

  it('default model is the newest (5.0 Pro)', () => {
    expect(DEFAULT_SEEDREAM_MODEL).toBe('seedream-5-0-pro')
  })

  it('size levels follow the official table', () => {
    expect(SEEDREAM_MODELS['seedream-5-0-pro'].sizeLevels).toEqual(['1K', '2K'])
    expect(SEEDREAM_MODELS['seedream-5-0-lite'].sizeLevels).toEqual(['2K', '3K', '4K'])
    expect(SEEDREAM_MODELS['seedream-4-5'].sizeLevels).toEqual(['2K', '4K'])
    expect(SEEDREAM_MODELS['seedream-4-0'].sizeLevels).toEqual(['1K', '2K', '4K'])
  })

  it('5.0 Pro does NOT support sequential output; the rest do', () => {
    expect(SEEDREAM_MODELS['seedream-5-0-pro'].supportsSequential).toBe(false)
    expect(SEEDREAM_MODELS['seedream-5-0-lite'].supportsSequential).toBe(true)
    expect(SEEDREAM_MODELS['seedream-4-5'].supportsSequential).toBe(true)
    expect(SEEDREAM_MODELS['seedream-4-0'].supportsSequential).toBe(true)
  })

  it('4.5 / 4.0 lock output format to jpeg', () => {
    expect(SEEDREAM_MODELS['seedream-4-5'].formatLocked).toBe(true)
    expect(SEEDREAM_MODELS['seedream-4-5'].outputFormats).toEqual(['jpeg'])
    expect(SEEDREAM_MODELS['seedream-4-0'].formatLocked).toBe(true)
    expect(SEEDREAM_MODELS['seedream-5-0-pro'].formatLocked).toBe(false)
    expect(SEEDREAM_MODELS['seedream-5-0-pro'].outputFormats).toEqual(['png', 'jpeg'])
  })

  it('reference image caps: 10 for 5.0 Pro, 14 for others', () => {
    expect(SEEDREAM_MODELS['seedream-5-0-pro'].maxRefImages).toBe(10)
    expect(SEEDREAM_MODELS['seedream-5-0-lite'].maxRefImages).toBe(14)
    expect(SEEDREAM_MODELS['seedream-4-5'].maxRefImages).toBe(14)
    expect(SEEDREAM_MODELS['seedream-4-0'].maxRefImages).toBe(14)
  })

  it('options list covers all models with Chinese-friendly labels', () => {
    expect(SEEDREAM_MODEL_OPTIONS).toHaveLength(4)
    expect(SEEDREAM_MODEL_OPTIONS[0]).toEqual({
      value: 'seedream-5-0-pro',
      label: 'Seedream 5.0 Pro',
    })
  })

  it('aspect ratio options start with auto', () => {
    expect(ASPECT_RATIO_OPTIONS[0].value).toBe('auto')
    expect(ASPECT_RATIO_OPTIONS.map((o) => o.value)).toContain('16:9')
  })
})

describe('validateCustomSize', () => {
  it('accepts sizes within the per-model total-pixel range', () => {
    expect(validateCustomSize('seedream-5-0-pro', 1280, 720).ok).toBe(true)   // exactly min
    expect(validateCustomSize('seedream-5-0-pro', 2048, 2048).ok).toBe(true)  // exactly max
    expect(validateCustomSize('seedream-4-0', 4096, 4096).ok).toBe(true)
  })

  it('rejects totals below min / above max with a reason', () => {
    const low = validateCustomSize('seedream-5-0-pro', 100, 100)
    expect(low.ok).toBe(false)
    expect(low.error).toContain('总像素')

    const high = validateCustomSize('seedream-5-0-pro', 4096, 4096) // > 2048*2048
    expect(high.ok).toBe(false)

    // 5-0-lite min is 2560x1440 — 1280x720 is valid for pro but not lite
    expect(validateCustomSize('seedream-5-0-lite', 1280, 720).ok).toBe(false)
  })

  it('rejects aspect ratios outside [1/16, 16]', () => {
    // 每边合法、总像素落在 4-0 范围内，但比例 17:1 超标
    const wide = validateCustomSize('seedream-4-0', 5100, 300)
    expect(wide.ok).toBe(false)
    expect(wide.error).toContain('比例')
  })

  it('rejects non-positive or tiny (≤14px) edges', () => {
    expect(validateCustomSize('seedream-4-0', 0, 1000).ok).toBe(false)
    expect(validateCustomSize('seedream-4-0', 14, 65536).ok).toBe(false)
  })

  it('accepts an exactly-16 aspect ratio at the boundary', () => {
    // 4096/256 = 16 (== RATIO_MAX, inclusive); total 1,048,576 within 4-0 range
    expect(validateCustomSize('seedream-4-0', 4096, 256).ok).toBe(true)
  })

  it('rejects a portrait ratio just past the 1/16 bound with a reason', () => {
    // 300/5100 ≈ 0.0588 < 1/16 (0.0625) → ratio failure
    const tall = validateCustomSize('seedream-4-0', 300, 5100)
    expect(tall.ok).toBe(false)
    expect(tall.error).toContain('比例')
  })

  it('rejects min−1 and max+1 total pixels for 5.0 Pro', () => {
    // min 921,600 (1280×720). 1280×719 = 920,320 (< min) → reject
    expect(validateCustomSize('seedream-5-0-pro', 1280, 719).ok).toBe(false)
    // max 4,194,304 (2048×2048). 2049×2048 = 4,196,352 (> max) → reject
    expect(validateCustomSize('seedream-5-0-pro', 2049, 2048).ok).toBe(false)
  })
})

describe('clampMaxImages', () => {
  it('caps desired at 15 minus reference count', () => {
    expect(clampMaxImages(0, 4)).toBe(4)
    expect(clampMaxImages(12, 10)).toBe(3)   // 15 - 12 = 3
    expect(clampMaxImages(14, 10)).toBe(1)
    expect(clampMaxImages(15, 10)).toBe(1)   // floor at 1
  })
  it('floors degenerate desired/ref inputs at 1', () => {
    expect(clampMaxImages(0, 0)).toBe(1)
    expect(clampMaxImages(0, -5)).toBe(1)
  })
  it('exposes the cap constant', () => {
    expect(SEQUENTIAL_TOTAL_CAP).toBe(15)
  })
})

describe('buildPromptWithRatio', () => {
  it('appends an aspect-ratio sentence for concrete ratios', () => {
    expect(buildPromptWithRatio('a cat', '16:9')).toBe('a cat\n\nAspect ratio: 16:9.')
  })
  it('returns prompt unchanged for auto', () => {
    expect(buildPromptWithRatio('a cat', 'auto')).toBe('a cat')
  })
})
