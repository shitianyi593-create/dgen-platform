import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { useImageStore, type SizeMode } from '../stores/imageStore'
import { useAuthStore } from '../stores/authStore'
import { generateImages } from '../api/image'
import { fileToBase64DataUri } from '../api/fileUtils'
import {
  SEEDREAM_MODELS,
  buildPromptWithRatio,
  clampMaxImages,
  validateCustomSize,
  type SeedreamModelKey,
  type SizeLevel,
  type OutputFormat,
} from '../utils/seedreamModels'
import type { ImageGenerationRequest, ImageHistoryItem } from '../types/image'

export interface BuildImageRequestArgs {
  endpoint: string
  prompt: string
  modelKey: SeedreamModelKey
  sizeMode: SizeMode
  sizeLevel: SizeLevel
  aspectRatio: string
  customWidth: number
  customHeight: number
  outputFormat: OutputFormat
  watermark: boolean
  sequentialEnabled: boolean
  maxImages: number
  /** 已解析的參考圖輸入（data URI 或 https URL），依 UI 順序。 */
  imageInputs: string[]
}

/** 純函式：組出 Seedream request payload。獨立匯出供單元測試。 */
export function buildImageRequest(args: BuildImageRequestArgs): ImageGenerationRequest {
  const spec = SEEDREAM_MODELS[args.modelKey]
  const req: ImageGenerationRequest = {
    model: args.endpoint,
    prompt:
      args.sizeMode === 'preset'
        ? buildPromptWithRatio(args.prompt, args.aspectRatio)
        : args.prompt,
    size:
      args.sizeMode === 'preset'
        ? args.sizeLevel
        : `${args.customWidth}x${args.customHeight}`,
    response_format: 'url',
    watermark: args.watermark,
    stream: false,
  }
  // 4-5/4-0 官方「不支援自訂設定」→ 不送 output_format。
  if (!spec.formatLocked) req.output_format = args.outputFormat
  if (args.imageInputs.length === 1) req.image = args.imageInputs[0]
  else if (args.imageInputs.length > 1) req.image = [...args.imageInputs]
  if (args.sequentialEnabled && spec.supportsSequential) {
    req.sequential_image_generation = 'auto'
    req.sequential_image_generation_options = {
      max_images: clampMaxImages(args.imageInputs.length, args.maxImages),
    }
  }
  return req
}

/**
 * 純函式：回傳目前狀態下不能生成的原因（null = 可生成）。
 * ImageParams 的按鈕 disable 與 generate() 的前置檢查共用同一份邏輯。
 */
