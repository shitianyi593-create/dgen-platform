// src/components/chat/MessageList.tsx
// 訊息卷軸區。新訊息 / 串流累積時自動捲到底（使用者已捲離底部時不打擾）。
import { useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import { useChatStore } from '../../stores/chatStore'

interface Props {
  onResendLast: () => void
}

export default function MessageList({ onResendLast }: Props) {
  const turns = useChatStore((s) => s.turns)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const expandAll = useChatStore((s) => s.expandAll)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const empty = turns.length === 0

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      style={{ flex: 1, overflowY: 'auto' }}
    >
      <div
        style={{
          maxWidth: 780, margin: '0 auto', padding: '24px 24px 8px', minHeight: '100%',
          display: empty ? 'flex' : 'block',
          flexDirection: 'column', justifyContent: 'center',
        }}
      >
        {empty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>開始對話以測試模型</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.6 }}>
              每輪回應附完整 debug 資訊，點訊息下方膠囊可展開 token、延遲與 raw payload。
            </div>
          </div>
        ) : (
          turns.map((t, i) => (
            <MessageBubble
              key={t.id}
              turn={t}
              isLast={i === turns.length - 1}
              expandAll={expandAll}
              onResend={onResendLast}
              resendDisabled={isGenerating}
            />
          ))
        )}
      </div>
    </div>
  )
}
