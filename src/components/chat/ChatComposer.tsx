// src/components/chat/ChatComposer.tsx
// 輸入框：Enter 送出、Shift+Enter 換行；生成中顯示中止鈕。
// 憑證未齊備時（缺 API 金鑰 / 文字接入點）於輸入卡片上方顯示引導提示，
// 附「開啟憑證設定」一鍵開抽屜，並禁用送出鈕（比照影片/圖片頁）。
import { useLayoutEffect, useRef } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import { computeCredsBlockReason } from '../../hooks/useChatGeneration'
import { useCredentialsUiStore } from '../credentials/uiStore'

interface Props {
  onSend: (text: string) => void
  onStop: () => void
}

export default function ChatComposer({ onSend, onStop }: Props) {
  // store-backed 草稿：失敗輪可把送失敗的輸入救回這裡。
  const text = useChatStore((s) => s.composerDraft)
  const setText = useChatStore((s) => s.setComposerDraft)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const apiKey = useAuthStore((s) => s.apiKey)
  const textEndpoint = useAuthStore((s) => s.textEndpoint)
  const credsBlockReason = computeCredsBlockReason(apiKey, textEndpoint)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自動長高：以「值」驅動而非輸入事件，程式化改動（送出清空、編輯重送回填、
  // 帶草稿掛載）也會同步高度。useLayoutEffect 避免 paint 前的高度跳動。
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || isGenerating || credsBlockReason) return
    onSend(trimmed)
    setText('')
  }

  const canSend = text.trim().length > 0 && credsBlockReason === null

  return (
    <div style={{ maxWidth: 780, width: '100%', margin: '0 auto', padding: '12px 24px 16px', flexShrink: 0 }}>
      {credsBlockReason && (
        <div
          className="hint"
          style={{ color: 'var(--warning)', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}
        >
          {credsBlockReason}
          <button
            type="button"
            onClick={() => useCredentialsUiStore.getState().openDrawer('inference')}
            style={{
              padding: '2px 8px', background: 'transparent', cursor: 'pointer',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--accent)', fontSize: 12,
            }}
          >
            開啟憑證設定
          </button>
        </div>
      )}
      {/* 一體式輸入卡片：textarea 自動長高，送出/中止鈕嵌入右下 */}
      <div className="chat-composer-card">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="輸入訊息測試模型…"
          rows={2}
          style={{
            width: '100%', background: 'transparent', border: 'none', outline: 'none',
            resize: 'none', color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.5,
            minHeight: 48, maxHeight: 240, fontFamily: 'inherit', display: 'block',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Enter 送出 · Shift+Enter 換行
          </span>
          {isGenerating ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="中止"
              title="中止生成"
              style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
                border: '1px solid var(--danger)', background: 'rgba(248,81,73,0.12)',
                color: 'var(--danger)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="送出"
              title="送出（Enter）"
              style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                display: 'grid', placeItems: 'center',
                cursor: canSend ? 'pointer' : 'not-allowed',
                border: 'none', color: '#fff',
                background: canSend ? 'var(--accent)' : 'var(--border)',
                transition: 'background 0.2s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
