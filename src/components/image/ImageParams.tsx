import { useCallback, useRef } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import toast from 'react-hot-toast'
import { useImageStore } from '../../stores/imageStore'
import { useAuthStore } from '../../stores/authStore'
import { useCredentialsUiStore } from '../credentials/uiStore'
import {
  useImageGeneration,
  computeImageBlockReason,
} from '../../hooks/useImageGeneration'
import {
  SEEDREAM_MODELS,
  SEEDREAM_MODEL_OPTIONS,
  ASPECT_RATIO_OPTIONS,
  SEQUENTIAL_TOTAL_CAP,
  validateCustomSize,
  type SeedreamModelKey,
  type SizeLevel,
  type OutputFormat,
} from '../../utils/seedreamModels'
import { validateSeedreamRefBasic } from '../../utils/mediaValidation'
import { Icon } from '../common/icons'
import { useOptionalI18n } from '../../i18n/useOptionalI18n'

export const IMAGE_PARAMS_DEFAULT_WIDTH = 320

function newRefId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 近似「词数」：CJK（漢字/假名/諺文）逐字计 1，其余文字按空白断词。
 * 官方建议提示词约 600 英文词以内；纯靠空白断词会把中文整段算成 1 词。
 */
function approxPromptWordCount(prompt: string): number {
  const cjk = (prompt.match(/[一-鿿぀-ヿ가-힯]/g) ?? []).length
  const nonCjkTokens = prompt
    .replace(/[一-鿿぀-ヿ가-힯]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  return cjk + nonCjkTokens
}

export default function ImageParams({
  width = IMAGE_PARAMS_DEFAULT_WIDTH,
}: { width?: number }) {
  const { t } = useOptionalI18n()
  const store = useImageStore()
  const { generate } = useImageGeneration()
  const spec = SEEDREAM_MODELS[store.modelKey]
  // computeImageBlockReason() 用 getState() 读 imageStore + authStore 两个快照。
  // imageStore 的新鮮度来自上面的整-store 訂阅（每次状态变化都重渲染）；
  // authStore 则要在此明确訂阅，否则在凭证抽屜输入密钥/接入点后，
  // 按钮会一直停在 disabled，直到某次不相干的 imageStore 变化才刷新。
  useAuthStore((s) => s.apiKey)
  useAuthStore((s) => s.imageEndpoint)
  const blockReason = computeImageBlockReason(t)

  const onDrop = useCallback(
    (accepted: File[]) => {
      for (const file of accepted) {
        const v = validateSeedreamRefBasic(file)
        if (!v.ok) {
          toast.error(v.errors.join('\n'))
          continue
        }
        useImageStore.getState().addRefImage({
          id: newRefId(),
          file,
          preview: URL.createObjectURL(file),
          filename: file.name,
        })
      }
    },
    [],
  )
  // accept: image/* 在 onDrop 之前就把非图片档滤进 rejections——
  // 不另行提示的话用户会以为拖放没反应，所以这里也要 toast。
  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    for (const r of rejections) {
      const v = validateSeedreamRefBasic(r.file)
      toast.error(
        v.ok ? t('image.validation.unsupportedFormat', { fileName: r.file.name }) : v.errors.join('\n'),
      )
    }
  }, [t])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'image/*': [] },
    multiple: true,
  })

  const customSizeError =
    store.sizeMode === 'custom'
      ? validateCustomSize(store.modelKey, store.customWidth, store.customHeight)
      : { ok: true as const }

  const refCount =
    store.refImages.length + store.refUrls.filter((u) => u.trim() !== '').length
  const maxImagesCap = Math.max(1, SEQUENTIAL_TOTAL_CAP - refCount)

  // 「插入 image N」— 让提示词用自然语言引用多张参考图。编号规则必须与
  // buildImageRequest 送出的 payload 顺序一致：上传档在前（依列表顺序），
  // 接著非空的 URL 列（依列表顺序）；空的 URL 列不占号、也不显示按钮。
  const fileCount = store.refImages.length
  const urlRefNumbers = store.refUrls.map((u, i) => {
    if (u.trim() === '') return null
    // 此列在非空 URL 列中的序位（含自己）→ 接在上传档号段之后。
    const seq = store.refUrls.slice(0, i + 1).filter((x) => x.trim() !== '').length
    return fileCount + seq
  })

  const promptRef = useRef<HTMLTextAreaElement>(null)
  // 记住 textarea 最后的游标/选择范围，插入时定位；失焦后仍保留。
  // 注意：外部改写 prompt（加载参数、新任务重置）不会更新这里，offset 可能
  // 过期——但 slice() 与 setSelectionRange() 对越界值都会安全 clamp，最坏只是
  // 插入位置落在字符串尾端，不会 crash。
  const selectionRef = useRef<{ start: number; end: number } | null>(null)
  const captureSelection = (el: HTMLTextAreaElement) => {
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd }
  }

  const insertImageRef = (n: number) => {
    // 官方多图教学用纯自然语言序数（"image 1"），不加中括号——中括号是
    // Seedance 影格内容角色的惯例，Seedream 提示词是自然语言，不需要。
    const token = `image ${n}`
    const prompt = store.prompt
    const sel = selectionRef.current
    let next: string
    let caret: number
    if (sel) {
      // 决定性补空白：相邻字符存在且非空白才补，避免黏字（red|car →
      // red image 1 car）也避免重复空白（'a |b' → 'a image 1 b'）。
      const before = prompt.slice(0, sel.start)
      const after = prompt.slice(sel.end)
      const padL = before !== '' && !/\s$/.test(before) ? ' ' : ''
      const padR = after !== '' && !/^\s/.test(after) ? ' ' : ''
      const inserted = padL + token + padR
      next = before + inserted + after
      caret = sel.start + inserted.length
    } else {
      const sep = prompt && !prompt.endsWith(' ') ? ' ' : ''
      next = prompt + sep + token
      caret = next.length
    }
    store.setPrompt(next)
    selectionRef.current = { start: caret, end: caret }
    // 重新聚焦并把游标移到插入内容之后（状态更新后才 focus）。
    requestAnimationFrame(() => {
      const el = promptRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(caret, caret)
      }
    })
  }

  const hasAnyRef = store.refImages.length > 0 || urlRefNumbers.some((n) => n !== null)

  return (
    <div
      className="resizable-panel"
      style={{
        width,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 滚动内容区 — CTA 移入下方 sticky footer（handoff §C.1） */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
      {/* 模型版本 */}
      <div>
        <label className="label" htmlFor="image-model-select">{t('image.modelVersion')}</label>
        <select
          id="image-model-select"
          className="select-field"
          value={store.modelKey}
          onChange={(e) => store.setModelKey(e.target.value as SeedreamModelKey)}
        >
          {SEEDREAM_MODEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="hint">
          {t('image.modelHint')}
        </div>
      </div>

      {/* Prompt */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label className="label" htmlFor="image-prompt" style={{ margin: 0 }}>{t('video.prompt')}</label>
          <button
            type="button"
            onClick={() => store.resetForNewTask()}
            title={t('video.newTaskTitle')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', fontSize: 13, fontWeight: 500, padding: 0,
            }}
          >
            {t('video.newTask')}
          </button>
        </div>
        <textarea
          id="image-prompt"
          ref={promptRef}
          className="input-field"
          rows={5}
          value={store.prompt}
          onChange={(e) => store.setPrompt(e.target.value)}
          onSelect={(e) => captureSelection(e.currentTarget)}
          onBlur={(e) => captureSelection(e.currentTarget)}
          placeholder={t('image.promptPlaceholder')}
        />
        {hasAnyRef && (
          <div className="hint">
            {t('image.promptRefHint')}
          </div>
        )}
        {approxPromptWordCount(store.prompt) > 600 && (
          <div className="hint" style={{ color: 'var(--warning)' }}>
            {t('image.promptTooLong')}
          </div>
        )}
      </div>

      {/* 参考图（图生图） */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            {t('image.referenceImages')}{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              ({refCount}/{spec.maxRefImages})
            </span>
          </span>
          <button
            type="button"
            onClick={() => store.addRefUrl()}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', fontSize: 13, fontWeight: 500, padding: 0,
            }}
          >
            {t('image.addUrl')}
          </button>
        </div>

        {/* 缩图格（比照视频页 MediaUploader 的 64px 缩图 + 角标 + 圆形移除钮） */}
        {store.refImages.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {store.refImages.map((m, i) => (
              <div
                key={m.id}
                style={{
                  position: 'relative', width: 64, height: 64, borderRadius: 6,
                  overflow: 'hidden', border: '1px solid var(--border)',
                  background: 'var(--bg-input)', opacity: m.stale ? 0.5 : 1,
                }}
                title={m.filename + (m.stale ? t('image.staleTitle') : '')}
              >
                {m.preview && !m.stale ? (
                  <img
                    src={m.preview}
                    alt={m.filename}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: '100%', padding: 4,
                    fontSize: 9, color: 'var(--text-muted)', textAlign: 'center',
                    wordBreak: 'break-all',
                  }}>
                    <div>{(m.filename ?? '').slice(0, 12)}</div>
                    {m.stale && <div style={{ color: 'var(--warning)', marginTop: 2 }}>{t('image.stale')}</div>}
                  </div>
                )}
                <button
                  type="button"
                  title={t('image.insertToPrompt')}
                  onClick={() => insertImageRef(i + 1)}
                  style={{
                    position: 'absolute', bottom: 2, left: 2, padding: '1px 4px',
                    borderRadius: 3, background: 'rgba(0,0,0,0.7)', color: '#fff',
                    fontSize: 10, lineHeight: '12px', border: 'none', cursor: 'pointer',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  }}
                >
                  image {i + 1}
                </button>
                <button
                  type="button"
                  aria-label={t('image.removeFile', { name: m.filename ?? 'unknown' })}
                  onClick={() => store.removeRefImage(m.id)}
                  style={{
                    position: 'absolute', top: 2, right: 2, width: 20, height: 20,
                    borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: 'white',
                    border: 'none', cursor: 'pointer', padding: 0,
                    display: 'grid', placeItems: 'center',
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Dropzone — 与视频页 .dropzone 同款 */}
        <div
          {...getRootProps()}
          className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
        >
          <input {...getInputProps()} aria-label={t('image.uploadReference')} />
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: 4 }}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M17 8l-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <div>{isDragActive ? t('image.dropActive') : t('image.dropIdle')}</div>
          <div className="hint" style={{ marginTop: 4 }}>
            {t('image.dropHint', { count: spec.maxRefImages })}
          </div>
        </div>

        {store.refUrls.map((u, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <input
              className="input-field"
              style={{ flex: 1 }}
              placeholder="https://…"
              value={u}
              onChange={(e) => store.updateRefUrl(i, e.target.value)}
            />
            {urlRefNumbers[i] !== null && (
              <button
                type="button"
                title={t('image.insertToPrompt')}
                onClick={() => insertImageRef(urlRefNumbers[i]!)}
                style={insertRefBtnStyle}
              >
                image {urlRefNumbers[i]}
              </button>
            )}
            <button
              type="button"
              aria-label={t('image.removeUrl', { index: i + 1 })}
              onClick={() => store.removeRefUrl(i)}
              style={{
                width: 20, height: 20, borderRadius: '50%',
                background: 'none', border: '1px solid var(--border)',
                color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
                display: 'grid', placeItems: 'center', flexShrink: 0,
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* 尺寸 */}
      <div>
        <label className="label">{t('image.size')}</label>
        {/* Segmented control — 与视频页「视频生成模式」同款 */}
        <div style={{
          display: 'flex', gap: 2, background: 'var(--bg-input)',
          borderRadius: 8, padding: 3, marginBottom: 8,
        }}>
          {([
            { v: 'preset', label: t('image.sizeMode.preset'), aria: t('image.sizeMode.presetAria') },
            { v: 'custom', label: t('image.sizeMode.custom'), aria: t('image.sizeMode.custom') },
          ] as const).map((m) => (
            <button
              key={m.v}
              type="button"
              aria-label={m.aria}
              aria-pressed={store.sizeMode === m.v}
              onClick={() => store.setSizeMode(m.v)}
              style={{
                flex: 1,
                padding: '7px 4px',
                textAlign: 'center',
                fontSize: 12,
                color: store.sizeMode === m.v ? '#fff' : 'var(--text-muted)',
                background: store.sizeMode === m.v ? 'var(--accent)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                fontWeight: store.sizeMode === m.v ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        {store.sizeMode === 'preset' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="hint" htmlFor="image-size-level" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>{t('image.sizeLevel')}</label>
              <select
                id="image-size-level"
                className="select-field"
                value={store.sizeLevel}
                onChange={(e) => store.setSizeLevel(e.target.value as SizeLevel)}
              >
                {spec.sizeLevels.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="hint" htmlFor="image-aspect-ratio" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>{t('image.aspectRatio')}</label>
              <select
                id="image-aspect-ratio"
                className="select-field"
                value={store.aspectRatio}
                onChange={(e) => store.setAspectRatio(e.target.value)}
              >
                {ASPECT_RATIO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="hint" htmlFor="image-custom-width" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>{t('image.widthPx')}</label>
                <input
                  id="image-custom-width"
                  className="input-field"
                  type="number"
                  value={store.customWidth}
                  onChange={(e) => store.setCustomWidth(Number(e.target.value))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="hint" htmlFor="image-custom-height" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>{t('image.heightPx')}</label>
                <input
                  id="image-custom-height"
                  className="input-field"
                  type="number"
                  value={store.customHeight}
                  onChange={(e) => store.setCustomHeight(Number(e.target.value))}
                />
              </div>
            </div>
            {!customSizeError.ok && (
              <div className="hint" style={{ color: 'var(--danger)' }}>
                {customSizeError.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输出格式 */}
      <div>
        <label className="label" htmlFor="image-output-format">{t('image.outputFormat')}</label>
        <select
          id="image-output-format"
          className="select-field"
          disabled={spec.formatLocked}
          value={store.outputFormat}
          onChange={(e) => store.setOutputFormat(e.target.value as OutputFormat)}
        >
          {spec.outputFormats.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        {spec.formatLocked && <div className="hint">{t('image.formatLocked', { model: spec.label })}</div>}
      </div>

      {/* 组图输出 — toggle 列（与视频页「返回尾帧」等同款）。
          原生 checkbox 以 .sr-only 隐藏保留（id / aria-label 不变，
          键盘与测试行为与旧版一致），视觉由 .toggle 呈现。 */}
      <div>
        <label
          htmlFor="image-sequential"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: spec.supportsSequential ? 'pointer' : 'default',
          }}
        >
          <div>
            <span style={{ fontSize: 14 }}>{t('image.sequential')}</span>
            <div className="hint" style={{ marginTop: 2 }}>
              {spec.supportsSequential
                ? t('image.sequentialEnabledHint')
                : t('image.sequentialUnsupportedHint', { model: spec.label })}
            </div>
          </div>
          <input
            id="image-sequential"
            className="sr-only"
            type="checkbox"
            aria-label={t('image.sequential')}
            disabled={!spec.supportsSequential}
            checked={store.sequentialEnabled}
            onChange={(e) => store.setSequentialEnabled(e.target.checked)}
          />
          <span
            aria-hidden="true"
            className={`toggle ${store.sequentialEnabled && spec.supportsSequential ? 'active' : ''}`}
            style={{
              display: 'inline-block',
              opacity: spec.supportsSequential ? 1 : 0.4,
            }}
          />
        </label>
        {spec.supportsSequential && store.sequentialEnabled && (
          <div style={{ marginTop: 8 }}>
            <label className="label" htmlFor="image-max-images">
              {t('image.maxImages', { cap: SEQUENTIAL_TOTAL_CAP })}
            </label>
            <input
              id="image-max-images"
              className="input-field"
              type="number"
              min={1}
              max={maxImagesCap}
              value={Math.min(store.maxImages, maxImagesCap)}
              onChange={(e) => store.setMaxImages(Number(e.target.value))}
            />
          </div>
        )}
      </div>

      {/* AI 水印 — toggle 列 */}
      <label
        htmlFor="image-watermark"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <div>
          <span style={{ fontSize: 14 }}>{t('image.watermark')}</span>
          <div className="hint" style={{ marginTop: 2 }}>{t('image.watermarkHint')}</div>
        </div>
        <input
          id="image-watermark"
          className="sr-only"
          type="checkbox"
          checked={store.watermark}
          onChange={(e) => store.setWatermark(e.target.checked)}
        />
        <span
          aria-hidden="true"
          className={`toggle ${store.watermark ? 'active' : ''}`}
          style={{ display: 'inline-block' }}
        />
      </label>

      </div>

      {/* Sticky footer — 生成 CTA + block reason（handoff §C.1，同视频页结构） */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          padding: '12px 16px',
        }}
      >
        <button
          type="button"
          className="btn-primary"
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8,
          }}
          disabled={blockReason !== null}
          onClick={() => void generate()}
        >
          <Icon name="image" size={15} />
          {t('image.generate')}
        </button>
        {blockReason && (
          <div className="hint" style={{ color: 'var(--warning)', marginTop: 6 }}>
            {blockReason}
            {/* 凭证类原因附一键打开抽屜（inference 区含 API 密钥与图片接入点） */}
            {(blockReason.includes('Key') || blockReason.includes('密钥') || blockReason.includes('接入点') || blockReason.includes('endpoint')) && (
              <button
                type="button"
                onClick={() => useCredentialsUiStore.getState().openDrawer('inference')}
                style={{
                  display: 'block', marginTop: 4, padding: '2px 8px',
                  background: 'transparent', cursor: 'pointer',
                  border: '1px solid var(--border)', borderRadius: 6,
                  color: 'var(--accent)', fontSize: 12,
                }}
              >
                {t('image.openCredentials')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const insertRefBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px 6px', fontSize: 11,
  whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}
