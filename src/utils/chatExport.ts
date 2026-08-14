// src/utils/chatExport.ts
// 一键下载对话 debug JSON。纯前端 Blob 下载，无 server 参与。
import type { ChatApiMode, ChatTurn, GenParams, SystemPromptMode } from '../types/chat'
import { computeChatTotals, type ChatTotals } from './chatStats'

export interface ChatExportBundle {
  exportedAt: string
  apiMode: ChatApiMode
  /** ep ID（非机密）。API key 绝不进 bundle。 */
  endpoint: string
  params: GenParams
  systemPrompt: string
  systemPromptMode: SystemPromptMode
  turns: ChatTurn[]
  totals: ChatTotals
}

export function buildChatExport(args: {
  apiMode: ChatApiMode
  endpoint: string
  params: GenParams
  systemPrompt: string
  systemPromptMode: SystemPromptMode
  turns: ChatTurn[]
  /** 测试可注入；默认取现在时间。 */
  exportedAt?: string
}): ChatExportBundle {
  return {
    exportedAt: args.exportedAt ?? new Date().toISOString(),
    apiMode: args.apiMode,
    endpoint: args.endpoint,
    params: args.params,
    systemPrompt: args.systemPrompt,
    systemPromptMode: args.systemPromptMode,
    turns: args.turns,
    totals: computeChatTotals(args.turns),
  }
}

export function downloadChatExport(bundle: ChatExportBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chat-debug-${bundle.exportedAt.replace(/[:.]/g, '-')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