export function computeImageBlockReason(): string | null {
  const { apiKey, imageEndpoint } = useAuthStore.getState()
  const s = useImageStore.getState()
  const spec = SEEDREAM_MODELS[s.modelKey]

  if (!apiKey) return '請先輸入 API 金鑰'
  if (!imageEndpoint) return '請先設定圖片生成接入點（憑證設定 ⌘,）'
  if (!s.prompt.trim()) return '請輸入提示詞'
  if (s.refImages.some((m) => m.stale)) {
    return '部分參考圖因頁面重整失效，請移除後重新上傳'
  }
  const activeUrls = s.refUrls.map((u) => u.trim()).filter((u) => u !== '')
  if (activeUrls.some((u) => !/^https?:\/\//i.test(u))) {
    return '參考圖 URL 格式不正確（需以 http(s):// 開頭）'
  }
  const refCount = s.refImages.length + activeUrls.length
  if (refCount > spec.maxRefImages) {
    return `${spec.label} 參考圖上限為 ${spec.maxRefImages} 張（目前 ${refCount} 張）`
  }
  if (s.sizeMode === 'custom') {
    const v = validateCustomSize(s.modelKey, s.customWidth, s.customHeight)
    if (!v.ok) return v.error ?? '自訂像素不合法'
  }
  if (s.sequentialEnabled && !spec.supportsSequential) {
    return `${spec.label} 不支援組圖輸出`
  }
  return null
}

function makeEntryId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const URL_TTL_MS = 24 * 3600 * 1000 // Seedream 圖片 URL 保留 24 小時

/**
 * 圖片生成流程。同步 API：await 直接拿到結果，不需要 poller。
 * 允許並發 — 每次 generate() 有獨立的 history entry。
 */
export function useImageGeneration() {
  const generate = useCallback(async (): Promise<void> => {
    const reason = computeImageBlockReason()
    if (reason) {
      toast.error(reason)
      return
    }

    const s = useImageStore.getState()
    const { imageEndpoint } = useAuthStore.getState()
    // Snapshot：使用者可能在等待期間改表單。
    const refSnapshot = [...s.refImages]
    const urlSnapshot = s.refUrls.map((u) => u.trim()).filter((u) => u !== '')

    const entryId = makeEntryId()
    const entry: ImageHistoryItem = {
      id: entryId,
      status: 'generating',
      prompt: s.prompt,
      modelKey: s.modelKey,
      createdAt: Date.now(),
      images: [],
      params: {
        size:
          s.sizeMode === 'preset'
            ? s.sizeLevel
            : `${s.customWidth}x${s.customHeight}`,
        outputFormat: SEEDREAM_MODELS[s.modelKey].formatLocked ? 'jpeg' : s.outputFormat,
        watermark: s.watermark,
        sequential: s.sequentialEnabled,
        maxImages: s.sequentialEnabled ? s.maxImages : undefined,
        aspectRatio: s.aspectRatio,
        refFilenames: refSnapshot.map((m) => m.filename ?? 'unknown'),
        refUrls: urlSnapshot,
      },
    }
    const { addHistory, updateHistory, setCurrentEntry } = useImageStore.getState()
    addHistory(entry)
    setCurrentEntry(entryId)

    try {
      // 上傳檔 → base64 data URI（Seedream 接受 URL 或 base64）。
      const fileInputs: string[] = []
      for (const m of refSnapshot) {
        if (!m.file) continue
        fileInputs.push(await fileToBase64DataUri(m.file))
      }
      const req = buildImageRequest({
        endpoint: imageEndpoint,
        prompt: s.prompt,
        modelKey: s.modelKey,
        sizeMode: s.sizeMode,
        sizeLevel: s.sizeLevel,
        aspectRatio: s.aspectRatio,
        customWidth: s.customWidth,
        customHeight: s.customHeight,
        outputFormat: s.outputFormat,
        watermark: s.watermark,
        sequentialEnabled: s.sequentialEnabled,
        maxImages: s.maxImages,
        imageInputs: [...fileInputs, ...urlSnapshot],
      })

      const { response, requestId } = await generateImages(req)
      const images = (response.data ?? [])
        .filter((d) => typeof d.url === 'string' && d.url !== '')
        .map((d) => ({ url: d.url!, size: d.size, outputFormat: d.output_format }))
      // 組圖時部分失敗的逐圖錯誤（data[].error）— 保留供除錯區顯示。
      const imageErrors = (response.data ?? [])
        .filter((d) => d.error)
        .map((d) => ({ code: d.error?.code, message: d.error?.message }))
      if (images.length === 0) {
        // 空回應但本體可解析出 error.code：夾帶到 Error 上供 catch 存 errorCode。
        const e = new Error(response.error?.message ?? 'API 未回傳任何圖片') as Error & {
          code?: string
        }
        e.code = response.error?.code
        throw e
      }
      const completedAt = Date.now()
      updateHistory(entryId, {
        status: 'succeeded',
        images,
        completedAt,
        expiresAt: completedAt + URL_TTL_MS,
        usage: response.usage
          ? {
              generated_images: response.usage.generated_images,
              total_tokens: response.usage.total_tokens,
              outputTokens: response.usage.output_tokens,
              inputImages: response.usage.input_images,
            }
          : undefined,
        debug: {
          requestId,
          responseModel: response.model,
          createdApi: response.created,
          imageErrors: imageErrors.length ? imageErrors : undefined,
        },
      })
      toast.success(`已生成 ${images.length} 張圖片`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const errorCode = (err as { code?: string } | null)?.code
      updateHistory(entryId, {
        status: 'failed',
        error: message,
        errorCode,
        completedAt: Date.now(),
      })
      toast.error(`生成失敗: ${message}`)
    }
  }, [])

  return { generate }
}
