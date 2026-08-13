// Seedance 2.5 參數面板 — copy-fork 自 VideoParams.tsx（spec rev3 §4）。
// TODO(tech-debt): seedanceModels 能力表合併 — 差異僅在選項/上限/標籤格式/優化流程，
// 終局應與 VideoParams 合併為能力表驅動的單一元件。
// TODO(tech-debt): 優化流程（optFlow / runOptimize / cancelOptimize / optFixes）應抽成
// useVideo25OptimizeFlow hook，讓本元件回到純渲染；目前刻意留在檔內以縮小 review 面。
// TODO(tech-debt): OptFlowState 應改為 discriminated union（idle | loading | ready | error），
// 現有的 result/error/prepared 可選欄位允許了幾種實際到不了的組合（例如 result 與 error
// 同時存在）。今天所有 setOptFlow 呼叫點都只產生合法組合，故僅列為債務。
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../stores/authStore'
import { useVideo25Store } from '../../stores/video25Store'
import {
  useVideo25Generation,
  SD25_MAX_MULTIMODAL_IMAGES,
  type PreparedSubmit,
  type SubmitOverrides,
} from '../../hooks/useVideo25Generation'
import { useReferenceUpload } from '../../hooks/useReferenceUpload'
import MediaUploader from '../video/MediaUploader'
import ConfirmModal from '../common/ConfirmModal'
import PromptOptimizeModal from './PromptOptimizeModal'
import { Icon } from '../common/icons'
import { RATIO_OPTIONS, DURATION_OPTIONS_25, RESOLUTION_OPTIONS_25, EXECUTION_EXPIRES_OPTIONS } from '../../types'
import type { ImageRole } from '../../types'
import { computeContentLabels } from '../../utils/contentLabels'
import { computeCompatibility } from '../../utils/videoMode'
import { computePanelScale, scaledFs } from '../../utils/panelScale'
import {
  optimizePrompt, computeParamFixes, describeParamFixes,
  type Sd25OptimizeResult, type ParamFixes,
} from '../../utils/sd25PromptOptimizer'
/** Default width when no parent overrides — used as the scale=1 baseline. */
export const VIDEO25_PARAMS_DEFAULT_WIDTH = 320

/**
 * Treat the asset-ref input as actionable when it looks like one of:
 *   - asset-prefixed id      (e.g. asset-20260224213258-pnqkh)
 *   - asset:// URI           (e.g. asset://asset-xxxxx)
 *   - http(s):// URL         (chained input from a previous generation)
 * Anything else (empty / random text) → not actionable; the insert button
 * stays disabled to avoid pasting a label that maps to no real asset.
 */
