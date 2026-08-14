import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { VideoHistoryItem, LocalMedia, AssetRef, VideoGenMode, ImageRole } from '../types';
import { revokeImportedUrls } from '../api/importBundle';
import { defaultRoleForMode } from '../utils/videoMode';

export interface VideoState {
  // ── Generation mode (Seedance 2.0 三模式互斥) ──
  mode: VideoGenMode;
  setMode: (mode: VideoGenMode) => void;

  // ── Generation params ──
  prompt: string;
  ratio: string;
  duration: number;
  resolution: string;
  watermark: boolean;
  generateAudio: boolean;
  returnLastFrame: boolean;
  seed: number;
  executionExpiresAfter: number;

  // ── Reference media ──
  referenceImages: LocalMedia[];
  referenceVideos: LocalMedia[];
  referenceAudios: LocalMedia[];

  // ── Asset references (asset://asset-xxxxx URI) ──
  assetRefs: AssetRef[];

  // ── Active tasks (concurrent) ──
  activeTaskIds: string[];

  // ── Currently displayed video ──
  currentTaskId: string | null;
  currentVideoUrl: string | null;

  // ── History ──
  history: VideoHistoryItem[];

  // ── Actions ──
  setPrompt: (p: string) => void;
  setRatio: (r: string) => void;
  setDuration: (d: number) => void;
  setResolution: (r: string) => void;
  setWatermark: (w: boolean) => void;
  setGenerateAudio: (g: boolean) => void;
  setReturnLastFrame: (v: boolean) => void;
  setSeed: (n: number) => void;
  setExecutionExpiresAfter: (n: number) => void;

  addReferenceImage: (m: LocalMedia) => void;
  removeReferenceImage: (idx: number) => void;
  updateReferenceImage: (idx: number, patch: Partial<LocalMedia>) => void;
  setImageRole: (idx: number, role: ImageRole) => void;

  addReferenceVideo: (m: LocalMedia) => void;
  removeReferenceVideo: (idx: number) => void;
  updateReferenceVideo: (idx: number, patch: Partial<LocalMedia>) => void;

  addReferenceAudio: (m: LocalMedia) => void;
  removeReferenceAudio: (idx: number) => void;
  updateReferenceAudio: (idx: number, patch: Partial<LocalMedia>) => void;

  addAssetRef: (ref: AssetRef) => void;
  removeAssetRef: (idx: number) => void;
  updateAssetRef: (idx: number, patch: Partial<AssetRef>) => void;

  addActiveTask: (taskId: string) => void;
  removeActiveTask: (taskId: string) => void;

  setCurrentTask: (taskId: string | null) => void;
  setCurrentVideoUrl: (url: string | null) => void;

  addHistory: (item: VideoHistoryItem) => void;
  updateHistory: (taskId: string, patch: Partial<VideoHistoryItem>) => void;
  clearHistory: () => void;
  removeHistory: (taskId: string) => void;

  /** Reset everything that belongs to "the current task in progress of being
   *  composed" — the prompt and all reference media. Preserves user
   *  preferences (ratio/duration/toggles), credentials (in authStore),
   *  history, and active polling tasks. */
  resetForNewTask: () => void;
}

