import type { CSSProperties } from 'react'

/**
 * 统一状态胶囊（handoff 全站共用改动 §2）。
 * kind → 语意 token 对照；running 带 spinner 取代旧的文字 `●`。
 * 各页自行把状态映射到 kind：
 *   完成 / Active → success；处理中 / running / 生成中 → running；
 *   失败 → danger；已过期 → warning；排隊中 / 已取消 → muted。
 */
export type StatusPillKind = 'success' | 'running' | 'danger' | 'warning' | 'muted'

const KIND_STYLE: Record<StatusPillKind, { bg: string; bd: string; fg: string }> = {
  success: { bg: 'var(--success-bg)', bd: 'var(--success-bd)', fg: 'var(--success)' },
  running: { bg: 'var(--accent-bg)', bd: 'var(--accent-bd)', fg: 'var(--accent)' },
  danger: { bg: 'var(--danger-bg)', bd: 'var(--danger-bd)', fg: 'var(--danger)' },
  warning: { bg: 'var(--warning-bg)', bd: 'var(--warning-bd)', fg: 'var(--warning)' },
  muted: { bg: 'var(--pend-bg)', bd: 'var(--pend-bd)', fg: 'var(--text-muted)' },
}

interface StatusPillProps {
  kind: StatusPillKind
  label: string
  testId?: string
}

export default function StatusPill({ kind, label, testId }: StatusPillProps) {
  const c = KIND_STYLE[kind]
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
    background: c.bg,
    border: `1px solid ${c.bd}`,
    color: c.fg,
  }
  return (
    <span data-testid={testId} style={style}>
      {kind === 'running' && (
        <span
          className="spinner"
          style={{ width: 10, height: 10, borderWidth: 1.5, borderTopColor: 'currentcolor' }}
        />
      )}
      {label}
    </span>
  )
}
