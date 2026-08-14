import { Icon, type IconName } from '../common/icons'

/**
 * Pill-shaped type filter row that lives in the page toolbar.
 *
 * The four chips are mutually exclusive (single-select); the active one is
 * marked aria-pressed=true. Counts come pre-bucketed from the page (we
 * don't compute them here — the page already has the loaded asset list
 * and is the natural source of truth).
 */
export type TypeFilter = 'all' | 'Image' | 'Video' | 'Audio'

interface Props {
  counts: { all: number; Image: number; Video: number; Audio: number }
  value: TypeFilter
  onChange: (v: TypeFilter) => void
}

const CHIPS: Array<{
  key: TypeFilter
  label: string
  icon?: IconName
  color?: string
}> = [
  { key: 'all', label: '全部' },
  { key: 'Image', label: '图片', icon: 'image', color: 'var(--type-image)' },
  { key: 'Video', label: '视频', icon: 'video', color: 'var(--border-focus)' },
  { key: 'Audio', label: '音频', icon: 'music', color: 'var(--success)' },
]

export default function AssetTypeFilterChips({
  counts,
  value,
  onChange,
}: Props) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {CHIPS.map((c) => {
        const active = value === c.key
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              border: active
                ? '1px solid var(--accent)'
                : '1px solid var(--border)',
              background: active ? 'var(--accent-bg)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
              transition: 'border-color 0.15s, background 0.15s, color 0.15s',
            }}
          >
            {c.icon && <Icon name={c.icon} size={12} stroke={c.color} />}
            <span>{c.label}</span>
            <span
              style={{
                color: 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {counts[c.key] ?? 0}
            </span>
          </button>
        )
      })}
    </div>
  )
}
