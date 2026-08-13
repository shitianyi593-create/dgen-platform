// src/components/video25/PromptOptimizeModal.tsx
// 提示詞優化預覽 Modal（spec §6.3）。樣式比照 ConfirmModal。
import { useEffect, useId, useState } from 'react'
import type { Sd25TaskType } from '../../utils/sd25PromptOptimizer'

const TASK_TYPE_LABEL: Record<Sd25TaskType, string> = {
  t2v: '文生影片',
  reference: '參考生影片',
  edit: '影片編輯',
  extend: '影片延長',
  frames: '首尾幀生成',
  unknown: '未能判定',
}

export interface PromptOptimizeModalProps {
  open: boolean
  loading: boolean
  error?: string
  taskType: Sd25TaskType
  originalPrompt: string
  optimizedPrompt: string
  /** describeParamFixes 產出的修正說明；null = 無修正。 */
  fixNote: string | null
  onConfirm: (finalPrompt: string) => void
  onUseOriginal: () => void
  /**
   * 放棄本次優化（取消鍵 / Escape / 點擊遮罩）。
   * 注意：loading 為 true 時也可能觸發（loading 態同時提供取消鍵與 Escape），
   * 呼叫端須 abort 進行中的 optimizePrompt 請求，
   * 否則回應抵達後會把已關閉的 Modal 再打開。
   */
  onCancel: () => void
  onRetry: () => void
}

export default function PromptOptimizeModal(props: PromptOptimizeModalProps) {
  const {
    open, loading, error, taskType, originalPrompt, optimizedPrompt,
    fixNote, onConfirm, onUseOriginal, onCancel, onRetry,
  } = props

  const uid = useId()
  const titleId = `${uid}-title`
  const textareaId = `${uid}-optimized-prompt`

  const [text, setText] = useState(optimizedPrompt)
  const [showOriginal, setShowOriginal] = useState(false)

  // 每次開啟、以及優化結果抵達 / 重試成功時，重設編輯區內容與原文對照。
  // 關閉時元件僅 return null 而未卸載，若只依賴 optimizedPrompt，
  // 同一結果再次開啟會殘留上一輪已放棄的手動編輯（被誤當成本次結果送出）。
  // 採 render 期間比對前次 props 的官方寫法（react.dev「You Might Not Need an
  // Effect」）而非 useEffect：無多餘 commit，也不觸發 set-state-in-effect lint。
  const [syncedProps, setSyncedProps] = useState({ open, optimizedPrompt })
  if (syncedProps.open !== open || syncedProps.optimizedPrompt !== optimizedPrompt) {
    setSyncedProps({ open, optimizedPrompt })
    if (open) {
      setText(optimizedPrompt)
      setShowOriginal(false)
    }
  }

  useEffect(() => {
    if (!open) return
    // 刻意不受 loading 影響：loading 態同樣要能退出（另有取消鍵供滑鼠使用者）。
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const btnBase = {
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  } as const

  const confirmDisabled = !text.trim()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(10, 12, 16, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          width: 'min(560px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 18,
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          color: 'var(--text-primary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span id={titleId} style={{ fontSize: 16, fontWeight: 600 }}>提示詞優化結果</span>
          {!loading && !error && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 999,
              background: 'var(--bg-input)', color: 'var(--accent)',
              border: '1px solid var(--accent)',
            }}>
              {TASK_TYPE_LABEL[taskType]}
            </span>
          )}
        </div>

        {/* error 先於 loading：{loading:true, error:'…'} 若先判 loading，
            會顯示永久 spinner 並吞掉錯誤。錯誤永遠比 spinner 更可行動。 */}
        {error ? (
          <>
            <div role="alert" style={{
              margin: '12px 0', padding: '10px 12px', borderRadius: 6,
              background: 'rgba(248, 81, 73, 0.12)',
              border: '1px solid rgba(248, 81, 73, 0.4)',
              color: '#fca5a5', fontSize: 12, wordBreak: 'break-word',
            }}>
              優化失敗：{error}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onCancel}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}>
                取消
              </button>
              <button type="button" onClick={onUseOriginal}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                用原文生成
              </button>
              <button type="button" onClick={onRetry}
                style={{ ...btnBase, flex: 1, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600 }}>
                重試
              </button>
            </div>
          </>
        ) : loading ? (
          <>
            <div role="status" style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <span className="spinner" style={{ width: 24, height: 24, display: 'inline-block', marginBottom: 12 }} />
              <div>正在優化提示詞…</div>
            </div>
            {/* 遮罩點擊在 loading 時被擋下，若此處不給按鈕，
                純滑鼠使用者遇到卡住的 LLM 呼叫將完全無法離開。 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onCancel}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              可直接編輯後送出；「用原文生成」則忽略優化結果。
            </div>

            <label htmlFor={textareaId} className="sr-only">優化後提示詞</label>
            <textarea
              id={textareaId}
              className="input-field"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              style={{ width: '100%', resize: 'vertical', minHeight: 160, marginBottom: 10 }}
            />

            {fixNote && (
              <div style={{
                padding: '6px 10px', marginBottom: 10,
                background: 'rgba(37,99,235,0.06)',
                borderLeft: '2px solid var(--accent)',
                borderRadius: '0 4px 4px 0',
                fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
              }}>
                {fixNote}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              aria-expanded={showOriginal}
              style={{
                background: 'none', border: 'none', color: 'var(--accent)',
                cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 8,
              }}
            >
              {showOriginal ? '隱藏原文' : '對照原文'}
            </button>
            {showOriginal && (
              <div style={{
                padding: '8px 10px', marginBottom: 10, borderRadius: 6,
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
              }}>
                {originalPrompt}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onCancel}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}>
                取消
              </button>
              <button type="button" onClick={onUseOriginal}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                用原文生成
              </button>
              <button type="button" onClick={() => onConfirm(text)}
                disabled={confirmDisabled}
                style={{
                  ...btnBase, flex: 1, border: 'none', background: 'var(--accent)',
                  color: '#fff', fontWeight: 600,
                  cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                  opacity: confirmDisabled ? 0.5 : 1,
                }}>
                確認生成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
