/**
 * BytePlus ARK Asset single-file validation rules.
 *
 *  Image: jpeg/png/webp/bmp/tiff/gif/heic/heif, 0.4–2.5 aspect, 300–6000 px,
 *         ≤30 MB.
 *  Video: mp4/mov, 480p|720p, 2–15s, 0.4–2.5 aspect, 300–6000 px, total px
 *         [409600, 927408], ≤50 MB, FPS 24–60.
 *  Audio: wav/mp3, 2–15s, ≤15 MB.
 *
 * Synchronous *Basic validators check format + size only. Asynchronous
 * *Full validators additionally probe dimensions / duration via DOM
 * elements, with a 10s timeout to keep the upload dialog responsive.
 *
 * FPS is best-effort: standard browser APIs do not expose frame rate, so
 * we skip FPS in *Full and let ARK reject if needed (surfaced via
 * GetAsset.Error).
 *
 * Used by both AssetUploadDialog (T13) and the Seedance MediaUploader
 * pre-flight (T17).
 */

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

export const IMAGE_LIMITS = {
  exts: [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'bmp',
    'tif',
    'tiff',
    'gif',
    'heic',
    'heif',
  ],
  mimes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/gif',
    'image/heic',
    'image/heif',
  ],
  maxBytes: 30 * 1024 * 1024,
  minPx: 300,
  maxPx: 6000,
  minAspect: 0.4,
  maxAspect: 2.5,
} as const

export const VIDEO_LIMITS = {
  exts: ['mp4', 'mov'],
  mimes: ['video/mp4', 'video/quicktime'],
  maxBytes: 50 * 1024 * 1024,
  minPx: 300,
  maxPx: 6000,
  minAspect: 0.4,
  maxAspect: 2.5,
  minTotalPx: 409_600,
  maxTotalPx: 927_408,
  minDurationSec: 2,
  maxDurationSec: 15,
} as const

export const AUDIO_LIMITS = {
  exts: ['wav', 'mp3'],
  mimes: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'],
  maxBytes: 15 * 1024 * 1024,
  minDurationSec: 2,
  maxDurationSec: 15,
} as const

/**
 * Seedream 参考图（输入图）限制。格式清单与 ARK Asset 共用
 * `IMAGE_LIMITS.exts/mimes`；maxBytes 目前恰好等于 IMAGE_LIMITS.maxBytes
 * （30 MB），但属巧合 — 两者规则来源不同（Seedream API vs ARK Asset），
 * 故维持独立常数。maxTotalPx（6000×6000 = 36,000,000）为 forward
 * declaration，供未来 async probe / API 端把关使用，sync basic 不检查。
 */
export const SEEDREAM_REF_LIMITS = {
  maxBytes: 30 * 1024 * 1024,
  maxTotalPx: 6000 * 6000, // 36,000,000
} as const

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

function checkFormat(
  file: File,
  exts: readonly string[],
  mimes: readonly string[],
): string[] {
  const errors: string[] = []
  const e = ext(file.name)
  const okExt = exts.includes(e)
  const okMime = !file.type || mimes.includes(file.type.toLowerCase())
  if (!okExt && !okMime) {
    errors.push(`不支持的文件格式（${file.name}）。允许：${exts.join(', ')}`)
  }
  return errors
}

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

// ── Sync Basic validators ───────────────────────────────────

export function validateImageBasic(file: File): ValidationResult {
  const errors = checkFormat(file, IMAGE_LIMITS.exts, IMAGE_LIMITS.mimes)
  if (file.size > IMAGE_LIMITS.maxBytes) {
    errors.push(`图片大小超过 30 MB（${fmtMB(file.size)} MB）`)
  }
  return { ok: errors.length === 0, errors }
}

export function validateVideoBasic(file: File): ValidationResult {
  const errors = checkFormat(file, VIDEO_LIMITS.exts, VIDEO_LIMITS.mimes)
  if (file.size > VIDEO_LIMITS.maxBytes) {
    errors.push(`视频大小超过 50 MB（${fmtMB(file.size)} MB）`)
  }
  return { ok: errors.length === 0, errors }
}

export function validateAudioBasic(file: File): ValidationResult {
  const errors = checkFormat(file, AUDIO_LIMITS.exts, AUDIO_LIMITS.mimes)
  if (file.size > AUDIO_LIMITS.maxBytes) {
    errors.push(`音频大小超过 15 MB（${fmtMB(file.size)} MB）`)
  }
  return { ok: errors.length === 0, errors }
}

/** Seedream 参考图同步 basic 验证：格式 + 大小。尺寸/比例由 async probe 或 API 端把关。 */
export function validateSeedreamRefBasic(file: File): ValidationResult {
  const errors = checkFormat(file, IMAGE_LIMITS.exts, IMAGE_LIMITS.mimes)
  if (file.size > SEEDREAM_REF_LIMITS.maxBytes) {
    errors.push(`图片大小超过 30 MB（${fmtMB(file.size)} MB）`)
  }
  return { ok: errors.length === 0, errors }
}

// ── Async Full validators (use DOM elements in browser) ─────

interface ImageProbeResult {
  width: number
  height: number
}
interface VideoProbeResult {
  width: number
  height: number
  durationSec: number
}
interface AudioProbeResult {
  durationSec: number
}

const PROBE_TIMEOUT_MS = 10_000

