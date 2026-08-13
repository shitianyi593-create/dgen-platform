import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useImageStore } from '../../stores/imageStore'
import { useNow } from '../../hooks/useNow'
import { SEEDREAM_MODELS } from '../../utils/seedreamModels'
import { downloadAssetBlob } from '../../api/local'
import { downloadBlob } from '../../api/exportBundle'
import {
  buildImageBundleZip,
  buildImageBatchZip,
  importImageBundleZip,
} from '../../api/imageBundle'
import ConfirmModal from '../common/ConfirmModal'
import StatusPill, { type StatusPillKind } from '../common/StatusPill'
import OverflowMenu from '../common/OverflowMenu'
import { overflowMenuItemStyle } from '../common/overflowMenuStyles'
import { Icon } from '../common/icons'
import { copyWithToast } from '../../utils/clipboard'
import type { ImageHistoryItem } from '../../types/image'

export const IMAGE_HISTORY_DEFAULT_WIDTH = 300

function fmtCountdown(msLeft: number): string {
  const h = Math.floor(msLeft / 3600_000)
  const m = Math.floor((msLeft % 3600_000) / 60_000)
  return h > 0 ? `${h} 小時 ${m} 分後過期` : `${m} 分後過期`
}

function isExpired(item: ImageHistoryItem, now: number): boolean {
  return !item.imported && item.expiresAt !== undefined && now > item.expiresAt
}

// 狀態 → StatusPill kind 對照（handoff §2；文字 label 維持不變）
function statusChip(
  item: ImageHistoryItem,
  expired: boolean,
): { label: string; kind: StatusPillKind } {
  if (item.status === 'generating') return { label: '生成中', kind: 'running' }
  if (item.status === 'failed') return { label: '失敗', kind: 'danger' }
  if (expired) return { label: '已過期', kind: 'warning' }
  return { label: '完成', kind: 'success' }
}

