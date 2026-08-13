import { describe, it, expect } from 'vitest'
import {
  validateImageBasic,
  validateAudioBasic,
  validateVideoBasic,
  validateSeedreamRefBasic,
  IMAGE_LIMITS,
  VIDEO_LIMITS,
  AUDIO_LIMITS,
  SEEDREAM_REF_LIMITS,
} from '../utils/mediaValidation'

function fakeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('validateImageBasic', () => {
  it('accepts a 5MB JPEG', () => {
    const r = validateImageBasic(fakeFile('cat.jpg', 'image/jpeg', 5_000_000))
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('accepts png / webp / heic by extension even when MIME is empty', () => {
    expect(validateImageBasic(fakeFile('a.png', '', 100)).ok).toBe(true)
    expect(validateImageBasic(fakeFile('a.webp', '', 100)).ok).toBe(true)
    expect(validateImageBasic(fakeFile('a.heic', '', 100)).ok).toBe(true)
  })

  it('rejects unsupported MIME + extension', () => {
    const r = validateImageBasic(
      fakeFile('cat.zip', 'application/zip', 100),
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/格式|format/i)
  })

  it('rejects > 30 MB', () => {
    const r = validateImageBasic(
      fakeFile('big.jpg', 'image/jpeg', IMAGE_LIMITS.maxBytes + 1),
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/30 MB/)
  })
})

describe('validateVideoBasic', () => {
  it('accepts mp4', () => {
    const r = validateVideoBasic(fakeFile('a.mp4', 'video/mp4', 10_000_000))
    expect(r.ok).toBe(true)
  })

  it('accepts mov', () => {
    expect(
      validateVideoBasic(fakeFile('a.mov', 'video/quicktime', 1_000_000)).ok,
    ).toBe(true)
  })

  it('rejects > 50 MB', () => {
    const r = validateVideoBasic(
      fakeFile('big.mp4', 'video/mp4', VIDEO_LIMITS.maxBytes + 1),
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/50 MB/)
  })

  it('rejects webm', () => {
    expect(
      validateVideoBasic(fakeFile('a.webm', 'video/webm', 10_000_000)).ok,
    ).toBe(false)
  })
})

describe('validateAudioBasic', () => {
  it('accepts wav and mp3', () => {
    expect(validateAudioBasic(fakeFile('a.wav', 'audio/wav', 1_000)).ok).toBe(
      true,
    )
    expect(validateAudioBasic(fakeFile('a.mp3', 'audio/mpeg', 1_000)).ok).toBe(
      true,
    )
  })

  it('rejects > 15 MB', () => {
    const r = validateAudioBasic(
      fakeFile('a.mp3', 'audio/mpeg', AUDIO_LIMITS.maxBytes + 1),
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/15 MB/)
  })

  it('rejects m4a (not supported by ARK)', () => {
    expect(
      validateAudioBasic(fakeFile('a.m4a', 'audio/mp4', 1_000)).ok,
    ).toBe(false)
  })

  it('rejects aac (not supported by ARK)', () => {
    expect(
      validateAudioBasic(fakeFile('a.aac', 'audio/aac', 1_000)).ok,
    ).toBe(false)
  })
})

describe('validateSeedreamRefBasic', () => {
  it('accepts a small png', () => {
    const r = validateSeedreamRefBasic(fakeFile('a.png', 'image/png', 100))
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('rejects > 30 MB', () => {
    const r = validateSeedreamRefBasic(
      fakeFile('big.png', 'image/png', SEEDREAM_REF_LIMITS.maxBytes + 1),
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('30 MB')
  })

  it('rejects unsupported formats', () => {
    expect(
      validateSeedreamRefBasic(fakeFile('a.svg', 'image/svg+xml', 100)).ok,
    ).toBe(false)
  })

  it('accepts valid extension with empty or junk MIME', () => {
    expect(validateSeedreamRefBasic(fakeFile('a.png', '', 100)).ok).toBe(true)
    expect(
      validateSeedreamRefBasic(
        fakeFile('a.png', 'application/octet-stream', 100),
      ).ok,
    ).toBe(true)
  })

  it('accepts junk extension with valid MIME', () => {
    expect(
      validateSeedreamRefBasic(fakeFile('a.dat', 'image/png', 100)).ok,
    ).toBe(true)
  })

  it('accumulates both errors for oversized + wrong format', () => {
    const r = validateSeedreamRefBasic(
      fakeFile('big.zip', 'application/zip', SEEDREAM_REF_LIMITS.maxBytes + 1),
    )
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toMatch(/格式/)
    expect(r.errors[1]).toContain('30 MB')
  })
})
