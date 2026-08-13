import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ImageHistoryItem, ImageRefMedia } from '../types/image'
import {
  SEEDREAM_MODELS,
  DEFAULT_SEEDREAM_MODEL,
  type SeedreamModelKey,
  type SizeLevel,
  type OutputFormat,
} from '../utils/seedreamModels'

export type SizeMode = 'preset' | 'custom'

interface ImageState {
  // ── Generation params ──
  modelKey: SeedreamModelKey
  prompt: string
  sizeMode: SizeMode
  sizeLevel: SizeLevel
  aspectRatio: string          // 'auto' | '1:1' | ...
  customWidth: number
  customHeight: number
  outputFormat: OutputFormat
  watermark: boolean
  sequentialEnabled: boolean
  maxImages: number

  // ── Reference images ──
  refImages: ImageRefMedia[]
  refUrls: string[]

  // ── Result / history ──
  currentEntryId: string | null
  history: ImageHistoryItem[]

  // ── Actions ──
  setModelKey: (k: SeedreamModelKey) => void
  setPrompt: (p: string) => void
  setSizeMode: (m: SizeMode) => void
  setSizeLevel: (l: SizeLevel) => void
  setAspectRatio: (r: string) => void
  setCustomWidth: (w: number) => void
  setCustomHeight: (h: number) => void
  setOutputFormat: (f: OutputFormat) => void
  setWatermark: (w: boolean) => void
  setSequentialEnabled: (v: boolean) => void
  setMaxImages: (n: number) => void

  addRefImage: (m: ImageRefMedia) => void
  removeRefImage: (id: string) => void
  addRefUrl: () => void
  updateRefUrl: (idx: number, url: string) => void
  removeRefUrl: (idx: number) => void

  setCurrentEntry: (id: string | null) => void
  addHistory: (item: ImageHistoryItem) => void
  updateHistory: (id: string, patch: Partial<ImageHistoryItem>) => void
  removeHistory: (id: string) => void
  clearHistory: () => void
  /** 把一筆歷史的參數回填到表單（參考圖除外 — 檔案無法還原）。 */
  loadParamsFromHistory: (item: ImageHistoryItem) => void
  resetForNewTask: () => void
}

/** 釋放單一 blob: objectURL（guard：測試環境可能沒有 URL.revokeObjectURL）。 */
function revokeBlobUrl(url: string): void {
  if (url.startsWith('blob:') && typeof URL !== 'undefined' && URL.revokeObjectURL) {
    try { URL.revokeObjectURL(url) } catch { /* test env */ }
  }
}

/** imported 項目的 blob: objectURL 需要手動釋放，避免記憶體洩漏。 */
function revokeImportedImageUrls(item: ImageHistoryItem): void {
  if (!item.imported) return
  for (const img of item.images) revokeBlobUrl(img.url)
}

