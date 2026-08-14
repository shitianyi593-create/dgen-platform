// src/components/chat/MessageList.tsx
// 消息卷轴区。新消息 / 流式累積时自动滚到底（用户已滚离底部时不打扰）。
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
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>开始对话以测试模型</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.6 }}>
              每轮响应附完整 debug 信息，点消息下方胶囊可展开 token、延迟与 raw payload。
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
