import { useState } from 'react'
import { useImageStore } from '../../stores/imageStore'
import { useNow } from '../../hooks/useNow'
import { SEEDREAM_MODELS } from '../../utils/seedreamModels'
import UrlPanel from '../common/UrlPanel'
import { Icon } from '../common/icons'
import { useOptionalI18n } from '../../i18n/useOptionalI18n'

export default function ImagePreview() {
  const { t } = useOptionalI18n()
  const history = useImageStore((s) => s.history)
  const currentEntryId = useImageStore((s) => s.currentEntryId)
  const entry = history.find((h) => h.id === currentEntryId) ?? null
  // 生成中每秒 tick（经过秒数显示）；已完成且有 24h 期限的非导入项目每分钟
  // tick 一次，让「URL 已过期」画面在页面开著不动时也会自己翻面。其余情况
  // 不需要时间流逝 → 0（不挂 interval）。
  const watchExpiry =
    entry?.status === 'succeeded' && !entry.imported && entry.expiresAt !== undefined
  const now = useNow(entry?.status === 'generating' ? 1000 : watchExpiry ? 60_000 : 0)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // 框内置中状态（等待 / 生成中 / 失败 / 过期）
  const centerInner: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 12, color: 'var(--text-muted)',
    padding: 24, textAlign: 'center',
  }

  // 与 VideoPreview 相同的外层版式：标题 + bg-secondary 框 + 下方信息列
  const renderFramed = (inner: React.ReactNode, below?: React.ReactNode) => (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: 24, overflow: 'auto', minWidth: 0,
    }}>
      <h2 style={{
        fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
        marginBottom: 12, marginTop: 0,
      }}>
        {t('image.preview.title')}
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
        <div style={{ fontSize: 14 }}>{t('image.preview.empty')}</div>
      </div>,
    )
  }

  if (entry.status === 'generating') {
    const elapsed = Math.max(0, Math.round((now - entry.createdAt) / 1000))
    return renderFramed(
      <div style={centerInner}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <div style={{ fontSize: 15, color: 'var(--text-secondary)' }}>{t('image.preview.generating', { seconds: elapsed })}</div>
        <div style={{ fontSize: 12 }}>{t('image.preview.generatingHint')}</div>
      </div>,
    )
  }

  if (entry.status === 'failed') {
    return renderFramed(
      <div style={centerInner}>
        <Icon name="alert-triangle" size={32} style={{ opacity: 0.5 }} />
        <div style={{ fontSize: 14, color: 'var(--danger)' }}>{t('image.preview.failed')}</div>
        <div style={{ fontSize: 12, wordBreak: 'break-word', maxWidth: 400 }}>{entry.error}</div>
      </div>,
    )
  }

  const expired = !entry.imported && entry.expiresAt !== undefined && now > entry.expiresAt
  if (expired) {
    return renderFramed(
      <div style={centerInner}>
        <div style={{ fontSize: 14 }}>{t('image.preview.expired')}</div>
        <div style={{ fontSize: 12 }}>{t('image.preview.expiredHint')}</div>
      </div>,
    )
  }

  const single = entry.images.length === 1
  const modelLabel = SEEDREAM_MODELS[entry.modelKey]?.label
  const hoursLeft = !entry.imported && entry.expiresAt !== undefined
    ? Math.max(0, Math.floor((entry.expiresAt - now) / 3600_000))
    : null
  // 可复制的线上 URL（blob: 是本页限定的 objectURL，贴到别处无效）。
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
          alt={t('image.preview.alt', { index: i + 1 })}
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
          aria-label={t('image.preview.zoom')}
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50, cursor: 'zoom-out',
            background: 'rgba(0,0,0,0.85)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img src={lightboxUrl} alt={t('image.preview.zoom')} style={{ maxWidth: '92vw', maxHeight: '92vh' }} />
        </div>
      )}
    </div>,
    <>
      {/* 信息列 — 与 VideoPreview 的 video info bar 同款 */}
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
            {entry.images.length > 1 && ` · ${t('image.preview.count', { count: entry.images.length })}`}
          </span>
          {entry.imported && (
            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-input)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              {t('image.preview.imported')}
            </span>
          )}
          {hoursLeft !== null && (
            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--success-bg)', border: '1px solid var(--success-bd)', color: 'var(--success)', whiteSpace: 'nowrap' }}>
              {t('image.preview.expiresHours', { hours: hoursLeft })}
            </span>
          )}
        </div>
      </div>

      {/* URL 面板 — 共用 UrlPanel（handoff 共用新组件）；高频工作流：
          复制输出 URL 贴到视频分页当参考图。导入项目的 blob: URL 仅存活
          于本页，贴到别处无效 → 不显示。 */}
      {copyableUrls.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <UrlPanel
            rows={copyableUrls.map((url, i) => ({
              label: copyableUrls.length > 1 ? t('image.preview.urlIndexed', { index: i + 1 }) : t('image.preview.urlLabel'),
              url,
              openable: true,
            }))}
            hint={t('image.preview.urlHint')}
          />
        </div>
      )}
    </>,
  )
}
