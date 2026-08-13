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

export const IMAGE_PARAMS_DEFAULT_WIDTH = 320

function newRefId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 近似「詞數」：CJK（漢字/假名/諺文）逐字計 1，其餘文字按空白斷詞。
 * 官方建議提示詞約 600 英文詞以內；純靠空白斷詞會把中文整段算成 1 詞。
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
  const store = useImageStore()
  const { generate } = useImageGeneration()
  const spec = SEEDREAM_MODELS[store.modelKey]
  // computeImageBlockReason() 用 getState() 讀 imageStore + authStore 兩個快照。
  // imageStore 的新鮮度來自上面的整-store 訂閱（每次狀態變化都重渲染）；
  // authStore 則要在此明確訂閱，否則在憑證抽屜輸入金鑰/接入點後，
  // 按鈕會一直停在 disabled，直到某次不相干的 imageStore 變化才刷新。
  useAuthStore((s) => s.apiKey)
  useAuthStore((s) => s.imageEndpoint)
  const blockReason = computeImageBlockReason()

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
  // accept: image/* 在 onDrop 之前就把非圖片檔濾進 rejections——
  // 不另行提示的話使用者會以為拖放沒反應，所以這裡也要 toast。
  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    for (const r of rejections) {
      const v = validateSeedreamRefBasic(r.file)
      toast.error(
        v.ok ? `不支援的檔案格式（${r.file.name}）` : v.errors.join('\n'),
      )
    }
  }, [])
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

  // 「插入 image N」— 讓提示詞用自然語言引用多張參考圖。編號規則必須與
  // buildImageRequest 送出的 payload 順序一致：上傳檔在前（依列表順序），
  // 接著非空的 URL 列（依列表順序）；空的 URL 列不佔號、也不顯示按鈕。
  const fileCount = store.refImages.length
  const urlRefNumbers = store.refUrls.map((u, i) => {
    if (u.trim() === '') return null
    // 此列在非空 URL 列中的序位（含自己）→ 接在上傳檔號段之後。
    const seq = store.refUrls.slice(0, i + 1).filter((x) => x.trim() !== '').length
    return fileCount + seq
  })

  const promptRef = useRef<HTMLTextAreaElement>(null)
  // 記住 textarea 最後的游標/選取範圍，插入時定位；失焦後仍保留。
  // 注意：外部改寫 prompt（載入參數、新任務重置）不會更新這裡，offset 可能
  // 過期——但 slice() 與 setSelectionRange() 對越界值都會安全 clamp，最壞只是
  // 插入位置落在字串尾端，不會 crash。
  const selectionRef = useRef<{ start: number; end: number } | null>(null)
  const captureSelection = (el: HTMLTextAreaElement) => {
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd }
  }

  const insertImageRef = (n: number) => {
    // 官方多圖教學用純自然語言序數（"image 1"），不加中括號——中括號是
    // Seedance 影格內容角色的慣例，Seedream 提示詞是自然語言，不需要。
    const token = `image ${n}`
    const prompt = store.prompt
    const sel = selectionRef.current
    let next: string
    let caret: number
    if (sel) {
      // 決定性補空白：相鄰字元存在且非空白才補，避免黏字（red|car →
      // red image 1 car）也避免重複空白（'a |b' → 'a image 1 b'）。
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
    // 重新聚焦並把游標移到插入內容之後（狀態更新後才 focus）。
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
      {/* 捲動內容區 — CTA 移入下方 sticky footer（handoff §C.1） */}
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
        <label className="label" htmlFor="image-model-select">模型版本</label>
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
          呼叫使用「圖片生成接入點」；此選單用於鎖定參數選項，請與接入點的模型一致
        </div>
      </div>

      {/* Prompt */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label className="label" htmlFor="image-prompt" style={{ margin: 0 }}>提示詞</label>
          <button
            type="button"
            onClick={() => store.resetForNewTask()}
            title="清除提示詞與參考圖，開始新任務"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', fontSize: 13, fontWeight: 500, padding: 0,
            }}
          >
            新任務
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
          placeholder="描述主體 + 動作 + 環境；需要美感時補風格/色彩/光線/構圖"
        />
        {hasAnyRef && (
          <div className="hint">
            可用 <code>image 1</code>、<code>image 2</code>… 引用參考圖（上傳在前、URL 在後）
          </div>
        )}
        {approxPromptWordCount(store.prompt) > 600 && (
          <div className="hint" style={{ color: 'var(--warning)' }}>
            提示詞超過約 600 詞，模型可能忽略細節（仍可送出）
          </div>
        )}
      </div>

      {/* 參考圖（圖生圖） */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            參考圖{' '}
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
            + 圖片 URL
          </button>
        </div>

        {/* 縮圖格（比照影片頁 MediaUploader 的 64px 縮圖 + 角標 + 圓形移除鈕） */}
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
                title={m.filename + (m.stale ? '（失效，請重新上傳）' : '')}
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
                    {m.stale && <div style={{ color: 'var(--warning)', marginTop: 2 }}>已失效</div>}
                  </div>
                )}
                <button
                  type="button"
                  title="插入到提示詞"
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
                  aria-label={`移除 ${m.filename}`}
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

        {/* Dropzone — 與影片頁 .dropzone 同款 */}
        <div
          {...getRootProps()}
          className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
        >
          <input {...getInputProps()} aria-label="上傳參考圖" />
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: 4 }}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M17 8l-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <div>{isDragActive ? '放開以上傳' : '拖拽或點擊上傳'}</div>
          <div className="hint" style={{ marginTop: 4 }}>
            留空 = 文生圖；上限 {spec.maxRefImages} 張，單檔 ≤ 30MB
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
                title="插入到提示詞"
                onClick={() => insertImageRef(urlRefNumbers[i]!)}
                style={insertRefBtnStyle}
              >
                image {urlRefNumbers[i]}
              </button>
            )}
            <button
              type="button"
              aria-label={`移除 URL ${i + 1}`}
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
        <label className="label">尺寸</label>
        {/* Segmented control — 與影片頁「影片生成模式」同款 */}
        <div style={{
          display: 'flex', gap: 2, background: 'var(--bg-input)',
          borderRadius: 8, padding: 3, marginBottom: 8,
        }}>
          {([
            { v: 'preset', label: '檔位', aria: '檔位模式' },
            { v: 'custom', label: '自訂像素', aria: '自訂像素' },
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
              <label className="hint" htmlFor="image-size-level" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>解析度檔位</label>
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
              <label className="hint" htmlFor="image-aspect-ratio" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>比例</label>
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
                <label className="hint" htmlFor="image-custom-width" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>寬 (px)</label>
                <input
                  id="image-custom-width"
                  className="input-field"
                  type="number"
                  value={store.customWidth}
                  onChange={(e) => store.setCustomWidth(Number(e.target.value))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="hint" htmlFor="image-custom-height" style={{ display: 'block', marginTop: 0, marginBottom: 4, color: 'var(--text-secondary)' }}>高 (px)</label>
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

      {/* 輸出格式 */}
      <div>
        <label className="label" htmlFor="image-output-format">輸出格式</label>
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
        {spec.formatLocked && <div className="hint">{spec.label} 固定輸出 jpeg</div>}
      </div>

      {/* 組圖輸出 — toggle 列（與影片頁「回傳尾幀」等同款）。
          原生 checkbox 以 .sr-only 隱藏保留（id / aria-label 不變，
          鍵盤與測試行為與舊版一致），視覺由 .toggle 呈現。 */}
      <div>
        <label
          htmlFor="image-sequential"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: spec.supportsSequential ? 'pointer' : 'default',
          }}
        >
          <div>
            <span style={{ fontSize: 14 }}>組圖輸出</span>
            <div className="hint" style={{ marginTop: 2 }}>
              {spec.supportsSequential
                ? '一次生成一組系列圖'
                : `${spec.label} 不支援組圖輸出（僅單圖）`}
            </div>
          </div>
          <input
            id="image-sequential"
            className="sr-only"
            type="checkbox"
            aria-label="組圖輸出"
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
              最多張數（參考圖 + 生成 ≤ {SEQUENTIAL_TOTAL_CAP}）
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

      {/* AI 浮水印 — toggle 列 */}
      <label
        htmlFor="image-watermark"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <div>
          <span style={{ fontSize: 14 }}>AI 浮水印</span>
          <div className="hint" style={{ marginTop: 2 }}>在輸出中加入浮水印</div>
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

      {/* Sticky footer — 生成 CTA + block reason（handoff §C.1，同影片頁結構） */}
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
          生成圖片
        </button>
        {blockReason && (
          <div className="hint" style={{ color: 'var(--warning)', marginTop: 6 }}>
            {blockReason}
            {/* 憑證類原因附一鍵開啟抽屜（inference 區含 API 金鑰與圖片接入點） */}
            {(blockReason.includes('金鑰') || blockReason.includes('接入點')) && (
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
                開啟憑證設定
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
