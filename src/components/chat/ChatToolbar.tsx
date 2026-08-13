// src/components/chat/ChatToolbar.tsx
// 對話層級資訊列：上下文長度、累計 token、cache 命中率（單行 inline）+ 動作按鈕。
import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import { computeChatTotals } from '../../utils/chatStats'
import { buildChatExport, downloadChatExport } from '../../utils/chatExport'
import ConfirmModal from '../common/ConfirmModal'

function Stat({ label, value, title, valueColor }: { label: string; value: string; title?: string; valueColor?: string }) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  )
}

function Sep() {
  return <span style={{ color: 'var(--border)', fontSize: 12 }}>|</span>
}

const btnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-primary)', fontSize: 12, padding: '4px 10px', cursor: 'pointer',
  whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6,
}

export default function ChatToolbar() {
  const turns = useChatStore((s) => s.turns)
  const apiMode = useChatStore((s) => s.apiMode)
  const params = useChatStore((s) => s.params)
  const systemPrompt = useChatStore((s) => s.systemPrompt)
  const systemPromptMode = useChatStore((s) => s.systemPromptMode)
  const expandAll = useChatStore((s) => s.expandAll)
  const toggleExpandAll = useChatStore((s) => s.toggleExpandAll)
  const newConversation = useChatStore((s) => s.newConversation)
  const textEndpoint = useAuthStore((s) => s.textEndpoint)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const totals = computeChatTotals(turns)
  const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString())

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', minHeight: 40,
      borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0, flexWrap: 'wrap',
    }}>
      <Stat label="上下文" value={fmt(totals.currentContextTokens)} title="最近一次請求的 prompt_tokens = 模型實際看到的 context 大小" />
      <Sep />
      <Stat label="累計" value={fmt(totals.totalTokens)} title="所有輪 total_tokens 加總" />
      <Sep />
      <Stat
        label="快取命中"
        value={totals.cacheHitRate == null ? '—' : `${(totals.cacheHitRate * 100).toFixed(1)}%`}
        valueColor="var(--success)"
        title={`Σcached_tokens ${fmt(totals.cachedTokens)} ÷ Σprompt_tokens ${fmt(totals.promptTokens)}`}
      />
      <Sep />
      <Stat label="輪數" value={String(totals.turns)} />

      <div style={{ flex: 1 }} />

      <button style={btnStyle} onClick={toggleExpandAll}>
        {expandAll ? '全部收合' : '全部展開'} debug
      </button>
      <button
        style={{ ...btnStyle, opacity: turns.length === 0 ? 0.5 : 1 }}
        disabled={turns.length === 0}
        onClick={() => downloadChatExport(buildChatExport({ apiMode, endpoint: textEndpoint, params, systemPrompt, systemPromptMode, turns }))}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
        下載 JSON
      </button>
      <button className="btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setConfirmOpen(true)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新對話
      </button>

      <ConfirmModal
        open={confirmOpen}
        title="開始新對話？"
        subtitle="目前對話內容與 debug 資訊將被清空（可先下載 JSON 保存）。參數設定會保留。"
        confirmLabel="清空"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => { newConversation(); setConfirmOpen(false) }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
