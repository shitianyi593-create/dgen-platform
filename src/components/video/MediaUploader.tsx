import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { Icon } from '../common/icons'
import { useOptionalI18n } from '../../i18n/useOptionalI18n'
import type { LocalMedia, ImageRole } from '../../types'
import {
  validateAudioBasic,
  validateImageBasic,
  validateVideoBasic,
  type ValidationResult,
} from '../../utils/mediaValidation'
import type { MessageKey } from '../../i18n/locales'

interface Props {
  label: string
  accept: Record<string, string[]>
  items: LocalMedia[]
  maxItems: number
  onAdd: (m: LocalMedia) => void
  onRemove: (idx: number) => void
  hint?: string
  /** Optional `[Image 1] / [Video 1] / [Audio 1]`-style labels to overlay on
   *  each thumbnail. Length should match `items`; missing entries render no
   *  badge. */
  labels?: string[]
  /** When true, the dropzone is disabled and the hint below is shown. */
  disabled?: boolean
  /** Message shown in the dropzone area when `disabled` is true. */
  disabledHint?: string
  /** When provided, each badge becomes a clickable button that fires this
   *  callback with the label string (e.g. `[Image 1]`). When omitted, the
   *  badge is a non-interactive div (backward-compatible). */
  onLabelClick?: (label: string) => void
  /** Optional short role labels overlaid on each thumb (e.g. `1ST` / `LAST`
   *  / `REF`). Index-aligned with `items`. */
  roleBadges?: string[]
  /** Indices of thumbs that violate current mode constraints — rendered with
   *  a danger-coloured outline + tint. */
  incompatibleIdx?: number[]
  /** When true, render a per-thumb role `<select>` below each thumb. */
  showRoleDropdown?: boolean
  /** Allowed role values for the dropdown (in display order). Defaults to
   *  `['first_frame', 'last_frame']`. */
  roleChoices?: ImageRole[]
  /** Fires when the user picks a new role from the dropdown. */
  onRoleChange?: (idx: number, role: ImageRole) => void
  /** When true, the dropzone is replaced with a lock overlay and existing
   *  items are visually muted. Used when the active mode forbids this media
   *  type entirely (e.g. first_frame / first_last_frame disallow video). */
  locked?: boolean
  /** Message shown in the lock overlay when `locked` is true. */
  lockedHint?: string
}

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

function allowedExtensions(accept: Record<string, string[]>): string {
  const exts = Object.values(accept)
    .flat()
    .map((ext) => ext.replace(/^\./, ''))
    .filter(Boolean)
  return exts.join(', ')
}

function validationErrorMessage(
  file: File,
  result: ValidationResult,
  accept: Record<string, string[]>,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
) {
  const firstError = result.errors[0] ?? ''
  if (firstError.includes('不支持的文件格式')) {
    return t('video.validation.unsupportedFormat', {
      fileName: file.name,
      extensions: allowedExtensions(accept),
    })
  }
  if (file.type.startsWith('image/')) {
    return t('video.validation.imageTooLarge', { fileName: file.name, size: fmtMB(file.size) })
  }
  if (file.type.startsWith('video/')) {
    return t('video.validation.videoTooLarge', { fileName: file.name, size: fmtMB(file.size) })
  }
  if (file.type.startsWith('audio/')) {
    return t('video.validation.audioTooLarge', { fileName: file.name, size: fmtMB(file.size) })
  }
  return firstError || t('video.validation.invalidFile', { fileName: file.name })
}

