import { apiClient } from './client'
import type { ImageGenerationRequest, ImageGenerationResponse } from '../types/image'

export const IMAGES_PATH = '/api/v3/images/generations'

export interface GenerateImagesResult {
  response: ImageGenerationResponse
  /** ARK 回應標頭的 x-request-id（若有）— 同步 API 沒有 task id，這是最接近的除錯識別碼。 */
  requestId?: string
}

/**
 * Seedream 圖片生成 — 同步 API：回應直接帶圖片 URL（24h 失效），沒有 task id、
 * 不需要輪詢。組圖 + 4K 可能跑超過預設 30s，逾時放寬到 3 分鐘。
 * 額外回傳 x-request-id 標頭（若有）作為除錯識別碼。
 */
export async function generateImages(
  body: ImageGenerationRequest,
): Promise<GenerateImagesResult> {
  const res = await apiClient.post<ImageGenerationResponse>(IMAGES_PATH, body, {
    timeout: 180_000,
  })
  const requestId = res.headers?.['x-request-id'] as string | undefined
  return { response: res.data, requestId }
}
