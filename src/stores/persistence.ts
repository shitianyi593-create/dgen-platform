import type { ContentItem, CreateVideoTaskRequest, VideoHistoryItem } from '../types'
import type { ImageHistoryItem } from '../types/image'

const DATA_OR_BLOB_URL = /^(data|blob):/i
const MAX_VIDEO_HISTORY = 30
const MAX_IMAGE_HISTORY = 50

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function createMigratingSessionStorage(legacyName: string): BrowserStorage {
  return {
    getItem: (name) => {
      const current = sessionStorage.getItem(name)
      if (current !== null) return current
      return sessionStorage.getItem(legacyName)
    },
    setItem: (name, value) => {
      try {
        sessionStorage.setItem(name, value)
      } catch (err) {
        const compacted = compactPersistedJson(value)
        if (compacted === value) throw err
        sessionStorage.setItem(name, compacted)
      }
      if (legacyName !== name) sessionStorage.removeItem(legacyName)
    },
    removeItem: (name) => {
      sessionStorage.removeItem(name)
      if (legacyName !== name) sessionStorage.removeItem(legacyName)
    },
  }
}

export function sanitizeVideoHistory(history: VideoHistoryItem[]): VideoHistoryItem[] {
  return history
    .filter((h) => !h.imported)
    .slice(0, MAX_VIDEO_HISTORY)
    .map((item) => {
      const sanitized: VideoHistoryItem = {
        ...item,
        requestContent: sanitizeVideoRequest(item.requestContent),
      }

      delete sanitized.objectUrl
      delete sanitized.frameObjectUrl
      if (sanitized.thumbnailUrl && isLocalLargeUrl(sanitized.thumbnailUrl)) {
        delete sanitized.thumbnailUrl
      }

      return sanitized
    })
}

export function sanitizeImageHistory(history: ImageHistoryItem[]): ImageHistoryItem[] {
  return history
    .filter((h) => !h.imported)
    .slice(0, MAX_IMAGE_HISTORY)
    .map((item) => ({
      ...item,
      images: item.images.filter((img) => !isLocalLargeUrl(img.url)),
      params: {
        ...item.params,
        refUrls: item.params.refUrls.filter((url) => !isLocalLargeUrl(url)),
      },
    }))
}

export function sanitizeVideoPersistedState<T extends { history?: VideoHistoryItem[] }>(state: T): T {
  return {
    ...state,
    history: sanitizeVideoHistory(state.history ?? []),
  }
}

export function sanitizeImagePersistedState<T extends { history?: ImageHistoryItem[] }>(state: T): T {
  return {
    ...state,
    history: sanitizeImageHistory(state.history ?? []),
  }
}

function sanitizeVideoRequest(request: CreateVideoTaskRequest | undefined): CreateVideoTaskRequest | undefined {
  if (!request) return undefined
  return {
    ...request,
    content: request.content
      .map(sanitizeContentItem)
      .filter((item): item is ContentItem => Boolean(item)),
  }
}

function sanitizeContentItem(item: ContentItem): ContentItem | undefined {
  if (item.type === 'text') return item
  if (item.type === 'image_url') {
    return isLocalLargeUrl(item.image_url.url) ? undefined : item
  }
  if (item.type === 'video_url') {
    return isLocalLargeUrl(item.video_url.url) ? undefined : item
  }
  if (item.type === 'audio_url') {
    return isLocalLargeUrl(item.audio_url.url) ? undefined : item
  }
  return item
}

function isLocalLargeUrl(url: string): boolean {
  return DATA_OR_BLOB_URL.test(url)
}

function compactPersistedJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as { state?: Record<string, unknown> }
    const state = parsed.state
    if (!state || !Array.isArray(state.history)) return value
    parsed.state = {
      ...state,
      history: state.history.slice(0, 5).map((item) => compactHistoryItem(item)),
    }
    return JSON.stringify(parsed)
  } catch {
    return value
  }
}

function compactHistoryItem(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  return {
    taskId: record.taskId,
    id: record.id,
    status: record.status,
    prompt: record.prompt,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
    videoUrl: record.videoUrl,
    lastFrameUrl: record.lastFrameUrl,
    images: Array.isArray(record.images)
      ? record.images.filter((img) => {
          if (!img || typeof img !== 'object') return false
          const url = (img as { url?: unknown }).url
          return typeof url === 'string' && !isLocalLargeUrl(url)
        })
      : undefined,
    error: record.error,
    errorCode: record.errorCode,
  }
}
