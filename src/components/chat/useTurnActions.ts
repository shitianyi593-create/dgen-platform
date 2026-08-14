// src/components/chat/useTurnActions.ts
// 「自此轮回溯」动作逻辑（S5）：编辑重送 / 删除 的确认状态与 store 操作。
// 从 MessageBubble 抽出，组件只负责渲染按钮与 ConfirmModal。
import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'

export type TurnConfirmAction = 'edit' | 'delete'

export interface TurnActions {
  /** 此轮与之后共 N 轮（回溯语意的移除数；id 不在 store 时为 0）。 */
  turnsFromHere: number
  /** 目前打开的确认对话框（null = 关闭）。 */
  confirmAction: TurnConfirmAction | null
  setConfirmAction: (a: TurnConfirmAction | null) => void
  /** 确认：edit = 回填该轮 userText 到 composerDraft + 截断；delete = 只截断。 */
  handleConfirm: () => void
}

export function useTurnActions(turnId: string): TurnActions {
  const [confirmAction, setConfirmAction] = useState<TurnConfirmAction | null>(null)
  // 反应式读 store 计算 N，无须经 prop 串接。
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
