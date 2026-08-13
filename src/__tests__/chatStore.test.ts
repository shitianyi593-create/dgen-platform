import { describe, it, expect, beforeEach } from 'vitest'
import type { ChatTurn } from '../types/chat'

let _importSeq = 0
const freshStore = () => import('../stores/chatStore?t=' + Date.now() + '_' + ++_importSeq)

function turn(over: Partial<ChatTurn>): ChatTurn {
  return {
    id: 't1', apiMode: 'chat', userText: 'hi',
    assistant: { content: 'hello' }, requestBody: {},
    timing: { requestAt: '2026-07-11T00:00:00Z', totalMs: 100 },
    ...over,
  }
}

describe('chatStore', () => {
  beforeEach(() => sessionStorage.clear())

  it('addTurn / updateTurn', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().addTurn(turn({ id: 'a', pending: true }))
    useChatStore.getState().updateTurn('a', { pending: false, assistant: { content: 'done' } })
    const t = useChatStore.getState().turns[0]
    expect(t.assistant.content).toBe('done')
    expect(t.pending).toBe(false)
  })

  it('有輪次後 setApiMode 無效（模式鎖定）；newConversation 後解鎖', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().setApiMode('responses')
    expect(useChatStore.getState().apiMode).toBe('responses')
    useChatStore.getState().addTurn(turn({ id: 'a', apiMode: 'responses' }))
    useChatStore.getState().setApiMode('chat')
    expect(useChatStore.getState().apiMode).toBe('responses')  // 鎖定
    useChatStore.getState().newConversation()
    expect(useChatStore.getState().turns).toEqual([])
    useChatStore.getState().setApiMode('chat')
    expect(useChatStore.getState().apiMode).toBe('chat')
  })

  it('newConversation 保留參數設定', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().setParam('temperature', '0.5')
    useChatStore.getState().addTurn(turn({ id: 'a' }))
    useChatStore.getState().newConversation()
    expect(useChatStore.getState().params.temperature).toBe('0.5')
  })

  it('lastResponseId：跳過 error 輪、取最後一個有 responseId 的輪', async () => {
    const { useChatStore, lastResponseId } = await freshStore()
    useChatStore.getState().addTurn(turn({ id: 'a', meta: { responseId: 'resp_1' } }))
    useChatStore.getState().addTurn(turn({ id: 'b', meta: { responseId: 'resp_2' } }))
    useChatStore.getState().addTurn(turn({ id: 'c', error: { body: 'x' } }))
    expect(lastResponseId(useChatStore.getState().turns)).toBe('resp_2')
  })

  it('rehydrate：pending 中被重整的輪標記 aborted', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-chat', JSON.stringify({
      version: 1,
      state: {
        apiMode: 'chat',
        turns: [turn({ id: 'a', pending: true, assistant: { content: 'part' } })],
      },
    }))
    const { useChatStore } = await freshStore()
    const t = useChatStore.getState().turns[0]
    expect(t.pending).toBe(false)
    expect(t.aborted).toBe(true)
    expect(useChatStore.getState().isGenerating).toBe(false)
  })

  it('setSystemPrompt / setSystemPromptMode：有輪次後鎖定（no-op）；newConversation 後保留並解鎖', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().setSystemPrompt('你是助理')
    useChatStore.getState().setSystemPromptMode('instructions')
    expect(useChatStore.getState().systemPrompt).toBe('你是助理')
    expect(useChatStore.getState().systemPromptMode).toBe('instructions')
    useChatStore.getState().addTurn(turn({ id: 'a' }))
    // 鎖定：改不動
    useChatStore.getState().setSystemPrompt('改掉')
    useChatStore.getState().setSystemPromptMode('system')
    expect(useChatStore.getState().systemPrompt).toBe('你是助理')
    expect(useChatStore.getState().systemPromptMode).toBe('instructions')
    // newConversation 保留系統提示設定並解鎖
    useChatStore.getState().newConversation()
    expect(useChatStore.getState().systemPrompt).toBe('你是助理')
    expect(useChatStore.getState().systemPromptMode).toBe('instructions')
    useChatStore.getState().setSystemPrompt('新的')
    expect(useChatStore.getState().systemPrompt).toBe('新的')
  })

  it('truncateFromTurn：截斷中間輪只保留較早的輪', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().addTurn(turn({ id: 'a' }))
    useChatStore.getState().addTurn(turn({ id: 'b' }))
    useChatStore.getState().addTurn(turn({ id: 'c' }))
    useChatStore.getState().truncateFromTurn('b')
    expect(useChatStore.getState().turns.map((t: ChatTurn) => t.id)).toEqual(['a'])
  })

  it('truncateFromTurn：截斷首輪清空對話並解鎖模式切換', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().setApiMode('responses')
    useChatStore.getState().addTurn(turn({ id: 'a', apiMode: 'responses' }))
    useChatStore.getState().setApiMode('chat')
    expect(useChatStore.getState().apiMode).toBe('responses')  // 鎖定
    useChatStore.getState().truncateFromTurn('a')
    expect(useChatStore.getState().turns).toEqual([])
    useChatStore.getState().setApiMode('chat')
    expect(useChatStore.getState().apiMode).toBe('chat')       // 解鎖
  })

  it('truncateFromTurn：未知 id 為 no-op', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().addTurn(turn({ id: 'a' }))
    useChatStore.getState().truncateFromTurn('zzz')
    expect(useChatStore.getState().turns.map((t: ChatTurn) => t.id)).toEqual(['a'])
  })

  it('setComposerDraft：草稿讀寫（生成中也可寫）', async () => {
    const { useChatStore } = await freshStore()
    expect(useChatStore.getState().composerDraft).toBe('')
    useChatStore.getState().setComposerDraft('救回的輸入')
    expect(useChatStore.getState().composerDraft).toBe('救回的輸入')
  })

  it('migrate v1→v2：補齊 systemPrompt/systemPromptMode/composerDraft 與 params.serviceTier', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-chat', JSON.stringify({
      version: 1,
      state: {
        apiMode: 'chat',
        params: { temperature: '0.5', topP: '', maxTokens: '', thinkingType: '', reasoningEffort: '', stream: true },
        turns: [],
      },
    }))
    const { useChatStore } = await freshStore()
    const s = useChatStore.getState()
    expect(s.systemPrompt).toBe('')
    expect(s.systemPromptMode).toBe('system')
    expect(s.composerDraft).toBe('')
    expect(s.params.serviceTier).toBe('')
    expect(s.params.temperature).toBe('0.5')  // 既有值保留
  })

  it('isGenerating 不持久化', async () => {
    const { useChatStore } = await freshStore()
    useChatStore.getState().setGenerating(true)
    const persisted = JSON.parse(sessionStorage.getItem('byteplus-ai-gen-platform-chat') ?? '{}') as { state?: Record<string, unknown> }
    expect(persisted.state).not.toHaveProperty('isGenerating')
  })
})