function isInsertableAssetRef(input: string): boolean {
  const s = input.trim()
  if (!s) return false
  if (s.startsWith('asset://')) return true
  if (/^https?:\/\//i.test(s)) return true
  if (/^asset-/.test(s)) return true
  return false
}

interface Video25ParamsProps {
  /** Optional override; falls back to VIDEO25_PARAMS_DEFAULT_WIDTH. */
  width?: number
}

const ROLE_BADGE: Record<ImageRole, string> = {
  first_frame: '1ST',
  last_frame: 'LAST',
  reference_image: 'REF',
}

/** 優化流程狀態（spec §6.3）。`prepared` 是按下生成當下的參數快照，
 *  Modal 確認時據此送出，避免使用者在 Modal 開啟期間改動參數造成不一致。 */
interface OptFlowState {
  open: boolean
  loading: boolean
  error?: string
  result?: Sd25OptimizeResult
  prepared?: PreparedSubmit
}

export default function Video25Params({ width = VIDEO25_PARAMS_DEFAULT_WIDTH }: Video25ParamsProps) {
  const {
    apiKey, textEndpoint,
  } = useAuthStore()

  const tosReady = useAuthStore((s) =>
    Boolean(s.tosCreds.accessKeyId && s.tosCreds.accessKeySecret && s.tosCreds.bucket),
  )

  const {
    prompt, ratio, duration, resolution, watermark, generateAudio, returnLastFrame,
    seed,
    executionExpiresAfter,
    mode,
    referenceImages, referenceVideos, referenceAudios,
    assetRefs,
    activeTaskIds,
    setPrompt, setRatio, setDuration, setResolution, setWatermark, setGenerateAudio,
    setReturnLastFrame,
    setSeed,
    setExecutionExpiresAfter,
    setMode,
    addReferenceImage, removeReferenceImage,
    removeReferenceVideo,
    removeReferenceAudio,
    addAssetRef, removeAssetRef, updateAssetRef,
    resetForNewTask,
    promptOptimize, setPromptOptimize,
  } = useVideo25Store()

  // Video / audio references are auto-uploaded to TOS on add so the model
  // receives a short-lived pre-signed URL instead of a public hosting URL.
  const { addReferenceVideo, addReferenceAudio } = useReferenceUpload({}, useVideo25Store)

  // Per-type labels (`@Image1` / `@Video1` / `@Audio1` …) — Seedance
  // numbers items by their order of appearance in the `content` array.
  const labels = computeContentLabels({
    imageCount: referenceImages.length,
    videoCount: referenceVideos.length,
    audioCount: referenceAudios.length,
    assets: assetRefs,
  }, 'at')

  // T18: surface role badges + per-thumb incompatibility on the image
  // uploader. `computeCompatibility` produces the index list of images whose
  // current role doesn't fit the active mode.
  const compat = computeCompatibility(
    mode,
    referenceImages,
    referenceVideos,
    referenceAudios,
    assetRefs,
    { maxMultimodalImages: SD25_MAX_MULTIMODAL_IMAGES },
  )

  const imageRoleBadges = referenceImages.map((m) => ROLE_BADGE[m.role ?? 'reference_image'])

  // T20: count of items the current mode considers incompatible. Videos /
  // audios use a global flag (not per-index) because non-multimodal modes
  // reject all of them as a group — when set, every item counts.
  const incompatCount =
    compat.incompatibleImageIndexes.length +
    compat.incompatibleAssetRefIndexes.length +
    (compat.incompatibleVideosFlag ? referenceVideos.length : 0) +
    (compat.incompatibleAudiosFlag ? referenceAudios.length : 0)

  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // 進階設定折疊（Seed / 任務最長等待時間 / 浮水印）— 預設收合。
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const { prepare, submit } = useVideo25Generation()

  const [optFlow, setOptFlow] = useState<OptFlowState>({ open: false, loading: false })
  // 進行中的 optimizePrompt 請求。取消（取消鍵 / Escape / 遮罩）必須 abort，
  // 否則晚回來的回應會把已關閉的 Modal 重新打開（PromptOptimizeModal onCancel 契約）。
  const optAbortRef = useRef<AbortController | null>(null)
  // 卸載時收掉在途請求：離開頁面後回應已無處可去，讓 LLM 呼叫繼續跑只是浪費配額，
  // 且回呼會對已卸載的元件 setState。
  useEffect(() => () => optAbortRef.current?.abort(), [])

  // 送出中旗標 — 用來擋住重複點擊。submit() 全程 async（base64 編碼 + 建立任務），
  // 期間按鈕若仍可按，兩次快點就會建出兩個任務。Modal 確認時也走同一支，
  // 因為 onConfirm 先關 Modal、submit 還在跑，那段空窗同樣可再按一次生成。
  const [submitting, setSubmitting] = useState(false)
  const runSubmit = useCallback(async (
    prepared: PreparedSubmit,
    finalPrompt: string,
    overrides?: SubmitOverrides,
  ) => {
    setSubmitting(true)
    try {
      await submit(prepared, finalPrompt, overrides)
    } finally {
      setSubmitting(false)
    }
  }, [submit])

  // 任務類型修正回寫 store（spec §3）：edit/extend 對這些值的要求是硬約束，
  // 只改請求不改面板會讓 toast 說「已改為 Auto」而面板還顯示 10 秒，
  // 且下一次生成又會靜默送回錯的值。
  const applyFixesToStore = useCallback((fixes: ParamFixes) => {
    if (fixes.duration !== undefined) setDuration(fixes.duration)
    if (fixes.ratio !== undefined) setRatio(fixes.ratio)
  }, [setDuration, setRatio])

  const runOptimize = useCallback(async (prepared: PreparedSubmit) => {
    // 重試時先收掉上一輪（若仍在途），避免兩個回應競寫同一份 state。
    optAbortRef.current?.abort()
    const controller = new AbortController()
    optAbortRef.current = controller
    setOptFlow({ open: true, loading: true, prepared })
    try {
      // 素材一律取自 prepared 快照（按下生成當下的事實），標籤依同一份快照
      // 重算 — Modal 開啟期間使用者增刪素材不會污染重試的 context。
      // 「+ 新增」但沒填 id 的空列必須先濾掉：submit() 會略過它們（`if (!trimmed) continue`），
      // 若這裡仍計入編號，LLM 拿到的 @ImageN 會比實際送出的素材多一個，
      // 之後每個標籤都指向錯的素材。編號口徑必須與 submit() 完全一致。
      const sentAssets = prepared.assetSnapshot.filter((r) => r.id.trim() !== '')
      const snapLabels = computeContentLabels({
        imageCount: prepared.imgSnapshot.length,
        videoCount: prepared.vidSnapshot.length,
        audioCount: prepared.audSnapshot.length,
        assets: sentAssets,
      }, 'at')
      const assets = [
        ...prepared.imgSnapshot.map((m, i) => ({
          label: snapLabels.imageLabels[i], kind: 'image' as const, role: m.role,
        })),
        ...prepared.vidSnapshot.map((_, i) => ({
          label: snapLabels.videoLabels[i], kind: 'video' as const,
        })),
        ...prepared.audSnapshot.map((_, i) => ({
          label: snapLabels.audioLabels[i], kind: 'audio' as const,
        })),
        ...sentAssets.map((r, i) => ({
          label: snapLabels.assetLabels[i], kind: r.type, role: r.role,
        })),
      ]
      const result = await optimizePrompt({
        prompt: prepared.prompt,
        mode: prepared.mode,
        assets,
        duration: prepared.duration,
        ratio: prepared.ratioToSend,
        generateAudio: prepared.generateAudio,
      }, useAuthStore.getState().textEndpoint, controller.signal)
      if (controller.signal.aborted) return
      setOptFlow({ open: true, loading: false, result, prepared })
    } catch (err) {
      // 使用者取消造成的 rejection（AbortError）不是優化失敗 — 靜默收場，
      // Modal 已由 cancelOptimize 關閉，不要把它重新打開成錯誤態。
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      setOptFlow({ open: true, loading: false, error: message, prepared })
    }
  }, [])

  const cancelOptimize = useCallback(() => {
    optAbortRef.current?.abort()
    optAbortRef.current = null
    setOptFlow({ open: false, loading: false })
  }, [])

  const handleGenerate = useCallback(async () => {
    const prepared = prepare()
    if (!prepared) return
    if (!promptOptimize) {
      await runSubmit(prepared, prepared.prompt)
      return
    }
    await runOptimize(prepared)
  }, [prepare, runSubmit, promptOptimize, runOptimize])

  const optFixes = optFlow.result
    ? computeParamFixes(optFlow.result.taskType, {
        duration: optFlow.prepared?.duration ?? -1,
        ratio: optFlow.prepared?.ratioToSend ?? 'adaptive',
      })
    : {}
  const optFixNote = describeParamFixes(optFixes)

  // Local display string for the seed input — avoids a controlled-input re-render
  // problem where typing "42" into a field showing "-1" produces "-142".
  const [seedDisplay, setSeedDisplay] = useState(String(seed))

  // Textarea ref + label-insert helper. Clicking @Image1 / @Video1 /
  // @Audio1 labels (asset-ref row + media-uploader badges) calls this to
  // splice the label into the prompt at the user's cursor position.
  // （2.5 fork 一律用 @ 形式；2.0 母版才是 [Image 1]。）
  const promptRef = useRef<HTMLTextAreaElement>(null)
  // Last-known cursor/selection, captured on select + blur. Clicking an
  // insert button blurs the textarea BEFORE the click lands, so reading
  // selectionStart at click time (or gating on document.activeElement)
  // always degrades to append-at-end — this ref is what preserves the
  // caret across that blur. External prompt rewrites (載入參數 / 新任務)
  // can leave the offsets stale, but slice() and setSelectionRange() both
  // clamp out-of-range values, so the worst case is an end-of-string insert.
  const selectionRef = useRef<{ start: number; end: number } | null>(null)
  const captureSelection = (el: HTMLTextAreaElement) => {
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd }
  }
  const insertIntoPrompt = useCallback((label: string) => {
    if (!label) return
    const ta = promptRef.current
    const current = useVideo25Store.getState().prompt
    const sel = selectionRef.current
    const start = sel ? Math.min(sel.start, current.length) : current.length
    const end = sel ? Math.min(sel.end, current.length) : current.length
    const before = current.slice(0, start)
    const after = current.slice(end)
    const needsLeading = before.length > 0 && !/\s$/.test(before)
    const insert = (needsLeading ? ' ' : '') + label + ' '
    const next = before + insert + after
    setPrompt(next)
    const pos = start + insert.length
    selectionRef.current = { start: pos, end: pos }
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(pos, pos)
    })
  }, [setPrompt])

  const activeCount = activeTaskIds.length
  // 2.5 的影片接入點可留空（fallback 到官方 model id），但開啟提示詞優化
  // 就必須有文字生成接入點才能呼叫 LLM。
  const optimizeBlocked = promptOptimize && !textEndpoint.trim()
  const credsOK = !!apiKey && !!prompt.trim() && !optimizeBlocked
  const canGenerate = credsOK && compat.canGenerate

  // Single source of truth for the disable reason — same priority order as
  // useVideo25Generation prepare() so the inline hint matches the toast users
  // would see if they somehow clicked through.
  const generateBlockReason: string | null =
    !apiKey ? '請輸入 API 金鑰'
    : !prompt.trim() ? '請輸入提示詞'
    : optimizeBlocked ? '提示詞優化需要文字生成接入點'
    : !compat.imageCountOK ? '圖片數量與模式不符'
    : !compat.roleSetOK ? '首尾幀模式需要恰好一張首幀與一張尾幀'
    : compat.incompatibleImageIndexes.length ? '部分圖片 role 與模式不符'
    : compat.incompatibleVideosFlag ? '此模式不允許參考影片'
    : compat.incompatibleAudiosFlag ? '此模式不允許參考音訊'
    : compat.incompatibleAssetRefIndexes.length ? '部分 asset 參考與模式不符'
    : null

  // T25 / I1: trigger the incompatibility banner for ALL canGenerate failure
  // modes that derive from compat (not credential/prompt issues — those have
  // their own placement). Includes count/role-set violations so users see why
  // the Generate button is disabled even without per-index incompat items.
  const showIncompatBanner = !compat.canGenerate && (
    compat.incompatibleImageIndexes.length > 0
    || compat.incompatibleAssetRefIndexes.length > 0
    || compat.incompatibleVideosFlag
    || compat.incompatibleAudiosFlag
    || !compat.imageCountOK
    || !compat.roleSetOK
  )

  const panelScale = computePanelScale(width, VIDEO25_PARAMS_DEFAULT_WIDTH)
  // 捲動內容 + sticky footer（handoff §B1）：外層鎖 overflow，
  // 內容區獨立捲動，CTA / 提示 / 任務進行中固定在 footer。
  const panelStyle: CSSProperties = {
    width,
    flexShrink: 0,
    overflow: 'hidden',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    // CSS custom property — TS doesn't formally allow it, but it's the
    // standard way to plumb the scale into descendants.
    ['--panel-scale' as unknown as keyof CSSProperties]: panelScale,
  } as CSSProperties

  return (
    <div className="resizable-panel" style={panelStyle}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {/* Model */}
      <div style={{ marginBottom: 16 }}>
        <label className="label">模型</label>
        <select className="select-field" disabled>
          <option>Seedance 2.5</option>
        </select>
      </div>

      {/* Prompt */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}>
          <label className="label" style={{ margin: 0 }}>提示詞</label>
          <button
            type="button"
            onClick={() => resetForNewTask()}
            title="清除提示詞與所有參考素材，開始新任務"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: scaledFs(13),
              fontWeight: 500,
              padding: 0,
            }}
          >
            新任務
          </button>
        </div>
        <textarea
          ref={promptRef}
          className="input-field"
          placeholder="描述您想要生成的影片內容..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onSelect={(e) => captureSelection(e.currentTarget)}
          onBlur={(e) => captureSelection(e.currentTarget)}
          rows={4}
          style={{ resize: 'vertical', minHeight: 80 }}
        />
        <div className="hint" style={{ marginTop: 4 }}>
          可用 <code>@Image1</code> / <code>@Video1</code> / <code>@Audio1</code> 引用素材；各項目右下角會顯示對應編號。
        </div>
        {/* 提示詞優化開關（spec §6.1）— 2.5 頁常駐 */}
        <div style={{ marginTop: 10 }}>
          <label
            htmlFor="video25-prompt-optimize"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          >
            <div>
              <span style={{ fontSize: scaledFs(14) }}>提示詞優化</span>
              <div className="hint" style={{ marginTop: 2 }}>
                生成前先依 Seedance 2.5 提示詞指南以 LLM 優化，優化結果會先讓你確認
              </div>
            </div>
            <input
              id="video25-prompt-optimize"
              className="sr-only"
              type="checkbox"
              aria-label="提示詞優化"
              checked={promptOptimize}
              onChange={(e) => setPromptOptimize(e.target.checked)}
            />
            <span
              aria-hidden="true"
              data-testid="toggle-prompt-optimize"
              className={`toggle ${promptOptimize ? 'active' : ''}`}
              style={{ display: 'inline-block', flexShrink: 0 }}
            />
          </label>
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{ marginBottom: 12 }}>
        <label className="label">影片生成模式</label>
        <div style={{
          display: 'flex', gap: 2,
          background: 'var(--bg-input)',
          borderRadius: 8,
          padding: 3,
        }}>
          {([
            { v: 'first_frame', label: '首幀' },
            { v: 'first_last_frame', label: '首+尾' },
            { v: 'multimodal', label: '多模態' },
          ] as const).map((m) => (
            <button
              key={m.v}
              type="button"
              aria-pressed={mode === m.v}
              onClick={() => setMode(m.v)}
              style={{
                flex: 1,
                padding: '7px 4px',
                textAlign: 'center',
                fontSize: scaledFs(12),
                color: mode === m.v ? '#fff' : 'var(--text-muted)',
                background: mode === m.v ? 'var(--accent)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                fontWeight: mode === m.v ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {mode === 'first_frame' && '用單張首幀圖生影片；可串接尾幀做長片'}
          {mode === 'first_last_frame' && '首尾畫面嚴格鎖定為指定圖片'}
          {mode === 'multimodal' && '圖 + 影 + 音 多模態參考，0-30 張圖；編輯/延長任務比例請用 Adaptive；編輯任務長度請用 Auto'}
        </div>
      </div>

      {/* T20: Incompatibility banner — surfaces items that don't fit the
          active mode and offers a one-click clear (gated by ConfirmModal).
          Uses rgba(248,81,73,*) since CSS lacks color-mix in current targets
          — those values correspond to --danger at 12% / 40% / 30%. */}
      {showIncompatBanner && (
        <div style={{
          margin: '0 0 12px',
          padding: '8px 10px',
          background: 'rgba(248, 81, 73, 0.12)',
          border: '1px solid rgba(248, 81, 73, 0.4)',
          borderRadius: 6,
          fontSize: 12,
          color: '#fca5a5',
          lineHeight: 1.5,
        }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {incompatCount > 0
              ? `${incompatCount} 個項目不相容`
              : '參數與目前模式不符'}
          </div>
          <div style={{ marginTop: 2 }}>{generateBlockReason ?? '切換模式後部分項目不符合 API 規則'}</div>
          {incompatCount > 0 && (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              style={{
                marginTop: 6,
                padding: '3px 10px',
                background: 'rgba(248, 81, 73, 0.3)',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              清掉不相容項目
            </button>
          )}
        </div>
      )}

      {/* Asset references — placed right after prompt so users can grab the
          [Type N] number to type into the prompt. */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            Asset 參考 <span style={{ color: 'var(--text-muted)' }}>({assetRefs.length})</span>
          </span>
          <button
            type="button"
            onClick={() => addAssetRef({ id: '', type: 'image' })}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: scaledFs(13),
              fontWeight: 500,
              padding: 0,
            }}
          >
            + 新增
          </button>
        </div>
        {assetRefs.map((ref, idx) => {
          // T21: highlight rows whose type/role doesn't fit the active mode.
          // Layout shift is avoided by reserving a transparent 1px border in
          // all states — only the color flips when (in)compat changes.
          const isIncompat = compat.incompatibleAssetRefIndexes.includes(idx)
          return (
          <div
            key={idx}
            data-testid={`asset-ref-row-${idx}`}
            data-incompat={isIncompat ? 'true' : 'false'}
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 6,
              alignItems: 'center',
              border: isIncompat
                ? '1px solid rgba(248, 81, 73, 0.4)'
                : '1px solid transparent',
              borderRadius: 6,
              padding: 4,
            }}
          >
            <select
              className="select-field"
              value={ref.type}
              onChange={(e) => updateAssetRef(idx, { type: e.target.value as 'image' | 'video' | 'audio' })}
              style={{ width: 72, flexShrink: 0 }}
            >
              <option value="image">圖片</option>
              <option value="video">影片</option>
              <option value="audio">音訊</option>
            </select>
            <input
              className="input-field"
              placeholder="asset-xxxxx 或 https://..."
              value={ref.id}
              onChange={(e) => updateAssetRef(idx, { id: e.target.value })}
              style={{ flex: 1 }}
            />
            {mode === 'first_last_frame' && ref.type === 'image' && (
              <select
                value={ref.role ?? 'first_frame'}
                onChange={(e) => updateAssetRef(idx, { role: e.target.value as ImageRole })}
                style={{
                  width: 64,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 10,
                  padding: '2px 4px',
                  flexShrink: 0,
                }}
              >
                <option value="first_frame">首幀</option>
                <option value="last_frame">尾幀</option>
              </select>
            )}
            {(() => {
              const insertable = isInsertableAssetRef(ref.id)
              const labelText = labels.assetLabels[idx] || ''
              return (
                <button
                  type="button"
                  data-testid="asset-label"
                  aria-label={
                    insertable
                      ? `插入 ${labelText} 到提示詞`
                      : '請先填入有效的 asset id / URI / URL'
                  }
                  title={
                    insertable
                      ? '點擊將此標籤插入到提示詞'
                      : '請先填入 asset id（asset-… / asset://… / http(s)://…）'
                  }
                  disabled={!insertable}
                  onClick={() => insertIntoPrompt(labelText)}
                  style={{
                    // Ghost 樣式（handoff §B5）：降權的插入標籤鈕。
                    // Disabled state mirrors `.input-field` chrome so the
                    // button reads as part of the same input strip until the
                    // user types something insertable.
                    background: insertable
                      ? 'transparent'
                      : 'var(--bg-input)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: insertable
                      ? 'var(--text-secondary)'
                      : 'var(--text-muted)',
                    cursor: insertable ? 'pointer' : 'default',
                    fontSize: scaledFs(11),
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    minWidth: 72,
                    // alignSelf: 'stretch' makes the button match the row's
                    // height (driven by the input-field). More robust than
                    // a hardcoded minHeight that can drift when the input's
                    // padding or font-size changes.
                    alignSelf: 'stretch',
                    boxSizing: 'border-box',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 12px',
                    fontWeight: 600,
                    transition: 'background-color 0.15s, border-color 0.15s',
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  {labelText}
                </button>
              )
            })()}
            <button
              type="button"
              className="icon-btn danger"
              aria-label="移除 asset 參考"
              onClick={() => removeAssetRef(idx)}
              style={{ width: 26, height: 26, flexShrink: 0 }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          )
        })}
        <div className="hint">
          輸入 asset ID（如 asset-20260224213258-pnqkh）以 asset:// URI 送出；或直接貼上 https URL（例如前一段任務的 video_url / last_frame_url）作為串接輸入。
        </div>
      </div>

      {/* Reference Images */}
      <MediaUploader
        label={
          mode === 'first_frame'
            ? '首幀圖片'
            : mode === 'first_last_frame'
              ? '首尾幀圖片'
              : '參考圖片'
        }
        accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] }}
        items={referenceImages}
        maxItems={mode === 'first_frame' ? 1 : mode === 'first_last_frame' ? 2 : SD25_MAX_MULTIMODAL_IMAGES}
        onAdd={addReferenceImage}
        onRemove={removeReferenceImage}
        hint={
          mode === 'multimodal'
            ? '0–30 張；多張大圖請留意總請求 ≤64MB（圖片以 base64 送出）'
            : undefined
        }
        labels={labels.imageLabels}
        onLabelClick={insertIntoPrompt}
        roleBadges={imageRoleBadges}
        incompatibleIdx={compat.incompatibleImageIndexes}
        showRoleDropdown={mode === 'first_last_frame'}
        roleChoices={['first_frame', 'last_frame']}
        onRoleChange={(idx, role) => useVideo25Store.getState().setImageRole(idx, role)}
      />

      {/* Reference Videos */}
      <MediaUploader
        label="參考影片"
        accept={{ 'video/*': ['.mp4', '.mov'] }}
        items={referenceVideos}
        maxItems={10}
        onAdd={addReferenceVideo}
        onRemove={removeReferenceVideo}
        hint="0–10 段，單段 2–30 秒、總長 ≤ 30 秒（mp4 / mov）"
        labels={labels.videoLabels}
        onLabelClick={insertIntoPrompt}
        disabled={!tosReady}
        disabledHint="請先設定物件儲存憑證"
        locked={mode !== 'multimodal'}
        lockedHint="此模式不支援，需多模態模式才能使用"
      />

      {/* Reference Audio — accept 依官方 01 文件收斂為 wav / mp3（與下方 hint 一致）。
          放行 .aac / .m4a 只會讓使用者白傳一次 TOS 再被 API 退件。 */}
      <MediaUploader
        label="參考音訊"
        accept={{ 'audio/*': ['.mp3', '.wav'] }}
        items={referenceAudios}
        maxItems={10}
        onAdd={addReferenceAudio}
        onRemove={removeReferenceAudio}
        hint="0–10 段，單段 2–30 秒、總長 ≤ 30 秒（wav / mp3）"
        labels={labels.audioLabels}
        onLabelClick={insertIntoPrompt}
        disabled={!tosReady}
        disabledHint="請先設定物件儲存憑證"
        locked={mode !== 'multimodal'}
        lockedHint="此模式不支援"
      />

      {/* 基本參數 — 解析度 / 畫面比例 / 影片長度 3 欄 grid（handoff §B3）。
          DOM 順序維持 解析度 → 畫面比例 → 影片長度。 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8,
        marginBottom: 16,
      }}>
        <div>
          <label className="label" style={{ fontSize: scaledFs(11), color: 'var(--text-muted)', marginBottom: 4 }}>解析度</label>
          <select
            className="select-field"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {RESOLUTION_OPTIONS_25.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="video25-ratio-select" style={{ fontSize: scaledFs(11), color: 'var(--text-muted)', marginBottom: 4 }}>畫面比例</label>
          <select
            id="video25-ratio-select"
            aria-label="畫面比例"
            className="select-field"
            value={mode === 'multimodal' ? ratio : 'adaptive'}
            disabled={mode !== 'multimodal'}
            title={mode !== 'multimodal' ? '首幀/首尾幀任務自動跟隨首幀圖比例（官方鎖定 adaptive）' : undefined}
            onChange={(e) => setRatio(e.target.value)}
          >
            {RATIO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" style={{ fontSize: scaledFs(11), color: 'var(--text-muted)', marginBottom: 4 }}>影片長度</label>
          <select
            className="select-field"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {DURATION_OPTIONS_25.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Toggle: Return Last Frame — sr-only checkbox + label（a11y，§B4）。
          視覺 span 保留 toggle 類與 data-testid。 */}
      <div style={{ marginBottom: 12 }}>
        <label
          htmlFor="video-return-last-frame"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
        >
          <div>
            <span style={{ fontSize: scaledFs(14) }}>回傳尾幀</span>
            <div className="hint" style={{ marginTop: 2 }}>方便將前段尾幀作為下段首幀串接出長片</div>
          </div>
          <input
            id="video-return-last-frame"
            className="sr-only"
            type="checkbox"
            aria-label="回傳尾幀"
            checked={returnLastFrame}
            onChange={(e) => setReturnLastFrame(e.target.checked)}
          />
          <span
            aria-hidden="true"
            data-testid="toggle-return-last-frame"
            className={`toggle ${returnLastFrame ? 'active' : ''}`}
            style={{ display: 'inline-block', flexShrink: 0 }}
          />
        </label>
      </div>

      {/* Toggle: Generate Audio */}
      <div style={{ marginBottom: 12 }}>
        <label
          htmlFor="video-generate-audio"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: scaledFs(14) }}>生成音訊</span>
          <input
            id="video-generate-audio"
            className="sr-only"
            type="checkbox"
            aria-label="生成音訊"
            checked={generateAudio}
            onChange={(e) => setGenerateAudio(e.target.checked)}
          />
          <span
            aria-hidden="true"
            className={`toggle ${generateAudio ? 'active' : ''}`}
            style={{ display: 'inline-block', flexShrink: 0 }}
          />
        </label>
      </div>

      {/* 進階設定折疊（handoff §B2）— Seed / 任務最長等待時間 / 浮水印。
          預設收合；內容條件渲染。 */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <Icon
            name="chevron-right"
            size={12}
            style={{
              color: 'var(--text-muted)',
              flexShrink: 0,
              transform: advancedOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          />
          <span style={{ flex: 1, fontSize: scaledFs(13), fontWeight: 500 }}>進階設定</span>
          <span style={{ fontSize: scaledFs(11), color: 'var(--text-muted)' }}>Seed · 等待時間 · 浮水印</span>
        </button>
        {advancedOpen && (
          <div style={{ padding: '12px 12px 4px', borderTop: '1px solid var(--border)' }}>
            {/* Seed */}
            <div style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="video-seed-input">隨機種子 (Seed)</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  id="video-seed-input"
                  className="input-field"
                  type="number"
                  min={-1}
                  max={4294967295}
                  step={1}
                  value={seedDisplay}
                  onChange={(e) => {
                    const raw = e.target.value
                    setSeedDisplay(raw)
                    const n = raw === '' ? -1 : Number(raw)
                    setSeed(Number.isFinite(n) ? n : -1)
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  aria-label="隨機 seed"
                  title="產生隨機 seed（可重現的固定值）"
                  onClick={() => {
                    const n = Math.floor(Math.random() * 4294967296)
                    setSeed(n)
                    setSeedDisplay(String(n))
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: '6px 10px',
                    fontSize: scaledFs(14),
                    flexShrink: 0,
                  }}
                >
                  隨機
                </button>
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                <code>-1</code> 代表每次隨機；指定整數可在相同提示詞下取得相似輸出。
              </div>
            </div>

            {/* Execution expires after — task TTL, sent to ARK as execution_expires_after */}
            <div style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="video-exec-expires">任務最長等待時間</label>
              <select
                id="video-exec-expires"
                className="input-field"
                value={executionExpiresAfter}
                onChange={(e) => setExecutionExpiresAfter(Number(e.target.value))}
              >
                {EXECUTION_EXPIRES_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="hint" style={{ marginTop: 4 }}>
                達到時間且任務仍未完成（含排隊）會被自動標記為 expired。
              </div>
            </div>

            {/* Toggle: Watermark */}
            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor="video-watermark"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <span style={{ fontSize: scaledFs(14) }}>浮水印</span>
                  <div className="hint" style={{ marginTop: 2 }}>在輸出中加入浮水印</div>
                </div>
                <input
                  id="video-watermark"
                  className="sr-only"
                  type="checkbox"
                  aria-label="浮水印"
                  checked={watermark}
                  onChange={(e) => setWatermark(e.target.checked)}
                />
                <span
                  aria-hidden="true"
                  className={`toggle ${watermark ? 'active' : ''}`}
                  style={{ display: 'inline-block', flexShrink: 0 }}
                />
              </label>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Sticky footer — CTA + block-reason hint + active tasks（handoff §B1） */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <button
          className="btn-primary"
          disabled={!canGenerate || optFlow.loading || submitting}
          onClick={handleGenerate}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
          }}
        >
          <Icon name="play" size={14} />
          {optFlow.open && optFlow.loading ? '優化中…' : '生成影片'}
        </button>
        {/* credsOK 會被 optimizeBlocked 拉成 false，改以 apiKey 為門檻，
            否則「提示詞優化需要文字生成接入點」永遠顯示不出來。 */}
        {generateBlockReason && !!apiKey && (
          <div className="hint" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            {generateBlockReason}
          </div>
        )}

        {/* Active tasks indicator */}
        {activeCount > 0 && (
          <div style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-bd)',
            fontSize: scaledFs(12),
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span className="spinner" style={{ width: 12, height: 12 }} />
            {activeCount} 個任務進行中
          </div>
        )}
      </div>

      {/* T20: Confirm clearing incompatible items. Reverse-order removal
          keeps indexes valid as we splice — both per-thumb-index lists and
          the video / audio bulk removals walk from the end. */}
      <ConfirmModal
        open={showClearConfirm}
        title={`清掉 ${incompatCount} 個不相容項目？`}
        subtitle="保留與目前模式相容的部分。"
        confirmLabel="清掉"
        variant="danger"
        onConfirm={() => {
          const s = useVideo25Store.getState()
          compat.incompatibleImageIndexes
            .slice()
            .reverse()
            .forEach((i) => s.removeReferenceImage(i))
          if (compat.incompatibleVideosFlag) {
            for (let i = referenceVideos.length - 1; i >= 0; i--) {
              s.removeReferenceVideo(i)
            }
          }
          if (compat.incompatibleAudiosFlag) {
            for (let i = referenceAudios.length - 1; i >= 0; i--) {
              s.removeReferenceAudio(i)
            }
          }
          compat.incompatibleAssetRefIndexes
            .slice()
            .reverse()
            .forEach((i) => s.removeAssetRef(i))
          setShowClearConfirm(false)
        }}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* 條件渲染（而非只切 open prop）：每次優化都讓 Modal 全新 mount，
          編輯區狀態隨卸載歸零。
          注意這是防禦縱深，不是唯一機制：「編輯過 → 重試 → LLM 回傳位元組完全相同的
          結果」這條路徑其實已被 Modal 內部的 props-diff 同步接住（重試會先經過
          loading + optimizedPrompt:''，該次變動就會重設編輯區）。留著條件渲染是結構性
          保險——往後若有人改動重試路徑而不再經過 optimizedPrompt:''，殘留編輯內容
          被當成本次結果送出的 bug 不會回歸。 */}
      {optFlow.open && (
        <PromptOptimizeModal
          open={optFlow.open}
          loading={optFlow.loading}
          error={optFlow.error}
          taskType={optFlow.result?.taskType ?? 'unknown'}
          originalPrompt={optFlow.prepared?.prompt ?? ''}
          optimizedPrompt={optFlow.result?.prompt ?? ''}
          fixNote={optFixNote}
          onConfirm={(finalPrompt) => {
            const prepared = optFlow.prepared
            if (!prepared) return
            optAbortRef.current = null
            setOptFlow({ open: false, loading: false })
            if (optFixNote) toast(optFixNote)
            applyFixesToStore(optFixes)
            void runSubmit(prepared, finalPrompt, {
              originalPrompt: prepared.prompt,
              ...optFixes,
            })
          }}
          onUseOriginal={() => {
            const prepared = optFlow.prepared
            if (!prepared) return
            optAbortRef.current = null
            setOptFlow({ open: false, loading: false })
            // 參數修正必須照樣套用。API 是依 content.role + 提示詞觸發詞判定任務類型，
            // 不是依我們送哪一份提示詞字串——兩條路徑的 role 與使用者意圖完全相同，
            // 而 taskType 本來就是從「原文」推導出來的（runOptimize 送的是 prepared.prompt），
            // 所以用原文生成被判成 edit 的機率只高不低。少了這行就會送出 duration:10
            // 換來非同步的 InvalidParameter.TaskTypeConstraint 失敗。
            // 刻意不帶 originalPrompt：使用者否決了改寫，history 的「已優化」徽章不該亮。
            if (optFixNote) toast(optFixNote)
            applyFixesToStore(optFixes)
            void runSubmit(prepared, prepared.prompt, { ...optFixes })
          }}
          onCancel={cancelOptimize}
          onRetry={() => {
            if (optFlow.prepared) void runOptimize(optFlow.prepared)
          }}
        />
      )}
    </div>
  )
}
