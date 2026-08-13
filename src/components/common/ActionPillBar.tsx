import type { ReactNode } from 'react'
import { Icon } from './icons'

export interface PillAction {
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
}

export interface ActionPillBarProps {
  show: boolean
  badge: ReactNode
  actions: PillAction[]
}

export default function ActionPillBar({ show, badge, actions }: ActionPillBarProps) {
  if (!show) return null

  return (
    <div
      role="toolbar"
      style={{
        position: 'fixed',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: 4,
        boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
        fontSize: 12,
        color: 'var(--text-primary)',
        zIndex: 900,
      }}
    >
      <div style={{
        padding: '6px 14px',
        borderRight: '1px solid var(--border)',
      }}>
        {badge}
      </div>
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          data-variant={a.variant ?? 'default'}
          onClick={a.onClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            background: a.variant === 'danger' ? 'var(--danger)' : 'transparent',
            border: 'none',
            borderRadius: 999,
            color: a.variant === 'danger' ? '#fff' : 'var(--text-muted)',
            cursor: 'pointer',
            fontWeight: a.variant === 'danger' ? 600 : 400,
            fontSize: 12,
            whiteSpace: 'nowrap',
          }}
        >
          {a.variant === 'danger' && <Icon name="trash" size={12} />}
          {a.label}
        </button>
      ))}
    </div>
  )
}