export const useVideoStore = create<VideoState>()(
  persist(
    (set) => ({
  mode: 'multimodal',
  setMode: (mode) => set({ mode }),

  prompt: '',
  ratio: 'adaptive',
  duration: 5,
  // Seedance 2.0 默认分辨率（官方文件）
  resolution: '720p',
  watermark: false,
  generateAudio: true,
  // 默认 ON — 连续生成（首尾帧串接）是常态 workflow
  returnLastFrame: true,
  // -1 signals "random per call" to Seedance; users can lock a specific seed
  seed: -1,
  // ARK valid range [3600, 259200]; default 3600 (1hr) for tight feedback.
  executionExpiresAfter: 3600,

  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  assetRefs: [],

  activeTaskIds: [],

  currentTaskId: null,
  currentVideoUrl: null,

  history: [],

  setPrompt: (prompt) => set({ prompt }),
  setRatio: (ratio) => set({ ratio }),
  setDuration: (duration) => set({ duration }),
  setResolution: (resolution) => set({ resolution }),
  setWatermark: (watermark) => set({ watermark }),
  setGenerateAudio: (generateAudio) => set({ generateAudio }),
  setReturnLastFrame: (returnLastFrame) => set({ returnLastFrame }),
  setSeed: (seed) => set({ seed }),
  setExecutionExpiresAfter: (executionExpiresAfter) => set({ executionExpiresAfter }),

  addReferenceImage: (m) =>
    set((s) => {
      const role = m.role ?? defaultRoleForMode(s.mode, s.referenceImages.length);
      return { referenceImages: [...s.referenceImages, { ...m, role }] };
    }),
  removeReferenceImage: (idx) =>
    set((s) => ({
      referenceImages: s.referenceImages.filter((_, i) => i !== idx),
    })),
  updateReferenceImage: (idx, patch) =>
    set((s) => ({
      referenceImages: s.referenceImages.map((m, i) =>
        i === idx ? { ...m, ...patch } : m,
      ),
    })),
  setImageRole: (idx, role) =>
    set((s) => ({
      referenceImages: s.referenceImages.map((m, i) =>
        i === idx ? { ...m, role } : m,
      ),
    })),

  addReferenceVideo: (m) =>
    set((s) => ({ referenceVideos: [...s.referenceVideos, m] })),
  removeReferenceVideo: (idx) =>
    set((s) => ({
      referenceVideos: s.referenceVideos.filter((_, i) => i !== idx),
    })),
  updateReferenceVideo: (idx, patch) =>
    set((s) => ({
      referenceVideos: s.referenceVideos.map((m, i) =>
        i === idx ? { ...m, ...patch } : m,
      ),
    })),

  addReferenceAudio: (m) =>
    set((s) => ({ referenceAudios: [...s.referenceAudios, m] })),
  removeReferenceAudio: (idx) =>
    set((s) => ({
      referenceAudios: s.referenceAudios.filter((_, i) => i !== idx),
    })),
  updateReferenceAudio: (idx, patch) =>
    set((s) => ({
      referenceAudios: s.referenceAudios.map((m, i) =>
        i === idx ? { ...m, ...patch } : m,
      ),
    })),

  addAssetRef: (ref) =>
    set((s) => {
      const newRef: AssetRef = { ...ref };
      if (ref.type === 'image' && !newRef.role) {
        const imageRefIdx = s.assetRefs.filter((r) => r.type === 'image').length;
        newRef.role = defaultRoleForMode(s.mode, s.referenceImages.length + imageRefIdx);
      }
      return { assetRefs: [...s.assetRefs, newRef] };
    }),
  removeAssetRef: (idx) =>
    set((s) => ({ assetRefs: s.assetRefs.filter((_, i) => i !== idx) })),
  updateAssetRef: (idx, patch) =>
    set((s) => ({
      assetRefs: s.assetRefs.map((r, i) => {
        if (i !== idx) return r;
        const next: AssetRef = { ...r, ...patch };
        if (next.type !== 'image') {
          next.role = undefined;
        } else if (!next.role) {
          const imageRefIdx = s.assetRefs
            .slice(0, i)
            .filter((rr) => rr.type === 'image').length;
          next.role = defaultRoleForMode(s.mode, s.referenceImages.length + imageRefIdx);
        }
        return next;
      }),
    })),
  addActiveTask: (taskId) =>
    set((s) => ({ activeTaskIds: [...s.activeTaskIds, taskId] })),
  removeActiveTask: (taskId) =>
    set((s) => ({ activeTaskIds: s.activeTaskIds.filter((id) => id !== taskId) })),

  setCurrentTask: (currentTaskId) => set({ currentTaskId }),
  setCurrentVideoUrl: (currentVideoUrl) => set({ currentVideoUrl }),

  addHistory: (item) =>
    set((s) => ({ history: [item, ...s.history] })),
  updateHistory: (taskId, patch) =>
    set((s) => ({
      history: s.history.map((h) =>
        h.taskId === taskId ? { ...h, ...patch } : h,
      ),
    })),
  clearHistory: () =>
    set((s) => {
      for (const h of s.history) revokeImportedUrls(h);
      return { history: [] };
    }),
  removeHistory: (taskId) =>
    set((s) => {
      const victim = s.history.find((h) => h.taskId === taskId);
      if (victim) revokeImportedUrls(victim);
      return { history: s.history.filter((h) => h.taskId !== taskId) };
    }),

  resetForNewTask: () =>
    set((s) => {
      // Free local preview blob URLs so we don't leak memory.
      const all = [
        ...s.referenceImages,
        ...s.referenceVideos,
        ...s.referenceAudios,
      ];
      for (const m of all) {
        if (m.preview && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          try {
            URL.revokeObjectURL(m.preview);
          } catch {
            // ignore — preview may not be a blob URL in tests
          }
        }
      }
      return {
        prompt: '',
        referenceImages: [],
        referenceVideos: [],
        referenceAudios: [],
        assetRefs: [],
      };
    }),
    }),
    {
      name: 'byteplus-ai-gen-platform-video',
      // sessionStorage = per-tab. Same rationale as authStore: tab refresh
      // restores active tasks + history, but a different user opening the
      // same browser sees a clean slate. Closing the tab also clears.
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      // What to persist: everything serializable. Reference media is
      // flattened to filename stubs because File objects don't survive
      // JSON round-trips and blob: URLs are invalidated on page unload.
      partialize: (state) => ({
        mode: state.mode,
        prompt: state.prompt,
        assetRefs: state.assetRefs,
        activeTaskIds: state.activeTaskIds,
        // Drop imported items from persisted history: their `objectUrl` /
        // `frameObjectUrl` are blob: URLs whose Blobs die on page unload,
        // so rehydrating them would yield broken <video> sources with no
        // recovery path. The user holds the source bundle on disk; they
        // can re-import after reload.
        history: state.history.filter((h) => !h.imported),
        currentTaskId: state.currentTaskId,
        currentVideoUrl: state.currentVideoUrl,
        ratio: state.ratio,
        duration: state.duration,
        resolution: state.resolution,
        watermark: state.watermark,
        generateAudio: state.generateAudio,
        returnLastFrame: state.returnLastFrame,
        seed: state.seed,
        executionExpiresAfter: state.executionExpiresAfter,
        referenceImages: state.referenceImages.map(flattenRef('image')),
        referenceVideos: state.referenceVideos.map(flattenRef('video')),
        referenceAudios: state.referenceAudios.map(flattenRef('audio')),
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<VideoState> & {
          referenceImages?: Array<{ filename: string; type: 'image' }>;
          referenceVideos?: Array<{ filename: string; type: 'video' }>;
          referenceAudios?: Array<{ filename: string; type: 'audio' }>;
        };
        return {
          ...currentState,
          ...p,
          referenceImages: (p.referenceImages ?? []).map(rehydrateStaleRef),
          referenceVideos: (p.referenceVideos ?? []).map(rehydrateStaleRef),
          referenceAudios: (p.referenceAudios ?? []).map(rehydrateStaleRef),
        };
      },
    },
  ),
);

/** 共用组件（VideoHistory / VideoPreview / poller / upload hook）接受的 store 形状。
 *  video25Store 的 state 为 VideoState 超集，可直接传入。 */
export type VideoStoreHook = UseBoundStore<StoreApi<VideoState>>;

// ── Persistence helpers ─────────────────────────────────────

function flattenRef(type: 'image' | 'video' | 'audio') {
  return (m: LocalMedia): { filename: string; type: 'image' | 'video' | 'audio' } => ({
    filename: m.filename ?? m.file?.name ?? 'unknown',
    type,
  });
}

function rehydrateStaleRef(stub: { filename: string }): LocalMedia {
  return {
    preview: '',
    uploading: false,
    filename: stub.filename,
    stale: true,
  };
}
