/**
 * Status filter — now a native <select> dropdown (spec §A.2), sibling to
 * AssetTypeFilterChips in the toolbar. Single-select; the parent page is
 * responsible for refetching with `Statuses: [value]` when the value
 * changes (the `all` value sends no Statuses filter).
 *
 * File & export names are kept for continuity even though the UI is no
 * longer chips.
 */
export type StatusFilter = 'all' | 'Active' | 'Processing' | 'Failed'

interface Props {
  value: StatusFilter
  onChange: (v: StatusFilter) => void
}

const OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'Active', label: 'Active' },
  { value: 'Processing', label: 'Processing' },
  { value: 'Failed', label: 'Failed' },
]

export default function AssetStatusFilterChips({ value, onChange }: Props) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      状态
      <select
        aria-label="状态筛选"
        value={value}
        onChange={(e) => onChange(e.target.value as StatusFilter)}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
