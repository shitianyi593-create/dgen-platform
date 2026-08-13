import { useState } from 'react'
import { useImageStore } from '../../stores/imageStore'
import { useNow } from '../../hooks/useNow'
import { SEEDREAM_MODELS } from '../../utils/seedreamModels'
import UrlPanel from '../common/UrlPanel'
import { Icon } from '../common/icons'

export default function ImagePreview() {
  const history = useImageStore((s) => s.history)
  const currentEntryId = useImageStore((s) => s.currentEntryId)
  const entry = history.find((h) => h.id === currentEntryId) ?? null
  // 生成中每秒 tick（經過秒數顯示）；已完成且有 24h 期限的非匯入項目每分鐘
  // tick 一次，讓「URL 已過期」畫面在頁面開著不動時也會自己翻面。其餘情況
  // 不需要時間流逝 → 0（不掛 interval）。
  const watchExpiry =
    entry?.status === 'succeeded' && !entry.imported && entry.expiresAt !== undefined
  const now = useNow(entry?.status === 'generating' ? 1000 : watchExpiry ? 60_000 : 0)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // 框內置中狀態（等待 / 生成中 / 失敗 / 過期）
  const centerInner: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 12, color: 'var(--text-muted)',
    padding: 24, textAlign: 'center',
  }

  // 與 VideoPreview 相同的外層版式：標題 + bg-secondary 框 + 下方資訊列
  const renderFramed = (inner: React.ReactNode, below?: React.ReactNode) => (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: 24, overflow: 'auto', minWidth: 0,
    }}>
      <h2 style={{
        fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
        marginBottom: 12, marginTop: 0,
      }}>
        生成的圖片
      </h2>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, background: 'var(--bg-secondary)',
        border: '1px solid var(--border)', minHeight: 300,
        padding: 16, overflow: 'auto', position: 'relative',
      }}>
        {inner}
      </div>
      {below}
    </div>
  )

  if (!entry) {
    return renderFramed(
      <div style={centerInner}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <div style={{ fontSize: 14 }}>尚未生成圖片 — 在左側設定參數後點「生成圖片」</div>
      </div>,
    )
  }

  if (entry.status === 'generating') {
    const elapsed = Math.max(0, Math.round((now - entry.createdAt) / 1000))
    return renderFramed(
      <div style={centerInner}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <div style={{ fontSize: 15, color: 'var(--text-secondary)' }}>生成中… {elapsed}s</div>
        <div style={{ fontSize: 12 }}>Seedream 為同步生成，組圖/高解析度需時較久</div>
      </div>,
    )
  }

  if (entry.status === 'failed') {
    return renderFramed(
      <div style={centerInner}>
        <Icon name="alert-triangle" size={32} style={{ opacity: 0.5 }} />
        <div style={{ fontSize: 14, color: 'var(--danger)' }}>生成失敗</div>
        <div style={{ fontSize: 12, wordBreak: 'break-word', maxWidth: 400 }}>{entry.error}</div>
      </div>,
    )
  }

  const expired = !entry.imported && entry.expiresAt !== undefined && now > entry.expiresAt
  if (expired) {
    return renderFramed(
      <div style={centerInner}>
        <div style={{ fontSize: 14 }}>圖片 URL 已過期（Seedream 連結僅保留 24 小時）。</div>
        <div style={{ fontSize: 12 }}>已下載或已匯出 zip 的圖不受影響。</div>
      </div>,
    )
  }

  const single = entry.images.length === 1
  const modelLabel = SEEDREAM_MODELS[entry.modelKey]?.label
  const hoursLeft = !entry.imported && entry.expiresAt !== undefined
    ? Math.max(0, Math.floor((entry.expiresAt - now) / 3600_000))
    : null
  // 可複製的線上 URL（blob: 是本頁限定的 objectURL，貼到別處無效）。
  const copyableUrls = entry.images
    .map((im) => im.url)
    .filter((u) => !entry.imported && !u.startsWith('blob:'))

  return renderFramed(
    <div
      style={
        single
          ? { maxWidth: 900, maxHeight: '100%', margin: '0 auto' }
          : {
              display: 'grid', gap: 12, width: '100%', maxWidth: 900,
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              alignSelf: 'flex-start',
            }
      }
    >
      {entry.images.map((img, i) => (
        <img
          key={i}
          src={img.url}
          alt={`生成圖片 ${i + 1}`}
          style={{
            width: '100%', maxHeight: single ? '100%' : undefined,
            objectFit: 'contain', borderRadius: 8, cursor: 'zoom-in',
            display: 'block',
          }}
          onClick={() => setLightboxUrl(img.url)}
        />
      ))}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-label="放大檢視"
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50, cursor: 'zoom-out',
            background: 'rgba(0,0,0,0.85)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img src={lightboxUrl} alt="放大檢視" style={{ maxWidth: '92vw', maxHeight: '92vh' }} />
        </div>
      )}
    </div>,
    <>
      {/* 資訊列 — 與 VideoPreview 的 video info bar 同款 */}
      <div style={{
        display: 'flex', gap: 16, marginTop: 12, padding: '8px 12px',
        background: 'var(--bg-secondary)', borderRadius: 6,
        border: '1px solid var(--border)', fontSize: 12,
        color: 'var(--text-secondary)', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap' }}>
            {modelLabel}
            {entry.params.size && ` · ${entry.params.size}`}
            {entry.images.length > 1 && ` · ${entry.images.length} 張`}
          </span>
          {entry.imported && (
            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-input)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              已匯入
            </span>
          )}
          {hoursLeft !== null && (
            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--success-bg)', border: '1px solid var(--success-bd)', color: 'var(--success)', whiteSpace: 'nowrap' }}>
              {hoursLeft} 小時後過期
            </span>
          )}
        </div>
      </div>

      {/* URL 面板 — 共用 UrlPanel（handoff 共用新元件）；高頻工作流：
          複製輸出 URL 貼到影片分頁當參考圖。匯入項目的 blob: URL 僅存活
          於本頁，貼到別處無效 → 不顯示。 */}
      {copyableUrls.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <UrlPanel
            rows={copyableUrls.map((url, i) => ({
              label: copyableUrls.length > 1 ? `圖片 ${i + 1}` : '圖片 URL',
              url,
              openable: true,
            }))}
            hint="可貼到影片生成頁的「Asset 參考」或參考圖，串接圖生影片。"
          />
        </div>
      )}
    </>,
  )
}
