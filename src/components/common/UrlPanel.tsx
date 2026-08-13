import { Icon } from './icons'
import { copyWithToast } from '../../utils/clipboard'

/**
 * 共用 URL 面板（handoff 共用新元件）。
 * 取代 VideoPreview 的 UrlRow 與 ImagePreview 的 inline 版本：
 * 每列 label + readonly mono URL 框 + 複製鈕（± 開啟連結），底部可附 hint。
 */
export interface UrlPanelRow {
  label: string
  url: string
  /** 落在列容器 data-testid（沿用 video-url-row / last-frame-url-row 等既有 testid）。 */
  testId?: string
  /** true 時多渲染一顆「開啟」連結（target _blank）。 */
  openable?: boolean
}

interface UrlPanelProps {
  rows: UrlPanelRow[]
  hint?: string
}

export default function UrlPanel({ rows, hint }: UrlPanelProps) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {rows.map((row) => (
        <div
          key={`${row.label}:${row.url}`}
          data-testid={row.testId}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span
            style={{
              width: 64,
              flexShrink: 0,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}
          >
            {row.label}
          </span>
          <input
            readOnly
            value={row.url}
            aria-label={row.label}
            onClick={(e) => e.currentTarget.select()}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 11,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              color: 'var(--text-secondary)',
              textOverflow: 'ellipsis',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => void copyWithToast(row.label, row.url)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            <Icon name="copy" size={12} />
            複製
          </button>
          {row.openable && (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              開啟
            </a>
          )}
        </div>
      ))}
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>
      )}
    </div>
  )
}
