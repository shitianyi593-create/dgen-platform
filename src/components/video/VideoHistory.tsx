import { useState, useCallback, useRef, Fragment } from 'react'
import type { CSSProperties } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore, type VideoStoreHook } from '../../stores/videoStore'
import type { TaskStatus, VideoHistoryItem } from '../../types'
import { downloadAssetBlob } from '../../api/local'
import { buildBundleZip, buildBatchBundleZip, downloadBlob } from '../../api/exportBundle'
import { parseTaskFolder, parseTaskZip, toHistoryItem, revokeImportedUrls } from '../../api/importBundle'
import { deleteVideoTask } from '../../api/video'
import { useNow } from '../../hooks/useNow'
import { computePanelScale, scaledFs } from '../../utils/panelScale'
import { copyWithToast } from '../../utils/clipboard'
import ConfirmModal from '../common/ConfirmModal'
import StatusPill, { type StatusPillKind } from '../common/StatusPill'
import OverflowMenu from '../common/OverflowMenu'
import {
  overflowMenuItemStyle,
  overflowMenuContainerStyle,
} from '../common/overflowMenuStyles'
import { Icon } from '../common/icons'
import { useOptionalI18n } from '../../i18n/useOptionalI18n'
import type { MessageKey } from '../../i18n/locales'

/** Default width when no parent overrides — used as the scale=1 baseline. */
export const VIDEO_HISTORY_DEFAULT_WIDTH = 280

// ── Helpers ──

function statusLabel(status: TaskStatus, t: (key: MessageKey, params?: Record<string, string | number>) => string) {
  switch (status) {
    case 'queued': return t('video.history.status.queued')
    case 'running': return t('video.history.status.running')
    case 'succeeded': return t('video.history.status.succeeded')
    case 'failed': return t('video.history.status.failed')
    case 'cancelled': return t('video.history.status.cancelled')
    case 'expired': return t('video.history.status.expired')
    default: return status
  }
}

/** 状态 → StatusPill kind（handoff §2；expired 不再与 queued 共用色）。 */
function statusKind(status: TaskStatus): StatusPillKind {
  switch (status) {
    case 'succeeded': return 'success'
    case 'failed': return 'danger'
    case 'running': return 'running'
    case 'expired': return 'warning'
    case 'queued': return 'muted'
    case 'cancelled': return 'muted'
    default: return 'muted'
  }
}

/** 次要小按钮（handoff §5）— 记录卡与工具列共用。 */
const smallBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  fontSize: scaledFs(11),
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-input)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

