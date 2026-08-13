// src/components/chat/useTurnActions.ts
// 「自此輪回溯」動作邏輯（S5）：編輯重送 / 刪除 的確認狀態與 store 操作。
// 從 MessageBubble 抽出，元件只負責渲染按鈕與 ConfirmModal。
import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'

export type TurnConfirmAction = 'edit' | 'delete'

export interface TurnActions {
  /** 此輪與之後共 N 輪（回溯語意的移除數；id 不在 store 時為 0）。 */
  turnsFromHere: number
  /** 目前開啟的確認對話框（null = 關閉）。 */
  confirmAction: TurnConfirmAction | null
  setConfirmAction: (a: TurnConfirmAction | null) => void
  /** 確認：edit = 回填該輪 userText 到 composerDraft + 截斷；delete = 只截斷。 */
  handleConfirm: () => void
}

export function useTurnActions(turnId: string): TurnActions {
  const [confirmAction, setConfirmAction] = useState<TurnConfirmAction | null>(null)
  // 反應式讀 store 計算 N，無須經 prop 串接。
  const turnsFromHere = useChatStore((s) => {
    const i = s.turns.findIndex((t) => t.id === turnId)
    return i === -1 ? 0 : s.turns.length - i
  })

  const handleConfirm = () => {
    const { turns, setComposerDraft, truncateFromTurn } = useChatStore.getState()
    if (confirmAction === 'edit') {
      const t = turns.find((t) => t.id === turnId)
      if (t) setComposerDraft(t.userText)
    }
    truncateFromTurn(turnId)
    setConfirmAction(null)
  }

  return { turnsFromHere, confirmAction, setConfirmAction, handleConfirm }
}
