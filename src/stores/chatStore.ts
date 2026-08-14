import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ChatApiMode, ChatTurn, GenParams, SystemPromptMode } from '../types/chat'
import { DEFAULT_GEN_PARAMS } from '../types/chat'

/** Responses 模式下一轮要带的 previous_response_id：最后一个非 error 且有 responseId 的轮。 */
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
  /** 系统提示（稳定前缀）。属于 cache prefix / 服务器端串接的一部分。 */
  systemPrompt: string
  /** 系统提示注入方式（仅 Responses 模式有效）。 */
  systemPromptMode: SystemPromptMode
  turns: ChatTurn[]
  isGenerating: boolean
  /** 工具列「全部展开/收起」master 开关。 */
  expandAll: boolean
  /** 输入框草稿（store-backed，供失败轮救回输入）。 */
  composerDraft: string

  /** 对话进行中（turns 非空）锁定 — no-op；「新对话」后才可切换。 */
  setApiMode: (m: ChatApiMode) => void
  setParam: <K extends keyof GenParams>(key: K, value: GenParams[K]) => void
  /** 对话进行中锁定 — no-op（系统提示是 cache prefix / 服务器端串接的一部分）。 */
  setSystemPrompt: (text: string) => void
  setSystemPromptMode: (m: SystemPromptMode) => void
  setComposerDraft: (text: string) => void
  addTurn: (t: ChatTurn) => void
  updateTurn: (id: string, patch: Partial<ChatTurn>) => void
  /** 自此轮回溯：移除指定轮与其后所有轮（找不到 id 则 no-op）。清空后模式切换自动解锁。 */
  truncateFromTurn: (id: string) => void
  setGenerating: (v: boolean) => void
  toggleExpandAll: () => void
  /** 清空对话（保留参数、apiMode、系统提示设置），解锁模式切换。 */
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
        // isGenerating 是暂态，不持久化
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<ChatState>
        return {
          ...currentState,
          ...p,
          // 刷新时生成中的轮：流式已断，标记为中止（保留已收到的部分内容）。
          turns: (p.turns ?? []).map((t) =>
            t.pending ? { ...t, pending: false, aborted: true } : t,
          ),
          isGenerating: false,
        }
      },
    },
  ),
)
