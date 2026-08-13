import { useEffect, useState, type ReactNode } from 'react'

export type ConfirmVariant = 'danger' | 'accent' | 'default'

export interface ThumbItem {
  label: string
  kind: 'image' | 'video' | 'audio'
  preview?: string
}

export interface ConfirmModalProps {
  open: boolean
  title: string
  subtitle?: string
  thumbs?: ThumbItem[]
  body?: ReactNode
  meta?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  variant: ConfirmVariant
  typedConfirmation?: {
    requiredText: string
    placeholder?: string
  }
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal(props: ConfirmModalProps) {
  const {
    open, title, subtitle, thumbs, body, meta,
    confirmLabel, cancelLabel = '取消', variant,
    typedConfirmation, onConfirm, onCancel,
  } = props

  const [typedValue, setTypedValue] = useState('')

  const handleCancel = () => {
    setTypedValue('')
    onCancel()
  }
  const handleConfirm = () => {
    setTypedValue('')
    onConfirm()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTypedValue('')
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const confirmDisabled = typedConfirmation
    ? typedValue.trim() !== typedConfirmation.requiredText
    : false

  const confirmBg = variant === 'danger' ? 'var(--danger)'
    : variant === 'accent' ? 'var(--accent)'
    : 'var(--bg-input)'
  const confirmColor = variant === 'default' ? 'var(--text-primary)' : '#fff'

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(10, 12, 16, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 18,
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          color: 'var(--text-primary)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            {subtitle}
          </div>
        )}

        {thumbs && thumbs.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {thumbs.map((t, i) => (
              <div key={i}
                style={{
                  width: 40, height: 40,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 10, color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                {t.preview
                  ? <img src={t.preview} alt={t.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : t.label}
              </div>
            ))}
          </div>
        )}

        {body && <div style={{ marginBottom: 12 }}>{body}</div>}

        {meta && (
          <div style={{
            padding: '6px 10px',
            background: 'rgba(37,99,235,0.06)',
            borderLeft: '2px solid var(--accent)',
            borderRadius: '0 4px 4px 0',
            fontSize: 11,
            color: 'var(--text-muted)',
            marginBottom: 12,
            lineHeight: 1.5,
          }}>
            {meta}
          </div>
        )}

        {typedConfirmation && (
          <input
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            placeholder={typedConfirmation.placeholder}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 13,
              marginBottom: 12,
            }}
          />
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            aria-label={confirmLabel}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: 'none',
              background: confirmBg,
              color: confirmColor,
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: 13,
              opacity: confirmDisabled ? 0.5 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
