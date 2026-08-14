import { useState } from 'react'
import type { Asset } from '../../types/asset'
import { formatAssetUri } from '../../types/asset'
import AudioWaveformDecoration from './AudioWaveformDecoration'
import { Icon, type IconName } from '../common/icons'
import StatusPill from '../common/StatusPill'

interface Props {
  asset: Asset
  selected: boolean
  onClick: (asset: Asset) => void
  onCopyUri: (uri: string) => void
  /** Batch-delete: whether this card is ticked. */
  checked?: boolean
  /** Batch-delete: any card on the page is ticked → keep checkboxes shown. */
  anyChecked?: boolean
  /** Batch-delete: toggle this card's tick. */
  onToggleCheck?: (id: string) => void
}

const TYPE_BADGE: Record<
  Asset['assetType'],
  { label: string; icon: IconName; color: string }
> = {
  Image: { label: '图片', icon: 'image', color: 'var(--type-image)' },
  Video: { label: '视频', icon: 'video', color: 'var(--border-focus)' },
  Audio: { label: '音频', icon: 'music', color: 'var(--success)' },
}

export default function AssetCard({
  asset,
  selected,
  onClick,
  onCopyUri,
  checked = false,
  anyChecked = false,
  onToggleCheck,
}: Props) {
  const [hovered, setHovered] = useState(false)
  // 键盘用户 Tab 到 checkbox 时也要现形（鼠标靠卡片 hover 显示）。
  const [checkFocused, setCheckFocused] = useState(false)
  const badge = TYPE_BADGE[asset.assetType]
  const checkVisible = hovered || checked || anyChecked || checkFocused

  return (
    <div
      data-testid="asset-card"
      onClick={() => onClick(asset)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // Fixed 1px border — selection swaps color + adds a ring, so the
        // layout never shifts (spec §A.3).
        border: '1px solid',
        borderColor: selected
          ? 'var(--accent)'
          : hovered
            ? 'var(--text-muted)'
            : 'var(--border)',
        borderRadius: 8,
        background: 'var(--bg-secondary)',
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
        boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.3)' : 'none',
        transition: 'border-color 0.15s, background 0.15s, color 0.15s',
      }}
    >
      {/* checkbox — visible on hover / when (any) checked */}
      <input
        type="checkbox"
        data-testid="asset-check"
        aria-label={`选择 ${asset.name || asset.id}`}
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onFocus={() => setCheckFocused(true)}
        onBlur={() => setCheckFocused(false)}
        onChange={(e) => {
          e.stopPropagation()
          onToggleCheck?.(asset.id)
        }}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 2,
          width: 20,
          height: 20,
          margin: 0,
          appearance: 'none',
          WebkitAppearance: 'none',
          borderRadius: 5,
          border: checked ? 'none' : '1.5px solid rgba(230,237,243,0.7)',
          background: checked ? 'var(--accent)' : 'rgba(13,17,23,0.55)',
          cursor: 'pointer',
          opacity: checkVisible ? 1 : 0,
          transition: 'opacity 0.15s, background 0.15s',
        }}
      />
      {checked && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 3,
            width: 20,
            height: 20,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            color: '#fff',
          }}
        >
          <Icon name="check" size={13} strokeWidth={3} />
        </span>
      )}
      {/* preview area */}
      <div
        style={{
          height: 180,
          background: 'var(--bg-input)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {asset.status === 'Failed' ? (
          <div
            data-testid="asset-failed-placeholder"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              color: 'var(--danger)',
              padding: 12,
              textAlign: 'center',
            }}
            title={asset.error?.message ?? '处理失败'}
          >
            <Icon name="alert-triangle" size={26} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              处理失败
            </span>
          </div>
        ) : asset.status === 'Processing' ? (
          <div
            data-testid="asset-status-processing"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span className="spinner" />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              处理中…
            </span>
          </div>
        ) : asset.assetType === 'Image' && asset.url ? (
          <img
            src={asset.url}
            alt={asset.name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : asset.assetType === 'Video' && asset.url ? (
          <>
            <video
              src={asset.url}
              muted
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div
              data-testid="video-play-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'rgba(13,17,23,0.65)',
                  color: '#e6edf3',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon
                  name="play"
                  size={16}
                  fill="currentColor"
                  stroke="none"
                  style={{ marginLeft: 2 }}
                />
              </span>
            </div>
          </>
        ) : asset.assetType === 'Audio' ? (
          <AudioWaveformDecoration seed={asset.id} data-testid="audio-waveform" />
        ) : null}

        {/* checked thumbnail overlay */}
        {checked && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(59,130,246,0.14)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* type badge — bottom-left absolute; 4px radius + rgba bg are
            mockup-specified exceptions */}
        <div
          data-testid="type-badge"
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(13,17,23,0.75)',
            color: '#e6edf3',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          <Icon name={badge.icon} size={11} stroke={badge.color} />
          {badge.label}
        </div>

        {/* status — Active shows nothing; Processing/Failed use StatusPill */}
        {asset.status === 'Processing' && (
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <StatusPill kind="running" label="处理中" testId="status-pill" />
          </div>
        )}
        {asset.status === 'Failed' && (
          <div
            title={asset.error?.message}
            style={{ position: 'absolute', top: 8, right: 8 }}
          >
            <StatusPill kind="danger" label="失败" testId="status-pill" />
          </div>
        )}
      </div>

      {/* info area */}
      <div
        style={{
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <div
          title={asset.name}
          style={{
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {asset.name || '(无名称)'}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          <span
            title={asset.id}
            style={{
              fontFamily: 'ui-monospace, monospace',
              flex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {asset.id}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="复制 URI"
            title="复制 asset:// URI"
            onClick={(e) => {
              e.stopPropagation()
              onCopyUri(formatAssetUri(asset.id))
            }}
            style={{ flexShrink: 0 }}
          >
            <Icon name="copy" size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
