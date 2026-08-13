import type { CSSProperties } from 'react'
import type { Asset } from '../../types/asset'
import AssetCard from './AssetCard'

interface Props {
  assets: Asset[]
  loading: boolean
  /** Currently selected asset id; the matching card gets the accent ring. */
  selectedId: string | null
  /** Batch-delete: set of ticked asset ids. */
  checkedIds: Set<string>
  /** Batch-delete: toggle a card's tick. */
  onToggleCheck: (id: string) => void
  emptyHint?: string
  onCopyUri: (uri: string) => void
  /** Click anywhere on the card body — selects + opens the preview drawer. */
  onSelect: (a: Asset) => void
}

const GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 16,
  padding: '16px 20px',
}

/** Skeleton line used inside the loading cards. */
function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      style={{
        height: 12,
        width,
        background: 'var(--bg-input)',
        borderRadius: 6,
        opacity: 0.6,
      }}
    />
  )
}

export default function AssetGrid({
  assets,
  loading,
  selectedId,
  checkedIds,
  onToggleCheck,
  emptyHint,
  onCopyUri,
  onSelect,
}: Props) {
  if (loading) {
    return (
      <div style={GRID_STYLE} data-testid="asset-grid-loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-secondary)',
              overflow: 'hidden',
            }}
          >
            {/* mirrors the real card: 180px thumb + two text lines */}
            <div
              style={{ height: 180, background: 'var(--bg-input)', opacity: 0.5 }}
            />
            <div
              style={{
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <SkeletonLine width="70%" />
              <SkeletonLine width="50%" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (assets.length === 0) {
    return (
      <div
        data-testid="asset-grid-empty"
        style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        {emptyHint ?? '此群組尚無資產，點右上方上傳。'}
      </div>
    )
  }
  return (
    <div style={GRID_STYLE}>
      {assets.map((a) => (
        <AssetCard
          key={a.id}
          asset={a}
          selected={a.id === selectedId}
          onClick={onSelect}
          onCopyUri={onCopyUri}
          checked={checkedIds.has(a.id)}
          anyChecked={checkedIds.size > 0}
          onToggleCheck={onToggleCheck}
        />
      ))}
    </div>
  )
}