export default function MediaUploader({
  label,
  accept,
  items,
  maxItems,
  onAdd,
  onRemove,
  hint,
  labels,
  disabled,
  disabledHint,
  onLabelClick,
  roleBadges,
  incompatibleIdx,
  showRoleDropdown,
  roleChoices,
  onRoleChange,
  locked,
  lockedHint,
}: Props) {
  const { t } = useOptionalI18n()
  const onDrop = useCallback(
    (files: File[]) => {
      const remaining = maxItems - items.length
      files.slice(0, remaining).forEach((file) => {
        // Pre-flight validation matches the BytePlus ARK Asset library
        // single-file rules (format + size). Multi-file aggregate rules
        // (total duration ≤ 15s, etc.) stay in videoStore /
        // useVideoGeneration where they have access to the full set.
        let result: ValidationResult = { ok: true, errors: [] }
        if (file.type.startsWith('image/')) result = validateImageBasic(file)
        else if (file.type.startsWith('video/')) result = validateVideoBasic(file)
        else if (file.type.startsWith('audio/')) result = validateAudioBasic(file)

        if (!result.ok) {
          toast.error(validationErrorMessage(file, result, accept, t))
          return
        }
        const preview = URL.createObjectURL(file)
        onAdd({ file, preview, uploading: false })
      })
    },
    [accept, items.length, maxItems, onAdd, t],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    disabled: disabled || locked || items.length >= maxItems,
  })

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="label" style={{ margin: 0 }}>
          {label} <span style={{ color: 'var(--text-muted)' }}>({items.length}/{maxItems})</span>
        </span>
      </div>

      {/* Thumbnails */}
      {items.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 8,
          opacity: locked ? 0.4 : 1,
          pointerEvents: locked ? 'none' : 'auto',
        }}>
          {items.map((item, idx) => {
            const incompat = !!incompatibleIdx?.includes(idx)
            return (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
            <div
              data-testid={`thumb-${idx}`}
              data-incompat={incompat ? 'true' : 'false'}
              style={{
                position: 'relative',
                width: 64,
                height: 64,
                borderRadius: 6,
                overflow: 'hidden',
                border: incompat ? '2px solid var(--danger)' : '1px solid var(--border)',
                background: incompat ? 'rgba(248, 81, 73, 0.08)' : 'var(--bg-input)',
              }}
            >
              {item.stale ? (
                <div
                  data-testid="stale-thumbnail"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    padding: 4,
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                    wordBreak: 'break-all',
                  }}
                  title={t('video.uploader.staleTitle')}
                >
                  <Icon name="image" size={16} />
                  <div style={{ marginTop: 2, opacity: 0.9 }}>
                    {(item.filename ?? '').slice(0, 12)}
                  </div>
                  <div style={{ marginTop: 2, color: 'var(--warning)', fontSize: 9 }}>
                    {t('video.uploader.stale')}
                  </div>
                </div>
              ) : item.file?.type.startsWith('image/') ? (
                <img
                  src={item.preview}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : item.file?.type.startsWith('video/') ? (
                <video
                  src={item.preview}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  padding: 4,
                  textAlign: 'center',
                  wordBreak: 'break-all',
                }}>
                  {(item.filename ?? item.file?.name ?? '').slice(0, 12)}
                </div>
              )}

              {item.uploading && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span className="spinner" />
                </div>
              )}

              {/* [Image N] / [Video N] / [Audio N] badge — bottom-left so it
                  doesn't collide with the remove ✕ in the top-right. */}
              {labels?.[idx] && (
                onLabelClick ? (
                  <button
                    type="button"
                    data-testid="media-label-badge"
                    aria-label={t('video.uploader.insertToPrompt')}
                    title={t('video.uploader.insertToPrompt')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onLabelClick(labels[idx])
                    }}
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      left: 2,
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: 'rgba(0,0,0,0.7)',
                      color: '#fff',
                      fontSize: 10,
                      lineHeight: '12px',
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {labels[idx]}
                  </button>
                ) : (
                  <div
                    data-testid="media-label-badge"
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      left: 2,
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: 'rgba(0,0,0,0.7)',
                      color: '#fff',
                      fontSize: 10,
                      lineHeight: '12px',
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      pointerEvents: 'none',
                    }}
                  >
                    {labels[idx]}
                  </div>
                )
              )}

              {/* Role badge (top-left) — overlays 1ST / LAST / REF style markers
                  for video frame roles. Top-right is taken by the remove ✕,
                  bottom-left by the optional [Image N] label badge. */}
              {roleBadges?.[idx] && (
                <div
                  data-testid={`role-badge-${idx}`}
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: 2,
                    padding: '1px 4px',
                    background:
                      item.role === 'first_frame'
                        ? 'var(--success)'
                        : item.role === 'last_frame'
                          ? 'var(--warning)'
                          : 'var(--text-muted)',
                    color: '#fff',
                    fontSize: 9,
                    lineHeight: '11px',
                    borderRadius: 2,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    pointerEvents: 'none',
                  }}
                >
                  {roleBadges[idx]}
                </div>
              )}

              {/* Remove button */}
              <button
                aria-label={t('video.uploader.remove')}
                onClick={() => {
                  URL.revokeObjectURL(item.preview)
                  onRemove(idx)
                }}
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.7)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>

            {/* Per-thumb role dropdown (T17). Only rendered when the parent
                opts in via `showRoleDropdown`. Sits under the thumb in the
                wrapping column-flex container above. */}
            {showRoleDropdown && (
              <select
                data-testid={`role-select-${idx}`}
                value={item.role ?? ''}
                onChange={(e) => onRoleChange?.(idx, e.target.value as ImageRole)}
                style={{
                  width: 64,
                  marginTop: 3,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 10,
                  padding: '2px 4px',
                }}
              >
                {(roleChoices ?? ['first_frame', 'last_frame']).map((r) => (
                  <option key={r} value={r}>
                    {r === 'first_frame'
                      ? t('video.role.firstFrame')
                      : r === 'last_frame'
                        ? t('video.role.lastFrame')
                        : t('video.role.reference')}
                  </option>
                ))}
              </select>
            )}
            </div>
          )})}
        </div>
      )}

      {/* Dropzone (or lock overlay when the active mode forbids this media) */}
      {locked ? (
        <div
          data-testid="lock-overlay"
          style={{
            padding: 10,
            textAlign: 'center',
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px dashed var(--border)',
            borderRadius: 6,
            color: 'var(--text-muted)',
            fontSize: 11,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 4 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {lockedHint ?? t('video.modeUnsupported')}
        </div>
      ) : items.length < maxItems && (
        <div
          {...getRootProps()}
          className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
        >
          <input {...getInputProps()} />
          {disabled ? (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 4 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {disabledHint && <div className="hint" style={{ marginTop: 4 }}>{disabledHint}</div>}
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 4 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
              </svg>
              <div>{isDragActive ? t('video.uploader.dropActive') : t('video.uploader.dropIdle')}</div>
              {hint && <div className="hint" style={{ marginTop: 4 }}>{hint}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
