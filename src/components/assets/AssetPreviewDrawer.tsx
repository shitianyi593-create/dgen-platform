import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Asset } from '../../types/asset'
import { formatAssetUri } from '../../types/asset'
import AudioWaveformDecoration from './AudioWaveformDecoration'
import { computePanelScale, scaledFs } from '../../utils/panelScale'
import { Icon, type IconName } from '../common/icons'
import StatusPill, { type StatusPillKind } from '../common/StatusPill'

const TYPE_META: Record<
  Asset['assetType'],
  { label: string; icon: IconName; color: string }
> = {
  Image: { label: '圖片', icon: 'image', color: 'var(--type-image)' },
  Video: { label: '影片', icon: 'video', color: 'var(--border-focus)' },
  Audio: { label: '音訊', icon: 'music', color: 'var(--success)' },
}

const STATUS_KIND: Record<Asset['status'], StatusPillKind> = {
  Active: 'success',
  Processing: 'running',
  Failed: 'danger',
}

/** Default width when no parent overrides — used as the scale=1 baseline. */
export const ASSET_PREVIEW_DRAWER_DEFAULT_WIDTH = 480

interface Props {
  asset: Asset | null
  /** Display name of the asset's owning group, looked up by the page. */
  groupName?: string
  onClose: () => void
  onRename: (asset: Asset, name: string) => Promise<void>
  onRefreshUrl: (asset: Asset) => Promise<void>
  onCopyUri: (uri: string) => void
  onDelete: (asset: Asset) => void
  /** Optional override; falls back to ASSET_PREVIEW_DRAWER_DEFAULT_WIDTH. */
  width?: number
}

function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toUpperCase()
}

/** ARK gives ISO ("2026-02-24T21:32:58Z"); render in local TZ as
 *  "YYYY-MM-DD HH:MM:SS". */
function fmtCreateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/** Trigger the dev-server download proxy via a hidden form-style POST.
 *  We can't use <a href download> directly because TOS URLs are
 *  cross-origin (browsers ignore the download attribute then). */
