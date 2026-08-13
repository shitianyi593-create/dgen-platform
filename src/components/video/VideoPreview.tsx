import { useMemo } from 'react'
import { useVideoStore, type VideoStoreHook } from '../../stores/videoStore'
import UrlPanel from '../common/UrlPanel'
import type { UrlPanelRow } from '../common/UrlPanel'
import { Icon } from '../common/icons'

interface VideoPreviewProps {
  /** 讀取來源 store；預設 2.0 的 useVideoStore（既有行為不變）。 */
  useStore?: VideoStoreHook
}

export default function VideoPreview({ useStore = useVideoStore }: VideoPreviewProps = {}) {
  const { currentVideoUrl, currentTaskId, activeTaskIds, history } = useStore()

  // Prefer local video path over remote URL
  const currentItem = useMemo(
    () => (currentTaskId ? history.find((h) => h.taskId === currentTaskId) : undefined),
    [currentTaskId, history],
  )
  // Source priority: in-memory imported blob → live signed videoUrl (set by
  // the background poller when a fresh task succeeds) → currentVideoUrl
  // (set on explicit card click). The middle fallback is what makes the
  // preview auto-update when a poll cycle marks the current task succeeded.
  const videoSrc = currentItem?.objectUrl || currentItem?.videoUrl || currentVideoUrl
  const isLocal = !!currentItem?.objectUrl && videoSrc === currentItem.objectUrl
  const lastFrameSrc = currentItem?.frameObjectUrl || currentItem?.lastFrameUrl

  // Active task details for the status panel
  const activeTasks = useMemo(
    () => activeTaskIds.map((id) => {
      const h = history.find((hi) => hi.taskId === id)
      return { id, status: h?.status ?? 'queued', prompt: h?.prompt ?? '' }
    }),
    [activeTaskIds, history],
  )

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      padding: 24,
      overflow: 'auto',
    }}>
      <h2 style={{
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 16,
        marginTop: 0,
      }}>
        生成的影片
      </h2>

      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        minHeight: 300,
        position: 'relative',
      }}>
        {videoSrc ? (
          <video
            key={videoSrc}
            controls
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              borderRadius: 8,
            }}
          >
            <source src={videoSrc} />
            您的瀏覽器不支援影片播放。
          </video>
        ) : currentItem && (currentItem.status === 'queued' || currentItem.status === 'running') ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div className="spinner" style={{ width: 40, height: 40, marginBottom: 16 }} />
            <div style={{ fontSize: 15 }}>正在生成影片...</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              任務 ID: {currentItem.taskId}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              狀態: {currentItem.status === 'running' ? '處理中' : '排隊中'}
            </div>
          </div>
        ) : currentItem && currentItem.status === 'failed' ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
            <div style={{ marginBottom: 12, opacity: 0.5 }}>
              <Icon name="alert-triangle" size={32} />
            </div>
            <div style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 8 }}>生成失敗</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-word', maxWidth: 400 }}>
              {currentItem.error || '未知錯誤'}
            </div>
          </div>
        ) : activeTasks.length > 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div className="spinner" style={{ width: 40, height: 40, marginBottom: 16 }} />
            <div style={{ fontSize: 15 }}>正在生成影片...</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              {activeTasks.length} 個任務進行中
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, opacity: 0.5 }}>
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <path d="M10 8l6 4-6 4V8z" />
            </svg>
            <div style={{ fontSize: 14 }}>生成的影片將顯示於此。</div>
          </div>
        )}
      </div>

      {/* Video info bar */}
      {videoSrc && (
        <div style={{
          display: 'flex',
          gap: 16,
          marginTop: 12,
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          borderRadius: 6,
          border: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{currentTaskId && `任務: ${currentTaskId}`}</span>
            {isLocal && (
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--success-bg)', color: 'var(--success)' }}>
                本地
              </span>
            )}
          </div>
          <a
            href={videoSrc}
            target="_blank"
            rel="noopener noreferrer"
            download
            style={{
              color: 'var(--accent)',
              textDecoration: 'none',
              fontSize: 13,
            }}
          >
            下載影片
          </a>
        </div>
      )}

      {/* Last frame preview — appears below the video info bar so users can
          eyeball whether it's a usable handoff for the next clip. */}
      {lastFrameSrc && (
        <div
          data-testid="last-frame-section"
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--bg-secondary)',
            borderRadius: 6,
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
              尾幀圖（last frame）
            </div>
            <a
              href={lastFrameSrc}
              target="_blank"
              rel="noopener noreferrer"
              download
              style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12 }}
            >
              下載尾幀
            </a>
          </div>
          <img
            src={lastFrameSrc}
            alt="last frame"
            style={{
              maxWidth: '100%',
              maxHeight: 240,
              borderRadius: 6,
              display: 'block',
              margin: '0 auto',
            }}
          />
        </div>
      )}

      {/* URL panel — copy-able links the user can paste back into Asset
          參考 to chain a follow-up generation.（共用 UrlPanel 元件） */}
      {currentItem && (currentItem.videoUrl || currentItem.lastFrameUrl) && (
        <div data-testid="url-section" style={{ marginTop: 12 }}>
          <UrlPanel
            rows={[
              ...(currentItem.videoUrl
                ? [{ label: '影片 URL', url: currentItem.videoUrl, testId: 'video-url-row' } satisfies UrlPanelRow]
                : []),
              ...(currentItem.lastFrameUrl
                ? [{ label: '尾幀 URL', url: currentItem.lastFrameUrl, testId: 'last-frame-url-row' } satisfies UrlPanelRow]
                : []),
            ]}
            hint="可貼到左側「Asset 參考」欄位作為下一個任務的輸入。"
          />
        </div>
      )}

      {/* Active tasks status bar */}
      {activeTasks.length > 0 && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          borderRadius: 6,
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
            進行中的任務 ({activeTasks.length})
          </div>
          {activeTasks.map((t) => (
            <div key={t.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              fontSize: 11,
              color: 'var(--text-muted)',
            }}>
              <span className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />
              <span style={{
                color: t.status === 'running' ? 'var(--accent)' : 'var(--warning)',
                width: 40, flexShrink: 0,
              }}>
                {t.status === 'running' ? '處理中' : '排隊中'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.prompt.slice(0, 40)}{t.prompt.length > 40 ? '...' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