async function downloadImages(item: ImageHistoryItem): Promise<void> {
  for (let i = 0; i < item.images.length; i++) {
    const url = item.images[i].url
    const ext = url.startsWith('blob:')
      ? (item.params.outputFormat ?? 'png')
      : (url.match(/\.([A-Za-z0-9]{1,5})(?:$|[?#])/)?.[1] ?? item.params.outputFormat ?? 'png')
    const filename = `${item.id}-image-${i + 1}.${ext}`
    const blob = url.startsWith('blob:')
      ? await (await fetch(url)).blob()          // imported：blob 直接抓
      : await downloadAssetBlob(url, filename)   // 線上：走 SSRF 允許清單代理
    downloadBlob(blob, filename)
  }
}

export default function ImageHistory({ width }: { width: number }) {
  const history = useImageStore((s) => s.history)
  const setCurrentEntry = useImageStore((s) => s.setCurrentEntry)
  const removeHistory = useImageStore((s) => s.removeHistory)
  const addHistory = useImageStore((s) => s.addHistory)
  const loadParams = useImageStore((s) => s.loadParamsFromHistory)
  const now = useNow(60_000) // 到期倒數分鐘級即可
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // 進行中的非同步動作 key（'exportAll' | 'import' | `download:<id>` | `export:<id>`）。
  // 對應按鈕在動作期間 disabled，防止連點重複觸發（同 VideoHistory 的
  // exporting / downloading / batchExporting / importing 守衛）。
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set())
  // 展開「除錯資訊」的卡片 id 集合（預設全部收合）。
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const importInputRef = useRef<HTMLInputElement>(null)

  const toggleDebug = (id: string) =>
    setExpandedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusyKeys((s) => new Set(s).add(key))
    try {
      await fn()
    } finally {
      setBusyKeys((s) => {
        const next = new Set(s)
        next.delete(key)
        return next
      })
    }
  }

  const onDownload = (item: ImageHistoryItem) =>
    withBusy(`download:${item.id}`, async () => {
      try {
        await downloadImages(item)
      } catch (e) {
        toast.error(`下載失敗: ${e instanceof Error ? e.message : e}`)
      }
    })

  const onExport = (item: ImageHistoryItem) =>
    withBusy(`export:${item.id}`, async () => {
      try {
        const { bytes, missing } = await buildImageBundleZip(item)
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), `${item.id}.zip`)
        if (missing.length) toast.error(`${missing.length} 張圖片下載失敗，未包含在 zip`)
      } catch (e) {
        toast.error(`匯出失敗: ${e instanceof Error ? e.message : e}`)
      }
    })

  const onExportAll = () =>
    withBusy('exportAll', async () => {
      // imported 項目排除：其 blob: URL 走不了下載代理（每張圖都會 missing），
      // 且來源 zip 本來就在使用者手上，重匯出只會得到空殼。
      const exportable = history.filter(
        (h) => h.status === 'succeeded' && !isExpired(h, now) && !h.imported,
      )
      if (exportable.length === 0) { toast.error('沒有可匯出的紀錄'); return }
      try {
        const { bytes, missing } = await buildImageBatchZip(exportable)
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), 'image-history.zip')
        if (missing.length) toast.error(`${missing.length} 張圖片下載失敗，未包含在 zip`)
      } catch (e) {
        toast.error(`匯出失敗: ${e instanceof Error ? e.message : e}`)
      }
    })

  const onImportFile = (file: File) =>
    withBusy('import', async () => {
      try {
        const items = await importImageBundleZip(file)
        for (const it of items) addHistory(it)
        toast.success(`已匯入 ${items.length} 筆紀錄`)
      } catch (e) {
        toast.error(`匯入失敗: ${e instanceof Error ? e.message : e}`)
      }
    })

  return (
    <div
      className="resizable-panel"
      style={{
        width, flexShrink: 0, overflowY: 'auto', padding: 16,
        borderLeft: '1px solid var(--border)', display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header — 欄標題 14px/600（handoff §4）；工具列按鈕加 SVG icon */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>生成紀錄</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={busyKeys.has('exportAll')}
            style={{ ...batchBtnStyle, cursor: busyKeys.has('exportAll') ? 'wait' : 'pointer' }}
            onClick={() => void onExportAll()}
          >
            <Icon name="download" size={11} />
            {busyKeys.has('exportAll') ? '匯出中…' : '匯出全部'}
          </button>
          <button
            type="button"
            disabled={busyKeys.has('import')}
            style={{ ...batchBtnStyle, cursor: busyKeys.has('import') ? 'wait' : 'pointer' }}
            onClick={() => importInputRef.current?.click()}
          >
            <Icon name="upload" size={11} />
            {busyKeys.has('import') ? '匯入中…' : '匯入'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            aria-label="匯入 zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {history.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8, opacity: 0.4 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <div>目前沒有生成紀錄</div>
          <div style={{ marginTop: 8, fontSize: 11 }}>若有已匯出的 .zip，點「匯入」載入</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {history.map((item) => {
          const expired = isExpired(item, now)
          const chip = statusChip(item, expired)
          const isCurrent = false // 保留掛點：如 store 之後暴露 currentEntryId 可高亮選中卡
          // 可複製的線上 URL（blob: 是本頁限定的 objectURL，貼到別處無效）。
          const copyableUrls = item.images
            .map((im) => im.url)
            .filter((u) => !u.startsWith('blob:'))
          // 生成中的卡片還沒有任何可顯示欄位 → ⋯ 選單不渲染「除錯資訊」項。
          const hasDebug = Boolean(
            item.debug || item.images.length > 0 || item.usage || item.errorCode,
          )
          return (
            <div
              key={item.id}
              style={{
                padding: 12, borderRadius: 6,
                background: 'var(--bg-tertiary)',
                border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`,
                display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12,
                cursor: item.status === 'succeeded' && !expired ? 'pointer' : 'default',
                transition: 'border-color 0.15s',
                opacity: expired ? 0.75 : 1,
              }}
              onClick={() => {
                if (item.status === 'succeeded' && !expired) setCurrentEntry(item.id)
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              {/* 狀態列 — 統一 StatusPill（handoff §2；running 帶 spinner） */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <StatusPill kind={chip.kind} label={chip.label} />
                  {item.imported && (
                    <span style={{
                      fontSize: 10, padding: '2px 5px', borderRadius: 4,
                      background: 'var(--bg-input)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }} title="此紀錄由本機 .zip 匯入">
                      已匯入
                    </span>
                  )}
                </div>
                {item.createdAt !== undefined && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(item.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              {/* 縮圖列 */}
              {item.status === 'succeeded' && !expired && item.images.length > 0 && (
                <div style={{ display: 'flex', gap: 4, overflow: 'hidden' }}>
                  {item.images.slice(0, 4).map((img, i) => (
                    <img
                      key={i} src={img.url} alt=""
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)' }}
                      onClick={() => setCurrentEntry(item.id)}
                    />
                  ))}
                  {item.images.length > 4 && (
                    <span style={{ alignSelf: 'center', color: 'var(--text-muted)' }}>
                      +{item.images.length - 4}
                    </span>
                  )}
                </div>
              )}

              <div style={{
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                color: 'var(--text-secondary)',
              }}>
                {item.prompt}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: 11 }}>
                <span>{SEEDREAM_MODELS[item.modelKey].label}</span>
                {item.params.size && <span>{item.params.size}</span>}
                {item.status === 'succeeded' && !item.imported && item.expiresAt !== undefined && !expired && (
                  <span style={{ color: 'var(--success)' }}>{fmtCountdown(item.expiresAt - now)}</span>
                )}
              </div>

              {item.status === 'failed' && item.error && (
                <div style={{ color: 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.error}>
                  {item.error}
                </div>
              )}

              {/* 動作列 — 常駐「下載」「複製 URL」（過期卡另加「載入參數重生成」），
                  其餘動作收進 ⋯ overflow 選單（handoff §C.2；預覽由卡片點擊承擔） */}
              <div
                style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  disabled={item.status !== 'succeeded' || expired || busyKeys.has(`download:${item.id}`)}
                  onClick={() => void onDownload(item)}
                  style={btnStyle}
                >
                  <Icon name="download" size={11} />
                  {busyKeys.has(`download:${item.id}`) ? '下載中…' : '下載'}
                </button>
                {/* 高頻工作流：複製輸出 URL → 貼到影片分頁當參考圖。多張時以換行合併。 */}
                <button
                  type="button"
                  disabled={item.status !== 'succeeded' || expired || item.imported || copyableUrls.length === 0}
                  onClick={() => void copyWithToast(
                    copyableUrls.length > 1 ? `${copyableUrls.length} 個 URL` : 'URL',
                    copyableUrls.join('\n'),
                  )}
                  style={btnStyle}
                >
                  <Icon name="copy" size={11} />
                  複製 URL
                </button>
                {expired && (
                  <button
                    type="button"
                    onClick={() => { loadParams(item); toast.success('已載入參數') }}
                    style={btnStyle}
                  >
                    <Icon name="refresh-cw" size={11} />
                    載入參數重生成
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <OverflowMenu>
                  {(close) => (
                    <>
                      <button
                        type="button"
                        disabled={item.status !== 'succeeded' || expired || item.imported || busyKeys.has(`export:${item.id}`)}
                        onClick={() => { close(); void onExport(item) }}
                        style={overflowMenuItemStyle}
                      >
                        {busyKeys.has(`export:${item.id}`) ? '匯出中…' : '匯出'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          loadParams(item)
                          toast.success('已載入參數')
                          close()
                        }}
                        style={overflowMenuItemStyle}
                      >
                        載入參數
                      </button>
                      <button
                        type="button"
                        onClick={() => { setConfirmDeleteId(item.id); close() }}
                        style={{ ...overflowMenuItemStyle, color: 'var(--danger)' }}
                      >
                        刪除
                      </button>
                      {/* 切換型項目：點擊不關閉選單，aria-expanded 反映展開態 */}
                      {hasDebug && (
                        <button
                          type="button"
                          aria-expanded={expandedIds.has(item.id)}
                          onClick={() => toggleDebug(item.id)}
                          style={overflowMenuItemStyle}
                        >
                          除錯資訊
                        </button>
                      )}
                    </>
                  )}
                </OverflowMenu>
              </div>
              {expandedIds.has(item.id) && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    color: 'var(--text-secondary)', fontSize: 11, wordBreak: 'break-all',
                    borderTop: '1px solid var(--border)', paddingTop: 6,
                  }}
                >
                  {item.debug?.requestId && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ flex: 1 }}>Request ID: {item.debug.requestId}</span>
                      <button type="button" style={debugBtn} onClick={() => void copyWithToast('Request ID', item.debug?.requestId)}>複製</button>
                    </div>
                  )}
                  {item.debug?.responseModel && <div>模型: {item.debug.responseModel}</div>}
                  {item.debug?.createdApi !== undefined && (
                    <div>建立時間: {new Date(item.debug.createdApi * 1000).toLocaleString()}（{item.debug.createdApi}）</div>
                  )}
                  {item.images.map((img, i) => {
                    const urlActionable = !expired && !item.imported && !img.url.startsWith('blob:')
                    return (
                      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                        <span style={{ whiteSpace: 'nowrap' }}>#{i + 1} {img.size ?? '—'} {img.outputFormat ?? ''}</span>
                        {urlActionable && (
                          <>
                            <span
                              title={img.url}
                              style={{
                                flex: 1, minWidth: 0, overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}
                            >
                              {img.url}
                            </span>
                            <button type="button" style={debugBtn} onClick={() => void copyWithToast('URL', img.url)}>複製</button>
                            <a href={img.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>開啟</a>
                          </>
                        )}
                      </div>
                    )
                  })}
                  {item.usage && (item.usage.total_tokens !== undefined || item.usage.outputTokens !== undefined) && (
                    <div>Tokens: 輸出 {item.usage.outputTokens ?? item.usage.total_tokens ?? '—'}／共 {item.usage.total_tokens ?? '—'}</div>
                  )}
                  {item.status === 'failed' && item.errorCode && (
                    <div style={{ color: 'var(--danger)' }}>錯誤代碼: {item.errorCode}</div>
                  )}
                  {item.debug?.imageErrors?.map((e, i) => (
                    <div key={`err-${i}`} style={{ color: 'var(--danger)' }}>
                      圖 {i + 1} 失敗: {e.code ?? ''} {e.message ?? ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmModal
        open={confirmDeleteId !== null}
        title="刪除這筆紀錄？"
        subtitle="刪除後無法復原（已下載/匯出的檔案不受影響）。"
        confirmLabel="確認"
        variant="danger"
        onConfirm={() => {
          if (confirmDeleteId) removeHistory(confirmDeleteId)
          setConfirmDeleteId(null)
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}

// 次要按鈕 — 與 VideoHistory 卡片內按鈕同款（bg-input 底；handoff §5 radius 6 + icon）
const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px 10px', fontSize: 11,
  whiteSpace: 'nowrap',
}

const batchBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-secondary)', padding: '4px 10px', fontSize: 11, whiteSpace: 'nowrap',
}

const debugBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-secondary)', cursor: 'pointer', padding: '0 6px', fontSize: 11,
}

