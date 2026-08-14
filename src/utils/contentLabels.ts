/**
 * Compute [Image N] / [Video N] / [Audio N] labels for each reference media
 * item, matching the order Seedance interprets when scanning the `content`
 * array of the generation request.
 *
 * The numbering rule (per official docs):
 *   - Numbering is per-type, starting from 1, incrementing by appearance order
 *     in the `content` array (text content does not count).
 *   - When we build the request we always emit reference items in this order:
 *       referenceImages → referenceVideos → referenceAudios → assetRefs (mixed)
 *     so [Image 3] could be either the 3rd uploaded image, OR the first
 *     image-typed asset when only 2 images were uploaded.
 *
 * Format follows the docs' example: `[Image 1]` (with a space). Both
 * `[Image 1]` and `[Image1]` are accepted by the model — we standardise on the
 * spaced form.
 */

import type { AssetRef, AssetType } from '../types'

export interface ContentLabelInputs {
  imageCount: number
  videoCount: number
  audioCount: number
  assets: Pick<AssetRef, 'type'>[]
}

export interface ContentLabels {
  imageLabels: string[]
  videoLabels: string[]
  audioLabels: string[]
  /** One label per element of `assets`, in the same order. */
  assetLabels: string[]
}

const PREFIX: Record<AssetType, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}

/** 标签格式：2.0 页沿用 `[Image 1]`；2.5 官方文件一律 `@Image1`。
 *  // TODO(tech-debt): seedanceModels 能力表合并 — 格式应由模型能力表决定 */
export type LabelFormat = 'bracket' | 'at'

/** Build a label like `[Image 1]`（bracket）或 `@Image1`（at）for the given type and 1-based index. */
export function formatLabel(type: AssetType, n: number, format: LabelFormat = 'bracket'): string {
  if (format === 'at') return `@${PREFIX[type]}${n}`
  return `[${PREFIX[type]} ${n}]`
}

export function computeContentLabels(
  inputs: ContentLabelInputs,
  format: LabelFormat = 'bracket',
): ContentLabels {
  const { imageCount, videoCount, audioCount, assets } = inputs

  const imageLabels: string[] = []
  for (let i = 0; i < imageCount; i++) imageLabels.push(formatLabel('image', i + 1, format))

  const videoLabels: string[] = []
  for (let i = 0; i < videoCount; i++) videoLabels.push(formatLabel('video', i + 1, format))

  const audioLabels: string[] = []
  for (let i = 0; i < audioCount; i++) audioLabels.push(formatLabel('audio', i + 1, format))

  // Asset labels continue the per-type counter from where references left off.
  const counters: Record<AssetType, number> = {
    image: imageCount,
    video: videoCount,
    audio: audioCount,
  }
  const assetLabels = assets.map((a) => {
    counters[a.type] += 1
    return formatLabel(a.type, counters[a.type], format)
  })

  return { imageLabels, videoLabels, audioLabels, assetLabels }
}
