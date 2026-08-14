/**
 * Hook that wraps the reference-video / reference-audio store actions with
 * an immediate TOS upload step.
 *
 * Each item is tagged with a stable `id` before being put in the store so we
 * can locate it again when the upload finishes — even if the user removed
 * and re-added items in the meantime.
 */
import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore, type VideoStoreHook } from '../stores/videoStore'
import { uploadToTos } from '../api/tos'
import type { LocalMedia } from '../types'
import { useOptionalI18n } from '../i18n/useOptionalI18n'
import {
  DEFAULT_LOCALE,
  messages,
  type Locale,
  type MessageKey,
} from '../i18n/locales'

function generateId(): string {
  // Browser crypto is available in tests via jsdom
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

type Kind = 'video' | 'audio'

interface KindStrings {
  label: string
  successKey: MessageKey
  failureKey: MessageKey
}

const COPY: Record<Kind, KindStrings> = {
  video: {
    label: 'video',
    successKey: 'video.toast.referenceVideoUploaded',
    failureKey: 'video.toast.videoUploadFailed',
  },
  audio: {
    label: 'audio',
    successKey: 'video.toast.referenceAudioUploaded',
    failureKey: 'video.toast.audioUploadFailed',
  },
}

export interface UploadDeps {
  /** Inject upload implementation for tests. */
  upload?: (file: File) => Promise<{ key: string; viewUrl: string; expiresAt: number }>
  locale?: Locale
}

function translate(locale: Locale | undefined, key: MessageKey, params?: Record<string, string | number>) {
  const template = messages[locale ?? DEFAULT_LOCALE][key]
  if (!params) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
    params[name] === undefined ? match : String(params[name])
  ))
}

/** Add a media item to the store and immediately upload to TOS. Tolerant of
 *  the user removing the item before upload completes. */
export async function addReferenceWithUpload(
  kind: Kind,
  m: LocalMedia,
  deps: UploadDeps = {},
  useStore: VideoStoreHook = useVideoStore,
): Promise<void> {
  // Stale rehydrated stubs (from sessionStorage) have no File and cannot be
  // uploaded — they only exist so the UI can show the previous filename.
  if (!m.file) return

  const id = m.id ?? generateId()
  const file = m.file
  const augmented: LocalMedia = {
    ...m,
    id,
    uploading: true,
    error: undefined,
    uploadedUrl: undefined,
    tosKey: undefined,
  }

  const store = useStore.getState()
  const addAction = kind === 'video' ? store.addReferenceVideo : store.addReferenceAudio
  addAction(augmented)

  const upload = deps.upload ?? uploadToTos

  try {
    const result = await upload(file)
    const list = pickList(kind, useStore)
    const idx = list.findIndex((item) => item.id === id)
    if (idx === -1) return // user removed it before upload finished
    const updateAction =
      kind === 'video'
        ? useStore.getState().updateReferenceVideo
        : useStore.getState().updateReferenceAudio
    updateAction(idx, {
      uploading: false,
      uploadedUrl: result.viewUrl,
      tosKey: result.key,
      error: undefined,
    })
    toast.success(translate(deps.locale, COPY[kind].successKey))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const list = pickList(kind, useStore)
    const idx = list.findIndex((item) => item.id === id)
    if (idx === -1) return
    const updateAction =
      kind === 'video'
        ? useStore.getState().updateReferenceVideo
        : useStore.getState().updateReferenceAudio
    updateAction(idx, { uploading: false, error: msg })
    toast.error(translate(deps.locale, COPY[kind].failureKey, { message: msg }))
  }
}

function pickList(kind: Kind, useStore: VideoStoreHook): LocalMedia[] {
  const s = useStore.getState()
  return kind === 'video' ? s.referenceVideos : s.referenceAudios
}

/** Hook surface used by VideoParams. */
export function useReferenceUpload(deps: UploadDeps = {}, useStore: VideoStoreHook = useVideoStore) {
  const { locale } = useOptionalI18n()
  const addReferenceVideo = useCallback(
    (m: LocalMedia) => {
      void addReferenceWithUpload('video', m, { ...deps, locale }, useStore)
    },
    [deps, locale, useStore],
  )
  const addReferenceAudio = useCallback(
    (m: LocalMedia) => {
      void addReferenceWithUpload('audio', m, { ...deps, locale }, useStore)
    },
    [deps, locale, useStore],
  )
  return { addReferenceVideo, addReferenceAudio }
}
