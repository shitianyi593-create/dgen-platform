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
import { useOptionalI18n } from '../i18n/useOptionalI18n'
import { messages, DEFAULT_LOCALE, type MessageKey } from '../i18n/locales'
import type { ImageGenerationRequest, ImageHistoryItem } from '../types/image'

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

const defaultT: Translate = (key, params) => {
  let message: string = messages[DEFAULT_LOCALE][key] ?? key
  if (params) {
    message = message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
      params[name] === undefined ? match : String(params[name])
    ))
  }
  return message
}

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
  /** 已解析的参考图输入（data URI 或 https URL），依 UI 顺序。 */
  imageInputs: string[]
}

/** 纯函数：组出 Seedream request payload。独立导出供单元测试。 */
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
  // 4-5/4-0 官方「不支持自定义设置」→ 不送 output_format。
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
 * 纯函数：返回目前状态下不能生成的原因（null = 可生成）。
 * ImageParams 的按钮 disable 与 generate() 的前置检查共用同一份逻辑。
 */
export function computeImageBlockReason(t: Translate = defaultT): string | null {
  const { apiKey, imageEndpoint } = useAuthStore.getState()
  const s = useImageStore.getState()
  const spec = SEEDREAM_MODELS[s.modelKey]

  if (!apiKey) return t('image.block.apiKey')
  if (!imageEndpoint) return t('image.block.endpoint')
  if (!s.prompt.trim()) return t('image.block.prompt')
  if (s.refImages.some((m) => m.stale)) {
    return t('image.block.staleRefs')
  }
  const activeUrls = s.refUrls.map((u) => u.trim()).filter((u) => u !== '')
  if (activeUrls.some((u) => !/^https?:\/\//i.test(u))) {
    return t('image.block.invalidUrl')
  }
  const refCount = s.refImages.length + activeUrls.length
  if (refCount > spec.maxRefImages) {
    return t('image.block.refLimit', { model: spec.label, max: spec.maxRefImages, count: refCount })
  }
  if (s.sizeMode === 'custom') {
    const v = validateCustomSize(s.modelKey, s.customWidth, s.customHeight)
    if (!v.ok) return v.error ?? t('image.block.invalidCustomSize')
  }
  if (s.sequentialEnabled && !spec.supportsSequential) {
    return t('image.block.sequentialUnsupported', { model: spec.label })
  }
  return null
}

function makeEntryId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const URL_TTL_MS = 24 * 3600 * 1000 // Seedream 图片 URL 保留 24 小时

/**
 * 图片生成流程。同步 API：await 直接拿到结果，不需要 poller。
 * 允许并发 — 每次 generate() 有独立的 history entry。
 */
export function useImageGeneration() {
  const { t } = useOptionalI18n()
  const generate = useCallback(async (): Promise<void> => {
    const reason = computeImageBlockReason(t)
    if (reason) {
      toast.error(reason)
      return
    }

    const s = useImageStore.getState()
    const { imageEndpoint } = useAuthStore.getState()
    // Snapshot：用户可能在等待期间改表单。
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
      // 上传档 → base64 data URI（Seedream 接受 URL 或 base64）。
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
      // 组图时部分失败的逐图错误（data[].error）— 保留供调试区显示。
      const imageErrors = (response.data ?? [])
        .filter((d) => d.error)
        .map((d) => ({ code: d.error?.code, message: d.error?.message }))
      if (images.length === 0) {
        // 空响应但本体可解析出 error.code：夹带到 Error 上供 catch 存 errorCode。
        const e = new Error(response.error?.message ?? t('image.error.emptyResponse')) as Error & {
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
      toast.success(t('image.toast.generated', { count: images.length }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const errorCode = (err as { code?: string } | null)?.code
      updateHistory(entryId, {
        status: 'failed',
        error: message,
        errorCode,
        completedAt: Date.now(),
      })
      toast.error(t('image.toast.generateFailed', { message }))
    }
  }, [t])

  return { generate }
}
