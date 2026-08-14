import type { LocalMedia, AssetRef, ImageRole, VideoGenMode } from '../types'

export type { ImageRole, VideoGenMode }

/**
 * Default role for a newly-added image based on current mode and the image's
 * position in the existing array.
 *
 *   first_frame       → always 'first_frame'
 *   first_last_frame  → idx 0 = first_frame, idx 1 = last_frame, idx 2+ = first_frame
 *   multimodal        → 'reference_image'
 */
export function defaultRoleForMode(mode: VideoGenMode, idx: number): ImageRole {
  if (mode === 'first_frame') return 'first_frame'
  if (mode === 'multimodal') return 'reference_image'
  // first_last_frame
  return idx === 1 ? 'last_frame' : 'first_frame'
}

export interface CompatibilityResult {
  incompatibleImageIndexes: number[]
  incompatibleVideosFlag: boolean
  incompatibleAudiosFlag: boolean
  incompatibleAssetRefIndexes: number[]
  imageCountOK: boolean
  roleSetOK: boolean
  canGenerate: boolean
}

/** 各模式素材上限。默认值 = Seedance 2.0 规格；2.5 呼叫端传入自己的上限。
 *  // TODO(tech-debt): seedanceModels 能力表合并 */
export interface CompatibilityLimits {
  maxMultimodalImages?: number
}

export function computeCompatibility(
  mode: VideoGenMode,
  images: LocalMedia[],
  videos: LocalMedia[],
  audios: LocalMedia[],
  assetRefs: AssetRef[],
  limits: CompatibilityLimits = {},
): CompatibilityResult {
  const maxMultimodalImages = limits.maxMultimodalImages ?? 9
  const incompatibleImageIndexes: number[] = []
  const incompatibleAssetRefIndexes: number[] = []
  let incompatibleVideosFlag = false
  let incompatibleAudiosFlag = false

  const isImageRoleOK = (role: ImageRole | undefined): boolean => {
    if (mode === 'first_frame') return role === 'first_frame'
    if (mode === 'first_last_frame') return role === 'first_frame' || role === 'last_frame'
    return role === 'reference_image' || role === undefined
  }

  images.forEach((m, i) => {
    if (!isImageRoleOK(m.role)) incompatibleImageIndexes.push(i)
  })

  assetRefs.forEach((r, i) => {
    if (r.type === 'image') {
      if (!isImageRoleOK(r.role)) incompatibleAssetRefIndexes.push(i)
    } else if (mode !== 'multimodal') {
      // video/audio asset refs only allowed in multimodal mode
      incompatibleAssetRefIndexes.push(i)
    }
  })

  if (mode !== 'multimodal') {
    if (videos.length > 0) incompatibleVideosFlag = true
    if (audios.length > 0) incompatibleAudiosFlag = true
  }

  // Image count (uploaded + asset image refs)
  const imageCount = images.length + assetRefs.filter((r) => r.type === 'image').length
  let imageCountOK = true
  if (mode === 'first_frame') imageCountOK = imageCount === 1
  else if (mode === 'first_last_frame') imageCountOK = imageCount === 2
  else imageCountOK = imageCount <= maxMultimodalImages

  // Role-set check for first_last_frame: need exactly one first + one last across images + asset image refs
  let roleSetOK = true
  if (mode === 'first_last_frame') {
    const allImageRoles = [
      ...images.map((m) => m.role),
      ...assetRefs.filter((r) => r.type === 'image').map((r) => r.role),
    ]
    const firsts = allImageRoles.filter((r) => r === 'first_frame').length
    const lasts = allImageRoles.filter((r) => r === 'last_frame').length
    roleSetOK = firsts === 1 && lasts === 1
  }

  const canGenerate =
    incompatibleImageIndexes.length === 0 &&
    incompatibleAssetRefIndexes.length === 0 &&
    !incompatibleVideosFlag &&
    !incompatibleAudiosFlag &&
    imageCountOK &&
    roleSetOK

  return {
    incompatibleImageIndexes,
    incompatibleVideosFlag,
    incompatibleAudiosFlag,
    incompatibleAssetRefIndexes,
    imageCountOK,
    roleSetOK,
    canGenerate,
  }
}