function formatDuration(seconds: number): string {
  if (seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Per-task card ──

function HistoryCard({ item, useStore }: { item: VideoHistoryItem; useStore: VideoStoreHook }) {
  const { t } = useOptionalI18n()
  const { setCurrentTask, setCurrentVideoUrl } = useStore()
  const [exporting, setExporting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadingFrame, setDownloadingFrame] = useState(false)
  // window.confirm → ConfirmModal（与图片页删除记录一致）
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 「详情」展开：默认收起，点开才显示完整 prompt 与全部参数，避免列表过长。
  const [showDetails, setShowDetails] = useState(false)

  // 参数优先读 item 摊平字段，缺的再回填 requestContent（导入任务常只有后者）。
  const rc = item.requestContent
  const paramRows: Array<[string, string]> = []
  const pushParam = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== null && value !== '') {
      paramRows.push([key, String(value)])
    }
  }
  pushParam('model', item.model ?? rc?.model)
  pushParam('ratio', item.ratio ?? rc?.ratio)
  pushParam('resolution', item.resolution ?? rc?.resolution)
  const durationValue = item.duration ?? rc?.duration
  pushParam('duration', durationValue === -1 ? 'Auto' : durationValue === undefined ? undefined : `${durationValue}s`)
  pushParam('fps', item.fps)
  pushParam('seed', item.seed ?? rc?.seed)
  const expiresValue = item.executionExpiresAfter ?? rc?.execution_expires_after
  pushParam('execution_expires_after', expiresValue === undefined ? undefined : `${expiresValue}s`)

  const isLive = item.status === 'queued' || item.status === 'running'
  const now = useNow(isLive ? 1000 : 0)
  const elapsed = isLive
    ? Math.max(0, now / 1000 - item.createdAt)
    : item.updatedAt
      ? Math.max(0, item.updatedAt - item.createdAt)
      : 0

  const handleExport = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setExporting(true)
    try {
      const { bytes, missing } = await buildBundleZip(item)
      downloadBlob(new Blob([new Uint8Array(bytes) as BlobPart], { type: 'application/zip' }), `${item.taskId}.zip`)
      if (missing.length > 0) {
        toast.success(t('video.toast.exportedZipMissing', { taskId: item.taskId, count: missing.length }))
      } else {
        toast.success(t('video.toast.exportedZip', { taskId: item.taskId }))
      }
    } catch (err) {
      toast.error(t('video.toast.exportFailed', { message: (err as Error).message }))
    } finally {
      setExporting(false)
    }
  }, [item, t])

  const handleDownloadMp4 = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.videoUrl) return
    setDownloading(true)
    try {
      const blob = await downloadAssetBlob(item.videoUrl, `${item.taskId}.mp4`)
      downloadBlob(blob, `${item.taskId}.mp4`)
      toast.success(t('video.toast.downloadedMp4', { taskId: item.taskId }))
    } catch (err) {
      toast.error(t('video.toast.downloadFailed', { message: (err as Error).message }))
    } finally {
      setDownloading(false)
    }
  }, [item, t])

  const handleDownloadFrame = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.lastFrameUrl) return
    setDownloadingFrame(true)
    try {
      const blob = await downloadAssetBlob(item.lastFrameUrl, `${item.taskId}.png`)
      downloadBlob(blob, `${item.taskId}.png`)
      toast.success(t('video.toast.downloadedFrame', { taskId: item.taskId }))
    } catch (err) {
      toast.error(t('video.toast.downloadFrameFailed', { message: (err as Error).message }))
    } finally {
      setDownloadingFrame(false)
    }
  }, [item, t])

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 6,
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onClick={() => {
        // Always select this task in the preview panel
        const src = item.objectUrl || item.videoUrl || null
        setCurrentTask(item.taskId)
        setCurrentVideoUrl(src)
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <StatusPill kind={statusKind(item.status)} label={statusLabel(item.status, t)} />
          {(isLive || (elapsed > 0 && item.status === 'succeeded')) && (
            <span style={{ fontSize: scaledFs(11), color: 'var(--text-muted)' }}>
              {formatDuration(elapsed)}
            </span>
          )}
          {item.orphaned && (
            <span
              data-testid="orphaned-tag"
              style={{
                fontSize: scaledFs(10),
                padding: '2px 5px',
                borderRadius: 6,
                background: 'var(--bg-input)',
                color: 'var(--warning)',
                border: '1px solid var(--warning)',
              }}
              title={t('video.history.orphanedTitle')}
            >
              {t('video.history.orphaned')}
            </span>
          )}
          {item.imported && (
            <span
              data-testid="imported-tag"
              style={{
                fontSize: scaledFs(10),
                padding: '2px 5px',
                borderRadius: 6,
                background: 'var(--bg-input)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              title={t('video.history.importedTitle')}
            >
              {t('video.history.imported')}
            </span>
          )}
          {item.originalPrompt && (
            <span
              data-testid="optimized-tag"
              title={t('video.history.optimizedTitle', { prompt: item.originalPrompt })}
              style={{
                fontSize: scaledFs(10),
                padding: '2px 5px',
                borderRadius: 6,
                background: 'var(--bg-input)',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
              }}
            >
              {t('video.history.optimized')}
            </span>
          )}
        </div>
        <span style={{ fontSize: scaledFs(11), color: 'var(--text-muted)' }}>
          {new Date(item.createdAt * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Prompt */}
      <div style={{
        fontSize: scaledFs(12), color: 'var(--text-secondary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {item.prompt}
      </div>

      {/* Meta */}
      {item.status === 'succeeded' && (
        <div style={{ fontSize: scaledFs(11), color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
          {item.duration && <span>{item.duration}s</span>}
          {item.resolution && <span>{item.resolution}</span>}
          {item.seed && <span>seed:{item.seed}</span>}
          {item.objectUrl && (
            <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--success)' }} />
              {t('video.preview.local')}
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {item.error && (
        <div style={{
          fontSize: scaledFs(11), color: 'var(--danger)', marginTop: 4,
          wordBreak: 'break-word',
        }}>
          {item.error}
        </div>
      )}

      {/* 详情面板：完整 prompt、优化前原文、以及全部送出的参数。
          stopPropagation 让面板内的点击不会误触卡片选择。 */}
      {showDetails && (
        <div
          data-testid="task-details"
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 8,
            padding: 8,
            borderRadius: 6,
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            cursor: 'default',
          }}
        >
          <div>
            <div style={{ fontSize: scaledFs(10), color: 'var(--text-muted)', marginBottom: 2 }}>Prompt</div>
            <div style={{ fontSize: scaledFs(12), color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {item.prompt}
            </div>
          </div>

          {item.originalPrompt && (
            <div>
              <div style={{ fontSize: scaledFs(10), color: 'var(--text-muted)', marginBottom: 2 }}>{t('video.history.originalPrompt')}</div>
              <div style={{ fontSize: scaledFs(12), color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {item.originalPrompt}
              </div>
            </div>
          )}

          {paramRows.length > 0 && (
            <div>
              <div style={{ fontSize: scaledFs(10), color: 'var(--text-muted)', marginBottom: 2 }}>{t('video.history.params')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 8, rowGap: 2 }}>
                {paramRows.map(([k, v]) => (
                  <Fragment key={k}>
                    <span style={{ fontSize: scaledFs(11), color: 'var(--text-muted)' }}>{k}</span>
                    <span style={{ fontSize: scaledFs(11), color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{v}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation()
              void copyWithToast('Prompt', item.prompt)
            }}
            style={{ ...smallBtnStyle, alignSelf: 'flex-start' }}
          >
            <Icon name="copy" size={11} />
            {t('video.history.copyPrompt')}
          </button>
        </div>
      )}

      {/* 动作列（handoff §B6）：详情展开；succeeded 常驻 下载 mp4 / 复制 URL；
          queued 常驻 取消任务；其余动作收进 ⋯ 选单。 */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowDetails((v) => !v)
          }}
          aria-expanded={showDetails}
          style={smallBtnStyle}
        >
          <Icon name={showDetails ? 'chevron-down' : 'chevron-right'} size={11} />
          {t('video.history.details')}
        </button>
        {item.status === 'succeeded' && item.videoUrl && (
          <>
            <button
              onClick={handleDownloadMp4}
              disabled={downloading}
              style={{ ...smallBtnStyle, cursor: downloading ? 'wait' : 'pointer' }}
            >
              <Icon name="download" size={11} />
              {downloading ? t('video.history.downloading') : t('video.history.downloadMp4')}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                void copyWithToast(t('video.preview.videoUrl'), item.videoUrl)
              }}
              style={smallBtnStyle}
            >
              <Icon name="copy" size={11} />
              {t('video.history.copyUrl')}
            </button>
          </>
        )}

        {item.status === 'queued' && (
          <button
            onClick={async (e) => {
              e.stopPropagation()
              try {
                await deleteVideoTask(item.taskId)
                const { removeActiveTask, updateHistory } = useStore.getState()
                removeActiveTask(item.taskId)
                updateHistory(item.taskId, { status: 'cancelled', updatedAt: Date.now() / 1000 })
                toast.success(t('video.toast.cancelSent'))
              } catch (err) {
                toast.error(t('video.toast.cancelFailed', { message: (err as Error).message }))
              }
            }}
            aria-label={t('video.history.cancelTask')}
            style={{ ...smallBtnStyle, color: 'var(--warning)' }}
          >
            {t('video.history.cancelTask')}
          </button>
        )}

        <span style={{ flex: 1 }} />

        {item.status !== 'queued' && (
          <OverflowMenu>
            {(close) => (
              <>
                {/* 所有非 queued 状态都可导出 — task.json 保留参数，失败/过期
                    任务靠它留档回填（buildBundleZip 容忍素材缺失）。 */}
                <button
                  onClick={(e) => {
                    close()
                    void handleExport(e)
                  }}
                  disabled={exporting}
                  style={overflowMenuItemStyle}
                >
                  {exporting ? t('video.history.exporting') : t('video.history.exportZip')}
                </button>
                {item.status === 'succeeded' && item.lastFrameUrl && (
                  <button
                    data-testid="download-frame-button"
                    onClick={(e) => {
                      close()
                      void handleDownloadFrame(e)
                    }}
                    disabled={downloadingFrame}
                    style={overflowMenuItemStyle}
                  >
                    {downloadingFrame ? t('video.history.downloading') : t('video.history.downloadFrame')}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                    void copyWithToast('Task ID', item.taskId)
                  }}
                  style={overflowMenuItemStyle}
                >
                  {t('video.history.copyTaskId')}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                    setConfirmDelete(true)
                  }}
                  aria-label={t('video.history.deleteRecord')}
                  style={{ ...overflowMenuItemStyle, color: 'var(--danger)' }}
                >
                  {t('video.history.deleteRecord')}
                </button>
              </>
            )}
          </OverflowMenu>
        )}
      </div>

      {/* 删除确认 — 与图片页一致改用 ConfirmModal（原为 window.confirm） */}
      <ConfirmModal
        open={confirmDelete}
        title={t('video.history.deleteTitle')}
        subtitle={t('video.history.deleteSubtitle', { taskId: item.taskId })}
        confirmLabel={t('video.history.deleteConfirm')}
        variant="danger"
        onConfirm={() => {
          useStore.getState().removeHistory(item.taskId)
          setConfirmDelete(false)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}

// ── Main history panel ──

interface VideoHistoryProps {
  /** Optional override; falls back to VIDEO_HISTORY_DEFAULT_WIDTH. */
  width?: number
  /** 读写来源 store；默认 2.0 的 useVideoStore（既有行为不变）。 */
  useStore?: VideoStoreHook
}

async function readEntriesAsFiles(entry: FileSystemEntry, basePath: string): Promise<File[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file: File = await new Promise((resolve, reject) =>
      fileEntry.file(resolve, reject),
    )
    Object.defineProperty(file, 'webkitRelativePath', {
      value: basePath ? `${basePath}/${entry.name}` : entry.name,
      configurable: true,
    })
    return [file]
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    // readEntries() returns one batch at a time (~100 entries in Chrome). Loop
    // until the batch is empty to avoid silently dropping files in large dirs.
    const children: FileSystemEntry[] = []
    for (;;) {
      const batch: FileSystemEntry[] = await new Promise((resolve, reject) =>
        reader.readEntries(resolve, reject),
      )
      if (batch.length === 0) break
      children.push(...batch)
    }
    const nextBase = basePath ? `${basePath}/${entry.name}` : entry.name
    const nested = await Promise.all(children.map((c) => readEntriesAsFiles(c, nextBase)))
    return nested.flat()
  }
  return []
}

function ImportDropZone({
  onImport,
  disabled,
}: {
  onImport: (files: File[]) => Promise<void>
  disabled: boolean
}) {
  const { t } = useOptionalI18n()
  const [hover, setHover] = useState(false)

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setHover(false)
    if (disabled) return
    const items = e.dataTransfer.items
    const collected: File[] = []
    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const entry = item.webkitGetAsEntry()
      if (entry) entries.push(entry)
      else if (item.kind === 'file') {
        // Fallback for browsers without webkitGetAsEntry (rare)
        const f = item.getAsFile()
        if (f) collected.push(f)
      }
    }
    const fromEntries = await Promise.all(entries.map((en) => readEntriesAsFiles(en, '')))
    await onImport([...collected, ...fromEntries.flat()])
  }, [onImport, disabled])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setHover(true) }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      style={{
        marginBottom: 12,
        padding: '12px 8px',
        border: `1.5px dashed ${hover ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 6,
        textAlign: 'center',
        fontSize: 11,
        color: 'var(--text-muted)',
        background: hover ? 'var(--bg-input)' : 'transparent',
        cursor: disabled ? 'wait' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      {t('video.history.dropzone')}
    </div>
  )
}

export default function VideoHistory({ width = VIDEO_HISTORY_DEFAULT_WIDTH, useStore = useVideoStore }: VideoHistoryProps = {}) {
  const { t } = useOptionalI18n()
  const { history, addHistory } = useStore()
  const [importing, setImporting] = useState(false)
  const [batchExporting, setBatchExporting] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  // Two hidden inputs because browser file pickers are exclusive:
  // webkitdirectory shows folders only; accept=".zip" shows files only.
  // We can't unify them in one picker — see Phase-4 discussion.
  const folderInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  // Show every history item regardless of age — the previous "近期生成
  // (2 小时内)" cap created confusion when imported tasks fell outside it.
  const succeededItems = history.filter((h) => h.status === 'succeeded')

  const handleBatchExport = useCallback(async () => {
    if (succeededItems.length === 0) {
      toast.error(t('video.toast.noCompletedTasks'))
      return
    }
    setBatchExporting(true)
    try {
      const { bytes, missing, perTaskMissing } = await buildBatchBundleZip(succeededItems)
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      downloadBlob(
        new Blob([new Uint8Array(bytes) as BlobPart], { type: 'application/zip' }),
        `tasks-bundle-${ts}.zip`,
      )
      const sharedMissing = missing.length
      const taskMissingCount = Object.values(perTaskMissing).reduce((sum, arr) => sum + arr.length, 0)
      if (sharedMissing + taskMissingCount > 0) {
        toast.success(t('video.toast.batchExportedMissing', {
          count: succeededItems.length,
          missing: sharedMissing + taskMissingCount,
        }))
      } else {
        toast.success(t('video.toast.batchExported', { count: succeededItems.length }))
      }
    } catch (err) {
      toast.error(t('video.toast.batchExportFailed', { message: (err as Error).message }))
    } finally {
      setBatchExporting(false)
    }
  }, [succeededItems, t])

  // Shared pipeline: accept a flat File[] (from webkitdirectory or drop) and
  // add resulting tasks to history. Each task's binaries become object URLs.
  const importFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setImporting(true)
    let imported = 0
    let skipped = 0
    const existingIds = new Set(useStore.getState().history.map((h) => h.taskId))
    const addedItems: VideoHistoryItem[] = []

    try {
      // Detect single zip drop vs. folder selection
      const zips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'))
      const folderFiles = files.filter((f) => !f.name.toLowerCase().endsWith('.zip'))

      const parsedTasks = [
        ...(await parseTaskFolder(folderFiles)),
        ...(await Promise.all(zips.map((z) => parseTaskZip(z)))).flat(),
      ]

      for (const parsed of parsedTasks) {
        const item = await toHistoryItem(parsed)
        if (!item.taskId) {
          // The blobs created by toHistoryItem are unreachable now — free them
          // before the item is dropped on the floor.
          revokeImportedUrls(item)
          toast.error(t('video.toast.invalidTaskJson'))
          continue
        }
        if (existingIds.has(item.taskId)) {
          // Same: the duplicate's blob URLs would otherwise be stranded.
          revokeImportedUrls(item)
          skipped++
          continue
        }
        addHistory(item)
        addedItems.push(item)
        existingIds.add(item.taskId)
        imported++
      }

      const previewable = [...addedItems].reverse().find((m) => m.objectUrl || m.videoUrl)
      if (previewable) {
        const { setCurrentTask, setCurrentVideoUrl } = useStore.getState()
        setCurrentTask(previewable.taskId)
        setCurrentVideoUrl(previewable.objectUrl ?? previewable.videoUrl ?? null)
      }

      const parts: string[] = []
      if (imported > 0) parts.push(t('video.toast.importedCount', { count: imported }))
      if (skipped > 0) parts.push(t('video.toast.skippedCount', { count: skipped }))
      if (parts.length > 0) toast.success(parts.join(t('common.listSeparator')))
      else toast(t('video.toast.importNone'))
    } catch (err) {
      toast.error(t('video.toast.importFailed', { message: (err as Error).message }))
    } finally {
      setImporting(false)
    }
  }, [addHistory, t, useStore])

  const handleFolderImportClick = useCallback(() => {
    folderInputRef.current?.click()
  }, [])

  const handleZipImportClick = useCallback(() => {
    zipInputRef.current?.click()
  }, [])

  const handleFolderSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await importFiles(Array.from(files))
    if (folderInputRef.current) folderInputRef.current.value = ''
  }, [importFiles])

  const handleZipSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await importFiles(Array.from(files))
    if (zipInputRef.current) zipInputRef.current.value = ''
  }, [importFiles])

  const panelScale = computePanelScale(width, VIDEO_HISTORY_DEFAULT_WIDTH)
  const panelStyle: CSSProperties = {
    width,
    flexShrink: 0,
    borderLeft: '1px solid var(--border)',
    overflowY: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    ['--panel-scale' as unknown as keyof CSSProperties]: panelScale,
  } as CSSProperties

  return (
    <div className="resizable-panel" style={panelStyle}>
      {/* Header — 栏标题两级制（handoff §4）：14px/600 text-primary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: scaledFs(14), fontWeight: 600, color: 'var(--text-primary)' }}>
        {t('video.history.title')}
      </div>

      {/* Hidden folder picker. Browsers select one folder per click; the
       *  parent-folder pattern lets the user pick a folder containing N task
       *  subfolders. To import multiple separate task folders at once, the
       *  drag-drop zone below is the answer. */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error — webkitdirectory is a non-standard but cross-browser attribute
        webkitdirectory=""
        directory=""
        style={{ display: 'none' }}
        onChange={handleFolderSelected}
      />

      {/* Hidden .zip picker — separate input because the browser file-picker
       *  API is exclusive: a webkitdirectory input shows folders only, an
       *  accept-filtered input shows files only. They cannot be unified. */}
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        multiple
        style={{ display: 'none' }}
        onChange={handleZipSelected}
      />

      {/* Drop zone — accepts one or many task folders dragged from the OS
       *  file manager, or .zip files. Folders are traversed via
       *  webkitGetAsEntry. */}
      <ImportDropZone onImport={importFiles} disabled={importing} />

      {/* Batch action buttons — 导出全部 + 导入（小选单：数据夹 / .zip） */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          onClick={handleBatchExport}
          disabled={batchExporting || succeededItems.length === 0}
          style={{ ...smallBtnStyle, flex: 1, justifyContent: 'center', padding: '6px 8px' }}
        >
          <Icon name="download" size={11} />
          {batchExporting ? t('video.history.exporting') : t('video.history.exportAll', { count: succeededItems.length })}
        </button>
        <div
          style={{ position: 'relative', flex: 1 }}
          onMouseLeave={() => setImportMenuOpen(false)}
        >
          <button
            onClick={() => setImportMenuOpen((v) => !v)}
            disabled={importing}
            aria-expanded={importMenuOpen}
            style={{ ...smallBtnStyle, width: '100%', justifyContent: 'center', padding: '6px 8px' }}
          >
            <Icon name="upload" size={11} />
            {importing ? t('video.history.importing') : t('video.history.import')}
          </button>
          {importMenuOpen && (
            <div style={{ ...overflowMenuContainerStyle, left: 0, right: 0, minWidth: 0 }}>
              <button
                onClick={() => {
                  setImportMenuOpen(false)
                  handleFolderImportClick()
                }}
                style={overflowMenuItemStyle}
              >
                {t('video.history.folder')}
              </button>
              <button
                onClick={() => {
                  setImportMenuOpen(false)
                  handleZipImportClick()
                }}
                style={overflowMenuItemStyle}
              >
                .zip
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Task list */}
      {history.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)', fontSize: scaledFs(13) }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 8, opacity: 0.4 }}>
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <path d="M10 8l6 4-6 4V8z" />
          </svg>
          <div>{t('video.history.empty')}</div>
          <div style={{ marginTop: 8, fontSize: scaledFs(11) }}>{t('video.history.emptyHint')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.map((item) => (
            <HistoryCard key={item.taskId} item={item} useStore={useStore} />
          ))}
        </div>
      )}
    </div>
  )
}