async function triggerProxyDownload(assetUrl: string, filename: string) {
  const res = await fetch('/local-api/download-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: assetUrl, filename }),
  })
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export default function AssetPreviewDrawer({
  asset,
  groupName,
  onClose,
  onRename,
  onRefreshUrl,
  onCopyUri,
  onDelete,
  width = ASSET_PREVIEW_DRAWER_DEFAULT_WIDTH,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deleteHover, setDeleteHover] = useState(false)

  if (!asset) return null

  const panelScale = computePanelScale(width, ASSET_PREVIEW_DRAWER_DEFAULT_WIDTH)
  const dynamicSectionLabel: CSSProperties = {
    ...sectionLabel,
    fontSize: scaledFs(12),
  }

  async function submitRename() {
    if (!asset || !name.trim()) return
    setBusy(true)
    try {
      await onRename(asset, name.trim())
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function clickDownload() {
    if (!asset || !asset.url) return
    setDownloading(true)
    try {
      await triggerProxyDownload(asset.url, asset.name || asset.id)
    } finally {
      setDownloading(false)
    }
  }

  const asideStyle: CSSProperties = {
    width,
    flexShrink: 0,
    height: '100%',
    background: 'var(--bg-secondary)',
    borderLeft: '1px solid var(--border)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    ['--panel-scale' as unknown as keyof CSSProperties]: panelScale,
  } as CSSProperties

  return (
    <aside className="resizable-panel" style={asideStyle}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            fontSize: scaledFs(14),
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          素材詳細資料
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="關閉"
          onClick={onClose}
          style={{ width: 28, height: 28 }}
        >
          <Icon name="x" size={15} />
        </button>
      </header>

      <div style={{ padding: 16, flex: 1 }}>
        {/* preview */}
        <div
          style={{
            background: 'var(--bg-input)',
            borderRadius: 8,
            minHeight: 240,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
            overflow: 'hidden',
          }}
        >
          {asset.status === 'Failed' ? (
            <div
              data-testid="drawer-failed"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: 24,
                color: 'var(--danger)',
                textAlign: 'center',
              }}
            >
              <Icon name="alert-triangle" size={32} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>處理失敗</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {asset.error?.message ?? '請刪除後重新上傳'}
              </span>
            </div>
          ) : asset.status === 'Processing' ? (
            <div
              data-testid="drawer-processing"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span className="spinner" />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                處理中…
              </span>
            </div>
          ) : (
            <>
              {asset.assetType === 'Image' && asset.url && (
                <img
                  src={asset.url}
                  alt={asset.name}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 360,
                    objectFit: 'contain',
                  }}
                />
              )}
              {asset.assetType === 'Video' && asset.url && (
                <video
                  src={asset.url}
                  controls
                  preload="metadata"
                  style={{ maxWidth: '100%', maxHeight: 360 }}
                />
              )}
              {asset.assetType === 'Audio' && asset.url && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 12,
                    padding: 16,
                    width: '100%',
                  }}
                >
                  <AudioWaveformDecoration seed={asset.id} height={120} />
                  <audio
                    src={asset.url}
                    controls
                    preload="metadata"
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* filename + inline edit */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          {editing ? (
            <>
              <input
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={submitRename}
                disabled={busy}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'var(--accent, #3b82f6)',
                  color: '#fff',
                  fontSize: scaledFs(13),
                }}
              >
                儲存
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: scaledFs(13),
                }}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <h3
                style={{
                  margin: 0,
                  fontSize: scaledFs(16),
                  fontWeight: 600,
                  flex: 1,
                  wordBreak: 'break-all',
                }}
              >
                {asset.name || '(無名稱)'}
              </h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="重新命名"
                title="重新命名"
                onClick={() => {
                  setEditing(true)
                  setName(asset.name)
                }}
                style={iconBtnStyle}
              >
                <Icon name="edit" size={13} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="重新整理 URL"
                title="重新整理 URL"
                onClick={() => onRefreshUrl(asset)}
                style={iconBtnStyle}
              >
                <Icon name="refresh-cw" size={13} />
              </button>
            </>
          )}
        </div>

        {/* type + group + status chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={chipStyle}>
            <Icon
              name={TYPE_META[asset.assetType].icon}
              size={11}
              stroke={TYPE_META[asset.assetType].color}
            />
            {TYPE_META[asset.assetType].label}
          </span>
          {groupName && (
            <span style={chipStyle}>
              <Icon name="folder" size={11} />
              {groupName}
            </span>
          )}
          <StatusPill kind={STATUS_KIND[asset.status]} label={asset.status} />
        </div>

        {/* URI box — the most prominent block */}
        <section style={{ marginBottom: 20 }}>
          <div style={dynamicSectionLabel}>
            asset:// URI{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
              — 複製後貼回影片生成引用
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 8px 8px 12px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <code
              style={{
                flex: 1,
                fontSize: scaledFs(12),
                fontFamily: 'ui-monospace, monospace',
                wordBreak: 'break-all',
                lineHeight: 1.5,
              }}
            >
              {formatAssetUri(asset.id)}
            </code>
            <button
              type="button"
              aria-label="複製"
              title="複製到剪貼簿"
              onClick={() => onCopyUri(formatAssetUri(asset.id))}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                padding: '6px 12px',
                fontSize: scaledFs(12),
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              <Icon name="copy" size={12} />
              複製
            </button>
          </div>
        </section>

        {/* basic info */}
        <section>
          <div style={dynamicSectionLabel}>基本資訊</div>
          <dl style={{ margin: 0, fontSize: scaledFs(13), lineHeight: 1.8 }}>
            <Row label="素材 ID" value={asset.id} mono />
            <Row
              label="類型"
              value={`${TYPE_META[asset.assetType].label} / ${fileExt(asset.name) || '—'}`}
            />
            <Row label="建立時間" value={fmtCreateTime(asset.createTime)} />
            <Row label="群組" value={groupName ?? '—'} />
            <Row label="群組 ID" value={asset.groupId} mono />
            {asset.error && (
              <Row
                label="錯誤"
                value={`${asset.error.code ?? ''}: ${asset.error.message ?? ''}`}
                valueStyle={{ color: 'var(--danger)' }}
              />
            )}
          </dl>
        </section>
      </div>

      {/* sticky footer actions */}
      <footer
        style={{
          display: 'flex',
          gap: 8,
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          onClick={clickDownload}
          disabled={downloading || !asset.url}
          style={{
            flex: 1,
            ...primaryActionStyle,
            opacity: downloading || !asset.url ? 0.6 : 1,
          }}
        >
          {downloading ? (
            '下載中…'
          ) : (
            <>
              <Icon name="download" size={14} />
              下載
            </>
          )}
        </button>
        <button
          type="button"
          aria-label="刪除素材"
          onClick={() => onDelete(asset)}
          onMouseEnter={() => setDeleteHover(true)}
          onMouseLeave={() => setDeleteHover(false)}
          style={{
            flex: 1,
            ...primaryActionStyle,
            background: deleteHover ? 'var(--danger-bg)' : 'transparent',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
          }}
        >
          <Icon name="trash" size={14} />
          刪除
        </button>
      </footer>
    </aside>
  )
}

function Row({
  label,
  value,
  mono,
  valueStyle,
}: {
  label: string
  value: string
  mono?: boolean
  valueStyle?: CSSProperties
}) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 4 }}>
      <dt
        style={{
          width: 90,
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
          wordBreak: 'break-all',
          ...valueStyle,
        }}
      >
        {value}
      </dd>
    </div>
  )
}

/** 28×28 framed icon buttons (rename / refresh) — pairs with .icon-btn. */
const iconBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: '1px solid var(--border)',
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 9px',
  borderRadius: 999,
  background: 'var(--bg-input)',
  fontSize: scaledFs(11),
  color: 'var(--text-secondary)',
}

/** Static base — actual fontSize is overridden per-instance via
 *  dynamicSectionLabel inside the component so it picks up the panel scale.
 *  小節標籤規格（handoff §4）：12px/600 --text-secondary、無 uppercase。 */
const sectionLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 8,
}

const primaryActionStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '9px 12px',
  borderRadius: 6,
  fontSize: scaledFs(13),
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
}