export const useImageStore = create<ImageState>()(
  persist(
    (set) => ({
      modelKey: DEFAULT_SEEDREAM_MODEL,
      prompt: '',
      sizeMode: 'preset',
      sizeLevel: '2K',
      aspectRatio: 'auto',
      customWidth: 2048,
      customHeight: 2048,
      outputFormat: 'png',
      watermark: false,
      sequentialEnabled: false,
      maxImages: 4,

      refImages: [],
      refUrls: [],

      currentEntryId: null,
      history: [],

      // 切換模型：把不相容的當前值修正為該模型的合法值。
      setModelKey: (modelKey) =>
        set((s) => {
          const spec = SEEDREAM_MODELS[modelKey]
          return {
            modelKey,
            sizeLevel: spec.sizeLevels.includes(s.sizeLevel)
              ? s.sizeLevel
              : spec.sizeLevels[0],
            outputFormat: spec.outputFormats.includes(s.outputFormat)
              ? s.outputFormat
              : spec.outputFormats[0],
            sequentialEnabled: spec.supportsSequential ? s.sequentialEnabled : false,
          }
        }),
      setPrompt: (prompt) => set({ prompt }),
      setSizeMode: (sizeMode) => set({ sizeMode }),
      setSizeLevel: (sizeLevel) => set({ sizeLevel }),
      setAspectRatio: (aspectRatio) => set({ aspectRatio }),
      setCustomWidth: (customWidth) => set({ customWidth }),
      setCustomHeight: (customHeight) => set({ customHeight }),
      setOutputFormat: (outputFormat) => set({ outputFormat }),
      setWatermark: (watermark) => set({ watermark }),
      setSequentialEnabled: (sequentialEnabled) => set({ sequentialEnabled }),
      setMaxImages: (maxImages) => set({ maxImages }),

      addRefImage: (m) => set((s) => ({ refImages: [...s.refImages, m] })),
      removeRefImage: (id) =>
        set((s) => {
          const victim = s.refImages.find((r) => r.id === id)
          if (victim) revokeBlobUrl(victim.preview)
          return { refImages: s.refImages.filter((r) => r.id !== id) }
        }),
      addRefUrl: () => set((s) => ({ refUrls: [...s.refUrls, ''] })),
      updateRefUrl: (idx, url) =>
        set((s) => ({ refUrls: s.refUrls.map((u, i) => (i === idx ? url : u)) })),
      removeRefUrl: (idx) =>
        set((s) => ({ refUrls: s.refUrls.filter((_, i) => i !== idx) })),

      setCurrentEntry: (currentEntryId) => set({ currentEntryId }),
      addHistory: (item) => set((s) => ({ history: [item, ...s.history] })),
      updateHistory: (id, patch) =>
        set((s) => ({
          history: s.history.map((h) => (h.id === id ? { ...h, ...patch } : h)),
        })),
      removeHistory: (id) =>
        set((s) => {
          const victim = s.history.find((h) => h.id === id)
          if (victim) revokeImportedImageUrls(victim)
          return {
            history: s.history.filter((h) => h.id !== id),
            currentEntryId: s.currentEntryId === id ? null : s.currentEntryId,
          }
        }),
      clearHistory: () =>
        set((s) => {
          for (const h of s.history) revokeImportedImageUrls(h)
          return { history: [], currentEntryId: null }
        }),

      loadParamsFromHistory: (item) =>
        set((s) => {
          // 回填會丟棄表單上的參考圖 → 先釋放它們的 blob preview，
          // 與 removeRefImage / resetForNewTask 的不變量一致。
          for (const m of s.refImages) revokeBlobUrl(m.preview)
          const spec = SEEDREAM_MODELS[item.modelKey]
          const size = item.params.size ?? ''
          const customMatch = size.match(/^(\d+)x(\d+)$/)
          return {
            modelKey: item.modelKey,
            prompt: item.prompt,
            sizeMode: customMatch ? 'custom' : 'preset',
            ...(customMatch
              ? {
                  customWidth: Number(customMatch[1]),
                  customHeight: Number(customMatch[2]),
                }
              : {
                  sizeLevel: spec.sizeLevels.includes(size as SizeLevel)
                    ? (size as SizeLevel)
                    : spec.sizeLevels[0],
                }),
            aspectRatio: item.params.aspectRatio ?? 'auto',
            outputFormat:
              item.params.outputFormat && spec.outputFormats.includes(item.params.outputFormat)
                ? item.params.outputFormat
                : spec.outputFormats[0],
            watermark: item.params.watermark,
            sequentialEnabled: item.params.sequential && spec.supportsSequential,
            maxImages: item.params.maxImages ?? 4,
            refUrls: [...item.params.refUrls],
            refImages: [],
          }
        }),

      resetForNewTask: () =>
        set((s) => {
          for (const m of s.refImages) revokeBlobUrl(m.preview)
          return { prompt: '', refImages: [], refUrls: [] }
        }),
    }),
    {
      name: 'byteplus-ai-gen-platform-image',
      // sessionStorage = per-tab，同 authStore / videoStore 的理由。
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      partialize: (state) => ({
        modelKey: state.modelKey,
        prompt: state.prompt,
        sizeMode: state.sizeMode,
        sizeLevel: state.sizeLevel,
        aspectRatio: state.aspectRatio,
        customWidth: state.customWidth,
        customHeight: state.customHeight,
        outputFormat: state.outputFormat,
        watermark: state.watermark,
        sequentialEnabled: state.sequentialEnabled,
        maxImages: state.maxImages,
        refUrls: state.refUrls,
        currentEntryId: state.currentEntryId,
        // imported 項目的 blob: URL 重整後必死，不持久化（同 videoStore 理由）。
        history: state.history.filter((h) => !h.imported),
        // File 不能 JSON 序列化 → 存檔名 stub，rehydrate 標記 stale。
        refImages: state.refImages.map((m) => ({
          filename: m.filename ?? m.file?.name ?? 'unknown',
        })),
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<ImageState> & {
          refImages?: Array<{ filename: string }>
        }
        return {
          ...currentState,
          ...p,
          refImages: (p.refImages ?? []).map((stub, i) => ({
            id: `stale-${i}-${stub.filename}`,
            preview: '',
            filename: stub.filename,
            stale: true,
          })),
        }
      },
    },
  ),
)
