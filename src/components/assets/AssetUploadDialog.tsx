import { useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AssetGroup, AssetTypeApi } from '../../types/asset'
import {
  validateAudioBasic,
  validateImageBasic,
  validateVideoBasic,
} from '../../utils/mediaValidation'
import { Icon } from '../common/icons'

interface PendingItem {
  file: File
  assetType: AssetTypeApi
  errors: string[]
}

interface Props {
  groups: AssetGroup[]
  defaultGroupId: string | null
  onClose: () => void
  /**
   * Hand off the entire batch in one call. The dialog does NOT await
   * this Promise — it dispatches and closes immediately; the page is
   * responsible for rendering in-flight progress via assetStore.uploads.
   */
  onUpload: (
    inputs: Array<{
      file: File
      assetType: AssetTypeApi
      groupId: string
    }>,
  ) => Promise<void>
}

function detectType(file: File): AssetTypeApi {
  if (file.type.startsWith('image/')) return 'Image'
  if (file.type.startsWith('video/')) return 'Video'
  return 'Audio'
}

function validate(file: File, t: AssetTypeApi): string[] {
  if (t === 'Image') return validateImageBasic(file).errors
  if (t === 'Video') return validateVideoBasic(file).errors
  return validateAudioBasic(file).errors
}

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

export default function AssetUploadDialog(props: Props) {
  const { groups, defaultGroupId, onClose, onUpload } = props
  // The dialog is mounted/unmounted by the parent so first-mount state
  // initialisers replace what used to be a reset-on-close effect.
  const [groupId, setGroupId] = useState<string>(defaultGroupId ?? '')
  const [items, setItems] = useState<PendingItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validCount = useMemo(
    () => items.filter((i) => i.errors.length === 0).length,
    [items],
  )

  function onFilesPicked(files: FileList | null) {
    if (!files) return
    const next: PendingItem[] = []
    for (const f of Array.from(files)) {
      const t = detectType(f)
      next.push({ file: f, assetType: t, errors: validate(f, t) })
    }
    setItems((prev) => [...prev, ...next])
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function startUpload() {
    const valid = items.filter((it) => it.errors.length === 0)
    if (valid.length === 0 || !groupId) return
    // Fire-and-forget: the in-flight uploads are tracked by the page
    // via `useAssetJobToasts` reading from `assetStore.uploads`. The
    // user gets their dialog back immediately so they can pick more.
    const inputs = valid.map((it) => ({
      file: it.file,
      assetType: it.assetType,
      groupId,
    }))
    void onUpload(inputs)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--bg-secondary)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>上传资产</h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={onClose}
            style={{ width: 28, height: 28 }}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        {/* body */}
        <div
          style={{
            padding: 20,
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* group selector */}
          <div>
            <label style={fieldLabel}>目标群组</label>
            <select
              className="select-field"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              style={{ width: '100%' }}
            >
              {groups.length === 0 && (
                <option value="">尚无群组 — 先到左侧创建</option>
              )}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* file picker */}
          <div>
            <label style={fieldLabel}>选择文件</label>
            <input
              data-testid="upload-file-input"
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              onChange={(e) => {
                onFilesPicked(e.target.files)
                // allow re-selecting the same file later
                e.target.value = ''
              }}
              className="sr-only"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={pickButtonStyle}
              >
                📂 从电脑选择…
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {items.length === 0
                  ? '尚未选择任何文件'
                  : `已选 ${items.length} 个文件${
                      validCount === items.length
                        ? ''
                        : `（${validCount} 个可上传）`
                    }`}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              支持 图片 ≤30 MB / 视频 ≤50 MB / 音频 ≤15 MB
            </div>
          </div>

          {/* file list */}
          {items.length > 0 && (
            <div
              style={{
                borderRadius: 6,
                border: '1px solid var(--border)',
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              {items.map((it, idx) => {
                const ok = it.errors.length === 0
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '8px 12px',
                      borderBottom:
                        idx === items.length - 1
                          ? 'none'
                          : '1px solid var(--border)',
                      background: ok ? 'transparent' : 'rgba(220,38,38,0.06)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span style={typeChip(it.assetType)}>
                        {it.assetType.toUpperCase()}
                      </span>
                      <span
                        title={it.file.name}
                        style={{
                          flex: 1,
                          fontSize: 13,
                          fontFamily: 'ui-monospace, monospace',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {it.file.name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          fontVariantNumeric: 'tabular-nums',
                          flexShrink: 0,
                        }}
                      >
                        {fmtMB(it.file.size)} MB
                      </span>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label="移除"
                        onClick={() => removeItem(idx)}
                        style={{ flexShrink: 0 }}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                    {it.errors.map((e, i) => (
                      <span
                        key={i}
                        style={{
                          color: 'var(--error, #dc2626)',
                          fontSize: 12,
                          marginLeft: 56,
                          marginTop: 2,
                        }}
                      >
                        ⚠ {e}
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* footer */}
        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={secondaryButtonStyle}
          >
            取消
          </button>
          <button
            type="button"
            onClick={startUpload}
            disabled={validCount === 0 || !groupId}
            style={primaryButtonStyle(validCount === 0 || !groupId)}
          >
            开始上传{validCount > 0 ? `（${validCount}）` : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}

const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
}

const pickButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 13,
}

const secondaryButtonStyle: CSSProperties = {
  padding: '8px 18px',
  minWidth: 80,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 13,
}

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    padding: '8px 18px',
    minWidth: 130,
    borderRadius: 6,
    border: 'none',
    background: 'var(--accent, #3b82f6)',
    color: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontSize: 13,
    fontWeight: 500,
  }
}

function typeChip(t: AssetTypeApi): CSSProperties {
  const color = t === 'Audio' ? '#34d399' : '#a78bfa'
  return {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 1,
    padding: '2px 6px',
    borderRadius: 6,
    color: '#fff',
    background: 'rgba(0,0,0,0.5)',
    border: `1px solid ${color}`,
    flexShrink: 0,
  }
}
