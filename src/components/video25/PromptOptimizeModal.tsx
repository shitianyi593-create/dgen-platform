// src/components/video25/PromptOptimizeModal.tsx
// 提示词优化预览 Modal（spec §6.3）。样式比照 ConfirmModal。
import { useEffect, useId, useState } from 'react'
import type { Sd25TaskType } from '../../utils/sd25PromptOptimizer'
import { useOptionalI18n } from '../../i18n/useOptionalI18n'
import type { MessageKey } from '../../i18n/locales'

const TASK_TYPE_LABEL_KEY: Record<Sd25TaskType, MessageKey> = {
  t2v: 'video25.taskType.t2v',
  reference: 'video25.taskType.reference',
  edit: 'video25.taskType.edit',
  extend: 'video25.taskType.extend',
  frames: 'video25.taskType.frames',
  unknown: 'video25.taskType.unknown',
}

export interface PromptOptimizeModalProps {
  open: boolean
  loading: boolean
  error?: string
  taskType: Sd25TaskType
  originalPrompt: string
  optimizedPrompt: string
  /** describeParamFixes 产出的修正说明；null = 无修正。 */
  fixNote: string | null
  onConfirm: (finalPrompt: string) => void
  onUseOriginal: () => void
  /**
   * 放弃本次优化（取消键 / Escape / 点击遮罩）。
   * 注意：loading 为 true 时也可能触发（loading 态同时提供取消键与 Escape），
   * 呼叫端须 abort 进行中的 optimizePrompt 请求，
   * 否则响应抵达后会把已关闭的 Modal 再打开。
   */
  onCancel: () => void
  onRetry: () => void
}

export default function PromptOptimizeModal(props: PromptOptimizeModalProps) {
  const { t } = useOptionalI18n()
  const {
    open, loading, error, taskType, originalPrompt, optimizedPrompt,
    fixNote, onConfirm, onUseOriginal, onCancel, onRetry,
  } = props

  const uid = useId()
  const titleId = `${uid}-title`
  const textareaId = `${uid}-optimized-prompt`

  const [text, setText] = useState(optimizedPrompt)
  const [showOriginal, setShowOriginal] = useState(false)

  // 每次打开、以及优化结果抵达 / 重试成功时，重设编辑区内容与原文对照。
  // 关闭时组件仅 return null 而未卸载，若只依赖 optimizedPrompt，
  // 同一结果再次打开会残留上一轮已放弃的手动编辑（被误当成本次结果送出）。
  // 采 render 期间比对前次 props 的官方写法（react.dev「You Might Not Need an
  // Effect」）而非 useEffect：无多余 commit，也不触发 set-state-in-effect lint。
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
    // 刻意不受 loading 影响：loading 态同样要能退出（另有取消键供鼠标用户）。
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
          <span id={titleId} style={{ fontSize: 16, fontWeight: 600 }}>{t('video25.optimize.title')}</span>
          {!loading && !error && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 999,
              background: 'var(--bg-input)', color: 'var(--accent)',
              border: '1px solid var(--accent)',
            }}>
              {t(TASK_TYPE_LABEL_KEY[taskType])}
            </span>
          )}
        </div>

        {/* error 先于 loading：{loading:true, error:'…'} 若先判 loading，
            会显示永久 spinner 并吞掉错误。错误永远比 spinner 更可行动。 */}
        {error ? (
          <>
            <div role="alert" style={{
              margin: '12px 0', padding: '10px 12px', borderRadius: 6,
              background: 'rgba(248, 81, 73, 0.12)',
              border: '1px solid rgba(248, 81, 73, 0.4)',
              color: '#fca5a5', fontSize: 12, wordBreak: 'break-word',
            }}>
              {t('video25.optimize.failed', { message: error })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onCancel}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}>
                {t('common.cancel')}
              </button>
              <button type="button" onClick={onUseOriginal}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                {t('video25.optimize.useOriginal')}
              </button>
              <button type="button" onClick={onRetry}
                style={{ ...btnBase, flex: 1, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600 }}>
                {t('common.retry')}
              </button>
            </div>
          </>
        ) : loading ? (
          <>
            <div role="status" style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <span className="spinner" style={{ width: 24, height: 24, display: 'inline-block', marginBottom: 12 }} />
              <div>{t('video25.optimize.optimizing')}</div>
            </div>
            {/* 遮罩点击在 loading 时被挡下，若此处不给按钮，
                纯鼠标用户遇到卡住的 LLM 呼叫将完全无法离开。 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onCancel}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {t('video25.optimize.description')}
            </div>

            <label htmlFor={textareaId} className="sr-only">{t('video25.optimize.optimizedPrompt')}</label>
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
              {showOriginal ? t('video25.optimize.hideOriginal') : t('video25.optimize.compareOriginal')}
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
                {t('common.cancel')}
              </button>
              <button type="button" onClick={onUseOriginal}
                style={{ ...btnBase, flex: 1, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                {t('video25.optimize.useOriginal')}
              </button>
              <button type="button" onClick={() => onConfirm(text)}
                disabled={confirmDisabled}
                style={{
                  ...btnBase, flex: 1, border: 'none', background: 'var(--accent)',
                  color: '#fff', fontWeight: 600,
                  cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                  opacity: confirmDisabled ? 0.5 : 1,
                }}>
                {t('video25.optimize.confirmGenerate')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
