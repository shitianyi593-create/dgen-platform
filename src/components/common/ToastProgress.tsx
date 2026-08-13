export interface ToastProgressProps {
  kind: 'upload' | 'delete' | 'generic'
  title: string
  current: number
  total: number
  status: 'running' | 'success' | 'error'
  subtitle?: string
  errorAction?: { label: string; onClick: () => void }
  onDismiss?: () => void
}

export default function ToastProgress(props: ToastProgressProps) {
  const { title, current, total, status, subtitle, errorAction, onDismiss } = props

  const pct = total === 0 ? 0 : Math.min(1, current / total)
  const progressColor =
    status === 'error'
      ? 'var(--danger)'
      : status === 'success'
        ? 'var(--success)'
        : 'var(--accent)'

  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        color: 'var(--text-primary)',
        fontSize: 12,
        width: 240,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {status === 'running' ? (
          <span
            data-testid="toast-status-icon"
            data-status="running"
            className="spinner"
            style={{ width: 12, height: 12 }}
          />
        ) : status === 'success' ? (
          <span
            data-testid="toast-status-icon"
            data-status="success"
            style={{
              color: 'var(--success)',
              fontWeight: 700,
              fontSize: 11,
              width: 12,
              height: 12,
              display: 'inline-block',
              textAlign: 'center',
              lineHeight: '12px',
            }}
          >
            ✓
          </span>
        ) : (
          <span
            data-testid="toast-status-icon"
            data-status="error"
            style={{
              color: 'var(--danger)',
              fontWeight: 700,
              fontSize: 11,
              width: 12,
              height: 12,
              display: 'inline-block',
              textAlign: 'center',
              lineHeight: '12px',
            }}
          >
            !
          </span>
        )}
        <span style={{ fontWeight: 600, flex: 1 }}>{title}</span>
        {onDismiss && (
          <button
            type="button"
            aria-label="dismiss"
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ×
          </button>
        )}
      </div>
      {subtitle && (
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 11,
            marginTop: 2,
            marginBottom: 4,
          }}
        >
          {subtitle}
        </div>
      )}
      {status === 'running' && (
        <>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 5 }}>
            {current} / {total}
          </div>
          <div
            style={{
              width: '100%',
              height: 3,
              background: 'var(--border)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct * 100}%`,
                height: '100%',
                background: progressColor,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        </>
      )}
      {status === 'error' && errorAction && (
        <button
          type="button"
          aria-label={errorAction.label}
          onClick={errorAction.onClick}
          style={{
            marginTop: 4,
            padding: 0,
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: 11,
            textDecoration: 'underline',
            fontWeight: 600,
          }}
        >
          {errorAction.label}
          <span aria-hidden="true"> →</span>
        </button>
      )}
    </div>
  )
}
