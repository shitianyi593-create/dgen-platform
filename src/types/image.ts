// ============================================================
// API Types — Seedream image generation / BytePlus ModelArk
// 官方文件未附 response JSON 範例；欄位以 OpenAI images API 慣例 + ARK 慣例
// 定義為寬鬆可選，實際形狀由 scripts/verify-seedream.ts 首跑確認（Task 11）。
// ============================================================

import type { SeedreamModelKey } from '../utils/seedreamModels'

export interface ImageGenerationRequest {
  /** 圖片生成接入點 ep ID（與影片一致，不是模型 ID）。 */
  model: string
  prompt: string
  /** 省略 = 文生圖；string = 單張參考圖；string[] = 多張。值為 URL 或 base64 data URI。 */
  image?: string | string[]
  /** "1K"/"2K"/"3K"/"4K"（method 2）或 "WxH" 像素（method 1）。 */
  size?: string
  sequential_image_generation?: 'auto'
  sequential_image_generation_options?: { max_images: number }
  response_format: 'url'
  /** 僅 5.0 系列可自訂；4-5/4-0 鎖 jpeg 時不送此欄位。 */
  output_format?: 'png' | 'jpeg'
  watermark: boolean
  stream: false
}

export interface GeneratedImage {
  url?: string
  b64_json?: string
  size?: string
  /** 僅 seedream-5-0-pro 回傳此欄位（實際輸出格式）。 */
  output_format?: string
  /** 組圖部分失敗時，該圖的錯誤物件（data[].error）。 */
  error?: { code?: string; message?: string }
}

export interface ImageGenerationResponse {
  model?: string
  created?: number
  data?: GeneratedImage[]
  usage?: {
    generated_images?: number
    /** 僅 seedream-5-0-pro 回傳。輸入模型的圖片數。 */
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

/** 本地參考圖（上傳檔）。比照 LocalMedia 但圖片生成不需要 role/TOS 欄位。 */
export interface ImageRefMedia {
  /** client 產生的穩定 id，供並發移除時定位。 */
  id: string
  /** sessionStorage 還原的 stub 沒有 File（stale）。 */
  file?: File
  preview: string
  filename?: string
  stale?: boolean
}

/** 一筆圖片生成歷史。 */
export interface ImageHistoryItem {
  id: string
  status: ImageGenStatus
  prompt: string
  modelKey: SeedreamModelKey
  /** epoch ms（注意：videoStore 用秒，這裡統一用 ms）。 */
  createdAt: number
  completedAt?: number
  /** completedAt + 24h。Seedream URL 24 小時後失效。imported 項目無此欄位。 */
  expiresAt?: number
  images: Array<{ url: string; size?: string; outputFormat?: string }>
  /** true = 從 zip 匯入（images[].url 是 blob: objectURL，僅存活於本頁）。 */
  imported?: boolean
  error?: string
  /** 失敗時 API 回應本體的 error.code（若可解析）。 */
  errorCode?: string
  /** 除錯資訊（同步 API 無 task id；這些欄位來自回應本體與標頭）。 */
  debug?: {
    requestId?: string
    /** API 回傳的實際模型名-版本（驗證 ep 背後的模型）。 */
    responseModel?: string
    /** API 回傳的 created（Unix 秒）。 */
    createdApi?: number
    /** 組圖時部分失敗的逐圖錯誤（data[].error）。 */
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