function probeImage(file: File): Promise<ImageProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const cleanup = () => URL.revokeObjectURL(url)
    const t = setTimeout(() => {
      cleanup()
      reject(new Error('image probe timeout'))
    }, PROBE_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(t)
      cleanup()
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      clearTimeout(t)
      cleanup()
      reject(new Error('image load error'))
    }
    img.src = url
  })
}

function probeVideo(file: File): Promise<VideoProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    const cleanup = () => URL.revokeObjectURL(url)
    const t = setTimeout(() => {
      cleanup()
      reject(new Error('video probe timeout'))
    }, PROBE_TIMEOUT_MS)
    v.onloadedmetadata = () => {
      clearTimeout(t)
      cleanup()
      resolve({
        width: v.videoWidth,
        height: v.videoHeight,
        durationSec: v.duration,
      })
    }
    v.onerror = () => {
      clearTimeout(t)
      cleanup()
      reject(new Error('video load error'))
    }
    v.src = url
  })
}

function probeAudio(file: File): Promise<AudioProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const a = document.createElement('audio')
    a.preload = 'metadata'
    const cleanup = () => URL.revokeObjectURL(url)
    const t = setTimeout(() => {
      cleanup()
      reject(new Error('audio probe timeout'))
    }, PROBE_TIMEOUT_MS)
    a.onloadedmetadata = () => {
      clearTimeout(t)
      cleanup()
      resolve({ durationSec: a.duration })
    }
    a.onerror = () => {
      clearTimeout(t)
      cleanup()
      reject(new Error('audio load error'))
    }
    a.src = url
  })
}

export async function validateImage(file: File): Promise<ValidationResult> {
  const basic = validateImageBasic(file)
  if (!basic.ok) return basic
  try {
    const { width, height } = await probeImage(file)
    const errors: string[] = []
    if (
      width < IMAGE_LIMITS.minPx ||
      width > IMAGE_LIMITS.maxPx ||
      height < IMAGE_LIMITS.minPx ||
      height > IMAGE_LIMITS.maxPx
    ) {
      errors.push(
        `尺寸需在 ${IMAGE_LIMITS.minPx}–${IMAGE_LIMITS.maxPx}px（实际 ${width}×${height}）`,
      )
    }
    const aspect = width / height
    if (aspect < IMAGE_LIMITS.minAspect || aspect > IMAGE_LIMITS.maxAspect) {
      errors.push(
        `宽高比需在 ${IMAGE_LIMITS.minAspect}–${IMAGE_LIMITS.maxAspect}（实际 ${aspect.toFixed(2)}）`,
      )
    }
    return { ok: errors.length === 0, errors }
  } catch {
    // Best-effort: ARK will reject if the file is structurally invalid.
    return { ok: true, errors: [] }
  }
}

export async function validateVideo(file: File): Promise<ValidationResult> {
  const basic = validateVideoBasic(file)
  if (!basic.ok) return basic
  try {
    const { width, height, durationSec } = await probeVideo(file)
    const errors: string[] = []
    const totalPx = width * height
    if (
      durationSec < VIDEO_LIMITS.minDurationSec ||
      durationSec > VIDEO_LIMITS.maxDurationSec
    ) {
      errors.push(
        `视频长度需 ${VIDEO_LIMITS.minDurationSec}–${VIDEO_LIMITS.maxDurationSec} 秒（实际 ${durationSec.toFixed(1)}s）`,
      )
    }
    if (width && height) {
      if (
        width < VIDEO_LIMITS.minPx ||
        width > VIDEO_LIMITS.maxPx ||
        height < VIDEO_LIMITS.minPx ||
        height > VIDEO_LIMITS.maxPx
      ) {
        errors.push(
          `尺寸需在 ${VIDEO_LIMITS.minPx}–${VIDEO_LIMITS.maxPx}px（实际 ${width}×${height}）`,
        )
      }
      const aspect = width / height
      if (aspect < VIDEO_LIMITS.minAspect || aspect > VIDEO_LIMITS.maxAspect) {
        errors.push(
          `宽高比需在 ${VIDEO_LIMITS.minAspect}–${VIDEO_LIMITS.maxAspect}（实际 ${aspect.toFixed(2)}）`,
        )
      }
      if (totalPx < VIDEO_LIMITS.minTotalPx || totalPx > VIDEO_LIMITS.maxTotalPx) {
        errors.push(
          `总像素需 ${VIDEO_LIMITS.minTotalPx}–${VIDEO_LIMITS.maxTotalPx}（实际 ${totalPx}）`,
        )
      }
    }
    return { ok: errors.length === 0, errors }
  } catch {
    return { ok: true, errors: [] }
  }
}

export async function validateAudio(file: File): Promise<ValidationResult> {
  const basic = validateAudioBasic(file)
  if (!basic.ok) return basic
  try {
    const { durationSec } = await probeAudio(file)
    const errors: string[] = []
    if (
      durationSec < AUDIO_LIMITS.minDurationSec ||
      durationSec > AUDIO_LIMITS.maxDurationSec
    ) {
      errors.push(
        `音频长度需 ${AUDIO_LIMITS.minDurationSec}–${AUDIO_LIMITS.maxDurationSec} 秒（实际 ${durationSec.toFixed(1)}s）`,
      )
    }
    return { ok: errors.length === 0, errors }
  } catch {
    return { ok: true, errors: [] }
  }
}

/** Pick the right async validator for a given UI type. */
export async function validateByType(
  type: 'image' | 'video' | 'audio',
  file: File,
): Promise<ValidationResult> {
  if (type === 'image') return validateImage(file)
  if (type === 'video') return validateVideo(file)
  return validateAudio(file)
}
