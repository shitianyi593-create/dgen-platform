import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ChatApiMode, ChatTurn, GenParams, SystemPromptMode } from '../types/chat'
import { DEFAULT_GEN_PARAMS } from '../types/chat'

/** Responses 模式下一輪要帶的 previous_response_id：最後一個非 error 且有 responseId 的輪。 */
export function lastResponseId(turns: ChatTurn[]): string | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (!t.error && t.meta?.responseId) return t.meta.responseId
  }
  return undefined
}

interface ChatState {
  apiMode: ChatApiMode
  params: GenParams
  /** 系統提示（穩定前綴）。屬於 cache prefix / 伺服器端串接的一部分。 */
  systemPrompt: string
  /** 系統提示注入方式（僅 Responses 模式有效）。 */
  systemPromptMode: SystemPromptMode
  turns: ChatTurn[]
  isGenerating: boolean
  /** 工具列「全部展開/收合」master 開關。 */
  expandAll: boolean
  /** 輸入框草稿（store-backed，供失敗輪救回輸入）。 */
  composerDraft: string

  /** 對話進行中（turns 非空）鎖定 — no-op；「新對話」後才可切換。 */
  setApiMode: (m: ChatApiMode) => void
  setParam: <K extends keyof GenParams>(key: K, value: GenParams[K]) => void
  /** 對話進行中鎖定 — no-op（系統提示是 cache prefix / 伺服器端串接的一部分）。 */
  setSystemPrompt: (text: string) => void
  setSystemPromptMode: (m: SystemPromptMode) => void
  setComposerDraft: (text: string) => void
  addTurn: (t: ChatTurn) => void
  updateTurn: (id: string, patch: Partial<ChatTurn>) => void
  /** 自此輪回溯：移除指定輪與其後所有輪（找不到 id 則 no-op）。清空後模式切換自動解鎖。 */
  truncateFromTurn: (id: string) => void
  setGenerating: (v: boolean) => void
  toggleExpandAll: () => void
  /** 清空對話（保留參數、apiMode、系統提示設定），解鎖模式切換。 */
  newConversation: () => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      apiMode: 'chat',
      params: { ...DEFAULT_GEN_PARAMS },
      systemPrompt: '',
      systemPromptMode: 'system',
      turns: [],
      isGenerating: false,
      expandAll: false,
      composerDraft: '',

      setApiMode: (m) => set((s) => (s.turns.length > 0 ? {} : { apiMode: m })),
      setParam: (key, value) =>
        set((s) => ({ params: { ...s.params, [key]: value } })),
      setSystemPrompt: (text) => set((s) => (s.turns.length > 0 ? {} : { systemPrompt: text })),
      setSystemPromptMode: (m) => set((s) => (s.turns.length > 0 ? {} : { systemPromptMode: m })),
      setComposerDraft: (composerDraft) => set({ composerDraft }),
      addTurn: (t) => set((s) => ({ turns: [...s.turns, t] })),
      updateTurn: (id, patch) =>
        set((s) => ({
          turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      truncateFromTurn: (id) =>
        set((s) => {
          const i = s.turns.findIndex((t) => t.id === id)
          return i === -1 ? {} : { turns: s.turns.slice(0, i) }
        }),
      setGenerating: (isGenerating) => set({ isGenerating }),
      toggleExpandAll: () => set((s) => ({ expandAll: !s.expandAll })),
      newConversation: () => set({ turns: [], isGenerating: false }),
    }),
    {
      name: 'byteplus-ai-gen-platform-chat',
      // sessionStorage = per-tab，同 authStore / videoStore / imageStore 的理由。
      storage: createJSONStorage(() => sessionStorage),
      version: 2,
      migrate: (persisted, fromVersion) => {
        const s = persisted as Partial<ChatState>
        if (fromVersion < 2) {
          s.systemPrompt = ''
          s.systemPromptMode = 'system'
          s.params = { ...DEFAULT_GEN_PARAMS, ...s.params }
          s.composerDraft = ''
        }
        return s as ChatState
      },
      partialize: (s) => ({
        apiMode: s.apiMode,
        params: s.params,
        systemPrompt: s.systemPrompt,
        systemPromptMode: s.systemPromptMode,
        turns: s.turns,
        expandAll: s.expandAll,
        composerDraft: s.composerDraft,
        // isGenerating 是暫態，不持久化
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<ChatState>
        return {
          ...currentState,
          ...p,
          // 重整時生成中的輪：串流已斷，標記為中止（保留已收到的部分內容）。
          turns: (p.turns ?? []).map((t) =>
            t.pending ? { ...t, pending: false, aborted: true } : t,
          ),
          isGenerating: false,
        }
      },
    },
  ),
)
