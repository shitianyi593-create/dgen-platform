// ============================================================
// API Types — Seedream image generation / BytePlus ModelArk
// 官方文件未附 response JSON 范例；字段以 OpenAI images API 惯例 + ARK 惯例
// 定义为宽鬆可选，实际形状由 scripts/verify-seedream.ts 首跑确认（Task 11）。
// ============================================================

import type { SeedreamModelKey } from '../utils/seedreamModels'

export interface ImageGenerationRequest {
  /** 图片生成接入点 ep ID（与视频一致，不是模型 ID）。 */
  model: string
  prompt: string
  /** 省略 = 文生图；string = 单张参考图；string[] = 多张。值为 URL 或 base64 data URI。 */
  image?: string | string[]
  /** "1K"/"2K"/"3K"/"4K"（method 2）或 "WxH" 像素（method 1）。 */
  size?: string
  sequential_image_generation?: 'auto'
  sequential_image_generation_options?: { max_images: number }
  response_format: 'url'
  /** 仅 5.0 系列可自定义；4-5/4-0 锁 jpeg 时不送此字段。 */
  output_format?: 'png' | 'jpeg'
  watermark: boolean
  stream: false
}

export interface GeneratedImage {
  url?: string
  b64_json?: string
  size?: string
  /** 仅 seedream-5-0-pro 返回此字段（实际输出格式）。 */
  output_format?: string
  /** 组图部分失败时，该图的错误对象（data[].error）。 */
  error?: { code?: string; message?: string }
}

export interface ImageGenerationResponse {
  model?: string
  created?: number
  data?: GeneratedImage[]
  usage?: {
    generated_images?: number
    /** 仅 seedream-5-0-pro 返回。输入模型的图片数。 */
    input_images?: number
    output_tokens?: number
    total_tokens?: number
  }
  error?: { code?: string; message?: string }
}

// ============================================================
// UI / Store Types
// ============================================================

export type ImageGenStatus = 'generating' | 'succeeded' | 'failed'

/** 本地参考图（上传档）。比照 LocalMedia 但图片生成不需要 role/TOS 字段。 */
export interface ImageRefMedia {
  /** client 产生的稳定 id，供并发移除时定位。 */
  id: string
  /** sessionStorage 还原的 stub 没有 File（stale）。 */
  file?: File
  preview: string
  filename?: string
  stale?: boolean
}

/** 一笔图片生成历史。 */
export interface ImageHistoryItem {
  id: string
  status: ImageGenStatus
  prompt: string
  modelKey: SeedreamModelKey
  /** epoch ms（注意：videoStore 用秒，这里统一用 ms）。 */
  createdAt: number
  completedAt?: number
  /** completedAt + 24h。Seedream URL 24 小时后失效。imported 项目无此字段。 */
  expiresAt?: number
  images: Array<{ url: string; size?: string; outputFormat?: string }>
  /** true = 从 zip 导入（images[].url 是 blob: objectURL，仅存活于本页）。 */
  imported?: boolean
  error?: string
  /** 失败时 API 响应本体的 error.code（若可解析）。 */
  errorCode?: string
  /** 调试信息（同步 API 无 task id；这些字段来自响应本体与标头）。 */
  debug?: {
    requestId?: string
    /** API 返回的实际模型名-版本（验证 ep 背后的模型）。 */
    responseModel?: string
    /** API 返回的 created（Unix 秒）。 */
    createdApi?: number
    /** 组图时部分失败的逐图错误（data[].error）。 */
    imageErrors?: Array<{ code?: string; message?: string }>
  }
  params: {
    size?: string
    outputFormat?: 'png' | 'jpeg'
    watermark: boolean
    sequential: boolean
    maxImages?: number
    aspectRatio?: string
    refFilenames: string[]
    refUrls: string[]
  }
  usage?: {
    generated_images?: number
    total_tokens?: number
    outputTokens?: number
    inputImages?: number
  }
}
