import { apiClient } from './client'
import type { ImageGenerationRequest, ImageGenerationResponse } from '../types/image'

export const IMAGES_PATH = '/api/v3/images/generations'

export interface GenerateImagesResult {
  response: ImageGenerationResponse
  /** ARK 响应标头的 x-request-id（若有）— 同步 API 没有 task id，这是最接近的调试识别码。 */
  requestId?: string
}

/**
 * Seedream 图片生成 — 同步 API：响应直接带图片 URL（24h 失效），没有 task id、
 * 不需要轮询。组图 + 4K 可能跑超过默认 30s，逾时放宽到 3 分钟。
 * 额外返回 x-request-id 标头（若有）作为调试识别码。
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
