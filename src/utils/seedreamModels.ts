/**
 * Seedream 模型能力表 — 单一事实来源。
 * 依据 Seedream-api-reference/seedream-4.0-5.0-tutorial.md（官方 tutorial，
 * 2026-07-09 截取）。所有 UI 锁定（分辨率档位、组图、输出格式、参考图上限、
 * 自定义像素范围）都从这里读，不要在组件里散落魔术数字。
 */

export type SeedreamModelKey =
  | 'seedream-5-0-pro'
  | 'seedream-5-0-lite'
  | 'seedream-4-5'
  | 'seedream-4-0'

export type SizeLevel = '1K' | '2K' | '3K' | '4K'
export type OutputFormat = 'png' | 'jpeg'

export interface SeedreamModelSpec {
  key: SeedreamModelKey
  label: string
  /** 官方各模型可用的分辨率档位（method 2 的 size 值）。 */
  sizeLevels: readonly SizeLevel[]
  /** 可选输出格式。formatLocked=true 时 UI 停用选择且 payload 不送 output_format。 */
  outputFormats: readonly OutputFormat[]
  /** 4-5 / 4-0 固定 jpeg 且「不支持自定义设置」→ 不送 output_format 字段。 */
  formatLocked: boolean
  /** 组图输出（sequential_image_generation）。5.0 Pro 仅支持单图。 */
  supportsSequential: boolean
  /** 参考图上限：5.0 Pro = 10，其他 = 14。 */
  maxRefImages: number
  /** 自定义像素（method 1）允许的总像素范围（宽×高）。 */
  minTotalPx: number
  maxTotalPx: number
}

export const SEEDREAM_MODELS: Record<SeedreamModelKey, SeedreamModelSpec> = {
  'seedream-5-0-pro': {
    key: 'seedream-5-0-pro',
    label: 'Seedream 5.0 Pro',
    sizeLevels: ['1K', '2K'],
    outputFormats: ['png', 'jpeg'],
    formatLocked: false,
    supportsSequential: false,
    maxRefImages: 10,
    minTotalPx: 1280 * 720,   // 921,600
    maxTotalPx: 2048 * 2048,  // 4,194,304
  },
  'seedream-5-0-lite': {
    key: 'seedream-5-0-lite',
    label: 'Seedream 5.0 Lite',
    sizeLevels: ['2K', '3K', '4K'],
    outputFormats: ['png', 'jpeg'],
    formatLocked: false,
    supportsSequential: true,
    maxRefImages: 14,
    minTotalPx: 2560 * 1440,  // 3,686,400
    maxTotalPx: 4096 * 4096,  // 16,777,216
  },
  'seedream-4-5': {
    key: 'seedream-4-5',
    label: 'Seedream 4.5',
    sizeLevels: ['2K', '4K'],
    outputFormats: ['jpeg'],
    formatLocked: true,
    supportsSequential: true,
    maxRefImages: 14,
    minTotalPx: 2560 * 1440,
    maxTotalPx: 4096 * 4096,
  },
  'seedream-4-0': {
    key: 'seedream-4-0',
    label: 'Seedream 4.0',
    sizeLevels: ['1K', '2K', '4K'],
    outputFormats: ['jpeg'],
    formatLocked: true,
    supportsSequential: true,
    maxRefImages: 14,
    minTotalPx: 1280 * 720,
    maxTotalPx: 4096 * 4096,
  },
}

/** 下拉选单顺序：新 → 旧。 */
export const SEEDREAM_MODEL_OPTIONS: ReadonlyArray<{
  value: SeedreamModelKey
  label: string
}> = [
  { value: 'seedream-5-0-pro', label: 'Seedream 5.0 Pro' },
  { value: 'seedream-5-0-lite', label: 'Seedream 5.0 Lite' },
  { value: 'seedream-4-5', label: 'Seedream 4.5' },
  { value: 'seedream-4-0', label: 'Seedream 4.0' },
]

export const DEFAULT_SEEDREAM_MODEL: SeedreamModelKey = 'seedream-5-0-pro'

/** 档位模式的比例选项。'auto' = 不附加比例描述，交给模型 / prompt 决定。 */
export const ASPECT_RATIO_OPTIONS = [
  { value: 'auto', label: '自动（由 prompt 决定）' },
  { value: '1:1', label: '1:1 (方形)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9 (横向)' },
  { value: '9:16', label: '9:16 (竖向)' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '21:9', label: '21:9 (超宽)' },
] as const

/** 参考图数 + 生成张数 ≤ 15（官方限制，适用支持组图的模型）。 */
export const SEQUENTIAL_TOTAL_CAP = 15

/** 官方输入图限制：边长需 > 14px。 */
const MIN_EDGE_PX = 15
const RATIO_MIN = 1 / 16
const RATIO_MAX = 16

export interface CustomSizeResult {
  ok: boolean
  error?: string
}

/** 自定义像素（method 1）验证：边长、比例、总像素范围。 */
export function validateCustomSize(
  modelKey: SeedreamModelKey,
  width: number,
  height: number,
): CustomSizeResult {
  const spec = SEEDREAM_MODELS[modelKey]
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_EDGE_PX || height < MIN_EDGE_PX) {
    return { ok: false, error: `宽与高需为大于 ${MIN_EDGE_PX - 1}px 的整数` }
  }
  const ratio = width / height
  if (ratio < RATIO_MIN || ratio > RATIO_MAX) {
    return { ok: false, error: '宽高比例需在 1/16 – 16 之间' }
  }
  const total = width * height
  if (total < spec.minTotalPx || total > spec.maxTotalPx) {
    return {
      ok: false,
      error: `${spec.label} 总像素需在 ${spec.minTotalPx.toLocaleString()} – ${spec.maxTotalPx.toLocaleString()} 之间（目前 ${total.toLocaleString()}）`,
    }
  }
  return { ok: true }
}

/** 组图张数上限：15 − 参考图数，至少 1。 */
export function clampMaxImages(refCount: number, desired: number): number {
  const cap = Math.max(1, SEQUENTIAL_TOTAL_CAP - refCount)
  return Math.min(Math.max(1, desired), cap)
}

/**
 * 档位+比例模式（官方 method 2）：size 送档位字符串（如 "2K"），比例以自然语言
 * 附加到 prompt。不采「比例换算确切像素以 method 1 传送」— 官方对照表像素
 * （如 5-0-pro 2K 16:9 = 2848×1600）会超出该模型 method 1 的总像素上限。
 */
export function buildPromptWithRatio(prompt: string, ratio: string): string {
  if (ratio === 'auto') return prompt
  return `${prompt}\n\nAspect ratio: ${ratio}.`
}
