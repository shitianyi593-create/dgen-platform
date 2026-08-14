// Seedance 2.5 参数面板 — copy-fork 自 VideoParams.tsx（spec rev3 §4）。
// TODO(tech-debt): seedanceModels 能力表合并 — 差异仅在选项/上限/标签格式/优化流程，
// 终局应与 VideoParams 合并为能力表驱动的单一组件。
// TODO(tech-debt): 优化流程（optFlow / runOptimize / cancelOptimize / optFixes）应抽成
// useVideo25OptimizeFlow hook，让本组件回到纯渲染；目前刻意留在档内以缩小 review 面。
// TODO(tech-debt): OptFlowState 应改为 discriminated union（idle | loading | ready | error），
// 现有的 result/error/prepared 可选字段允许了几種实际到不了的组合（例如 result 与 error
// 同时存在）。今天所有 setOptFlow 呼叫点都只产生合法组合，故仅列为债务。
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
import { useOptionalI18n } from '../../i18n/useOptionalI18n'
import type { Locale, MessageKey } from '../../i18n/locales'
import {
  optimizePrompt, computeParamFixes,
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

function ratioLabel(value: string, locale: Locale) {
  const zh = locale === 'zh-CN'
  switch (value) {
    case 'adaptive': return zh ? 'Adaptive（自动依输入选择）' : 'Adaptive (based on input)'
    case '16:9': return zh ? '16:9 (横向)' : '16:9 (landscape)'
    case '9:16': return zh ? '9:16 (竖向)' : '9:16 (portrait)'
    case '1:1': return zh ? '1:1 (方形)' : '1:1 (square)'
    case '21:9': return zh ? '21:9 (超宽)' : '21:9 (ultrawide)'
    default: return value
  }
}

function durationLabel(value: number, locale: Locale) {
  if (value === -1) return locale === 'zh-CN' ? 'Auto（模型自选）' : 'Auto (model decides)'
  return locale === 'zh-CN' ? `${value} 秒` : `${value}s`
}

function executionExpiresLabel(value: number, locale: Locale) {
  const zh = locale === 'zh-CN'
  const hours = value / 3600
  if (hours === 1) return zh ? '1 小时 (默认)' : '1 hour (default)'
  if (hours === 72) return zh ? '72 小时 (最长)' : '72 hours (max)'
  return zh ? `${hours} 小时` : `${hours} hours`
}

function promptOptimizeFixNote(
  fixes: ParamFixes,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
) {
  const parts: string[] = []
  if (fixes.duration !== undefined) parts.push(t('video25.optimize.fixDuration'))
  if (fixes.ratio !== undefined) parts.push(t('video25.optimize.fixRatio'))
  return parts.length > 0 ? parts.join(t('common.listSeparator')) : null
}

/** 优化流程状态（spec §6.3）。`prepared` 是按下生成当下的参数快照，
 *  Modal 确认时据此送出，避免用户在 Modal 打开期间改动参数造成不一致。 */
interface OptFlowState {
  open: boolean
  loading: boolean
  error?: string
  result?: Sd25OptimizeResult
  prepared?: PreparedSubmit
}

export default function Video25Params({ width = VIDEO25_PARAMS_DEFAULT_WIDTH }: Video25ParamsProps) {
  const { locale, t } = useOptionalI18n()
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

  // 高级设置折叠（Seed / 任务最长等待时间 / 水印）— 默认收起。
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const { prepare, submit } = useVideo25Generation()

  const [optFlow, setOptFlow] = useState<OptFlowState>({ open: false, loading: false })
  // 进行中的 optimizePrompt 请求。取消（取消键 / Escape / 遮罩）必须 abort，
  // 否则晚回来的响应会把已关闭的 Modal 重新打开（PromptOptimizeModal onCancel 契约）。
  const optAbortRef = useRef<AbortController | null>(null)
  // 卸载时收掉在途请求：离开页面后响应已无处可去，让 LLM 呼叫继续跑只是浪费配额，
  // 且回呼会对已卸载的组件 setState。
  useEffect(() => () => optAbortRef.current?.abort(), [])

  // 送出中旗标 — 用来挡住重复点击。submit() 全程 async（base64 编码 + 创建任务），
  // 期间按钮若仍可按，两次快点就会建出两个任务。Modal 确认时也走同一支，
  // 因为 onConfirm 先关 Modal、submit 还在跑，那段空窗同样可再按一次生成。
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

  // 任务类型修正回写 store（spec §3）：edit/extend 对这些值的要求是硬约束，
  // 只改请求不改面板会让 toast 说「已改为 Auto」而面板还显示 10 秒，
  // 且下一次生成又会静默送回错的值。
  const applyFixesToStore = useCallback((fixes: ParamFixes) => {
    if (fixes.duration !== undefined) setDuration(fixes.duration)
    if (fixes.ratio !== undefined) setRatio(fixes.ratio)
  }, [setDuration, setRatio])

  const runOptimize = useCallback(async (prepared: PreparedSubmit) => {
    // 重试时先收掉上一轮（若仍在途），避免两个响应競写同一份 state。
    optAbortRef.current?.abort()
    const controller = new AbortController()
    optAbortRef.current = controller
    setOptFlow({ open: true, loading: true, prepared })
    try {
      // 素材一律取自 prepared 快照（按下生成当下的事实），标签依同一份快照
      // 重算 — Modal 打开期间用户增删素材不会污染重试的 context。
      // 「+ 新增」但没填 id 的空列必须先滤掉：submit() 会略过它们（`if (!trimmed) continue`），
      // 若这里仍计入编号，LLM 拿到的 @ImageN 会比实际送出的素材多一个，
      // 之后每个标签都指向错的素材。编号口径必须与 submit() 完全一致。
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
      // 用户取消造成的 rejection（AbortError）不是优化失败 — 静默收场，
      // Modal 已由 cancelOptimize 关闭，不要把它重新打开成错误态。
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
  const optFixNote = promptOptimizeFixNote(optFixes, t)

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
  // caret across that blur. External prompt rewrites (加载参数 / 新任务)
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
  // 2.5 的视频接入点可留空（fallback 到官方 model id），但打开提示词优化
  // 就必须有文字生成接入点才能呼叫 LLM。
  const optimizeBlocked = promptOptimize && !textEndpoint.trim()
  const credsOK = !!apiKey && !!prompt.trim() && !optimizeBlocked
  const canGenerate = credsOK && compat.canGenerate

  // Single source of truth for the disable reason — same priority order as
  // useVideo25Generation prepare() so the inline hint matches the toast users
  // would see if they somehow clicked through.
  const generateBlockReason: string | null =
    !apiKey ? t('video.block.apiKey')
    : !prompt.trim() ? t('video.block.prompt')
    : optimizeBlocked ? t('video25.block.textEndpoint')
    : !compat.imageCountOK ? t('video.block.imageCount')
    : !compat.roleSetOK ? t('video.block.roleSet')
    : compat.incompatibleImageIndexes.length ? t('video.block.imageRole')
    : compat.incompatibleVideosFlag ? t('video.block.videoNotAllowed')
    : compat.incompatibleAudiosFlag ? t('video.block.audioNotAllowed')
    : compat.incompatibleAssetRefIndexes.length ? t('video.block.assetRef')
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
  // 滚动内容 + sticky footer（handoff §B1）：外层锁 overflow，
  // 内容区独立滚动，CTA / 提示 / 任务进行中固定在 footer。
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
        <label className="label">{t('video.model')}</label>
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
          <label className="label" style={{ margin: 0 }}>{t('video.prompt')}</label>
          <button
            type="button"
            onClick={() => resetForNewTask()}
            title={t('video.newTaskTitle')}
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
            {t('video.newTask')}
          </button>
        </div>
        <textarea
          ref={promptRef}
          className="input-field"
          placeholder={t('video.promptPlaceholder')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onSelect={(e) => captureSelection(e.currentTarget)}
          onBlur={(e) => captureSelection(e.currentTarget)}
          rows={4}
          style={{ resize: 'vertical', minHeight: 80 }}
        />
        <div className="hint" style={{ marginTop: 4 }}>
          {t('video25.promptHint')}
        </div>
        {/* 提示词优化开关（spec §6.1）— 2.5 页常驻 */}
        <div style={{ marginTop: 10 }}>
          <label
            htmlFor="video25-prompt-optimize"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          >
            <div>
              <span style={{ fontSize: scaledFs(14) }}>{t('video25.optimize.toggle')}</span>
              <div className="hint" style={{ marginTop: 2 }}>
                {t('video25.optimize.toggleHint')}
              </div>
            </div>
            <input
              id="video25-prompt-optimize"
              className="sr-only"
              type="checkbox"
              aria-label={t('video25.optimize.toggle')}
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
        <label className="label">{t('video.mode')}</label>
        <div style={{
          display: 'flex', gap: 2,
          background: 'var(--bg-input)',
          borderRadius: 8,
          padding: 3,
        }}>
          {([
            { v: 'first_frame', label: t('video.mode.firstFrame') },
            { v: 'first_last_frame', label: t('video.mode.firstLastFrame') },
            { v: 'multimodal', label: t('video.mode.multimodal') },
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
          {mode === 'first_frame' && t('video.modeHint.firstFrame')}
          {mode === 'first_last_frame' && t('video.modeHint.firstLastFrame')}
          {mode === 'multimodal' && t('video25.modeHint.multimodal')}
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
              ? t('video.incompat.count', { count: incompatCount })
              : t('video.incompat.params')}
          </div>
          <div style={{ marginTop: 2 }}>{generateBlockReason ?? t('video.incompat.defaultHint')}</div>
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
              {t('video.incompat.clear')}
            </button>
          )}
        </div>
      )}

      {/* Asset references — placed right after prompt so users can grab the
          [Type N] number to type into the prompt. */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            {t('video.assetReference')} <span style={{ color: 'var(--text-muted)' }}>({assetRefs.length})</span>
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
            {t('video.add')}
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
              <option value="image">{t('video.type.image')}</option>
              <option value="video">{t('video.type.video')}</option>
              <option value="audio">{t('video.type.audio')}</option>
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
                <option value="first_frame">{t('video.role.firstFrame')}</option>
                <option value="last_frame">{t('video.role.lastFrame')}</option>
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
                      ? t('video.insertAssetLabel', { label: labelText })
                      : t('video.invalidAssetLabel')
                  }
                  title={
                    insertable
                      ? t('video.insertAssetTitle')
                      : t('video.invalidAssetTitle')
                  }
                  disabled={!insertable}
                  onClick={() => insertIntoPrompt(labelText)}
                  style={{
                    // Ghost 样式（handoff §B5）：降权的插入标签钮。
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
              aria-label={t('video.removeAssetReference')}
              onClick={() => removeAssetRef(idx)}
              style={{ width: 26, height: 26, flexShrink: 0 }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          )
        })}
        <div className="hint">
          {t('video.assetHint')}
        </div>
      </div>

      {/* Reference Images */}
      <MediaUploader
        label={
          mode === 'first_frame'
            ? t('video.referenceImages.firstFrame')
            : mode === 'first_last_frame'
              ? t('video.referenceImages.firstLastFrame')
              : t('video.referenceImages.default')
        }
        accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] }}
        items={referenceImages}
        maxItems={mode === 'first_frame' ? 1 : mode === 'first_last_frame' ? 2 : SD25_MAX_MULTIMODAL_IMAGES}
        onAdd={addReferenceImage}
        onRemove={removeReferenceImage}
        hint={
          mode === 'multimodal'
            ? t('video25.referenceImages.hint')
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
        label={t('video.referenceVideo')}
        accept={{ 'video/*': ['.mp4', '.mov'] }}
        items={referenceVideos}
        maxItems={10}
        onAdd={addReferenceVideo}
        onRemove={removeReferenceVideo}
        hint={t('video25.referenceVideo.hint')}
        labels={labels.videoLabels}
        onLabelClick={insertIntoPrompt}
        disabled={!tosReady}
        disabledHint={t('video.objectStorageRequired')}
        locked={mode !== 'multimodal'}
        lockedHint={t('video.modeRequiresMultimodal')}
      />

      {/* Reference Audio — accept 依官方 01 文件收敛为 wav / mp3（与下方 hint 一致）。
          放行 .aac / .m4a 只会让用户白传一次 TOS 再被 API 退件。 */}
      <MediaUploader
        label={t('video.referenceAudio')}
        accept={{ 'audio/*': ['.mp3', '.wav'] }}
        items={referenceAudios}
        maxItems={10}
        onAdd={addReferenceAudio}
        onRemove={removeReferenceAudio}
        hint={t('video25.referenceAudio.hint')}
        labels={labels.audioLabels}
        onLabelClick={insertIntoPrompt}
        disabled={!tosReady}
        disabledHint={t('video.objectStorageRequired')}
        locked={mode !== 'multimodal'}
        lockedHint={t('video.modeUnsupported')}
      />

      {/* 基本参数 — 分辨率 / 画面比例 / 视频长度 3 栏 grid（handoff §B3）。
          DOM 顺序维持 分辨率 → 画面比例 → 视频长度。 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8,
        marginBottom: 16,
      }}>
        <div>
          <label className="label" style={{ fontSize: scaledFs(11), color: 'var(--text-muted)', marginBottom: 4 }}>{t('video.resolution')}</label>
          <select
            className="select-field"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {RESOLUTION_OPTIONS_25.map((o) => (
              <option key={o.value} value={o.value}>{o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="video25-ratio-select" style={{ fontSize: scaledFs(11), color: 'var(--text-muted)', marginBottom: 4 }}>{t('video.aspectRatio')}</label>
          <select
            id="video25-ratio-select"
            aria-label={t('video.aspectRatio')}
            className="select-field"
            value={mode === 'multimodal' ? ratio : 'adaptive'}
            disabled={mode !== 'multimodal'}
            title={mode !== 'multimodal' ? t('video25.ratioLockedTitle') : undefined}
            onChange={(e) => setRatio(e.target.value)}
          >
            {RATIO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{ratioLabel(o.value, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" style={{ fontSize: scaledFs(11), color: 'var(--text-muted)', marginBottom: 4 }}>{t('video.duration')}</label>
          <select
            className="select-field"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {DURATION_OPTIONS_25.map((o) => (
              <option key={o.value} value={o.value}>{durationLabel(o.value, locale)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Toggle: Return Last Frame — sr-only checkbox + label（a11y，§B4）。
          视觉 span 保留 toggle 类与 data-testid。 */}
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
            <span style={{ fontSize: scaledFs(14) }}>{t('video.returnLastFrame')}</span>
            <div className="hint" style={{ marginTop: 2 }}>{t('video.returnLastFrameHint')}</div>
          </div>
          <input
            id="video-return-last-frame"
            className="sr-only"
            type="checkbox"
            aria-label={t('video.returnLastFrame')}
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
          <span style={{ fontSize: scaledFs(14) }}>{t('video.generateAudio')}</span>
          <input
            id="video-generate-audio"
            className="sr-only"
            type="checkbox"
            aria-label={t('video.generateAudio')}
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

      {/* 高级设置折叠（handoff §B2）— Seed / 任务最长等待时间 / 水印。
          默认收起；内容条件渲染。 */}
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
          <span style={{ flex: 1, fontSize: scaledFs(13), fontWeight: 500 }}>{t('video.advanced')}</span>
          <span style={{ fontSize: scaledFs(11), color: 'var(--text-muted)' }}>{t('video.advancedSummary')}</span>
        </button>
        {advancedOpen && (
          <div style={{ padding: '12px 12px 4px', borderTop: '1px solid var(--border)' }}>
            {/* Seed */}
            <div style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="video-seed-input">{t('video.seed')}</label>
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
                  aria-label={t('video.randomSeed')}
                  title={t('video.randomSeedTitle')}
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
                  {t('video.random')}
                </button>
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                {t('video.seedHint')}
              </div>
            </div>

            {/* Execution expires after — task TTL, sent to ARK as execution_expires_after */}
            <div style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="video-exec-expires">{t('video.executionExpires')}</label>
              <select
                id="video-exec-expires"
                className="input-field"
                value={executionExpiresAfter}
                onChange={(e) => setExecutionExpiresAfter(Number(e.target.value))}
              >
                {EXECUTION_EXPIRES_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{executionExpiresLabel(o.value, locale)}</option>
                ))}
              </select>
              <div className="hint" style={{ marginTop: 4 }}>
                {t('video.executionExpiresHint')}
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
                  <span style={{ fontSize: scaledFs(14) }}>{t('video.watermark')}</span>
                  <div className="hint" style={{ marginTop: 2 }}>{t('video.watermarkHint')}</div>
                </div>
                <input
                  id="video-watermark"
                  className="sr-only"
                  type="checkbox"
                  aria-label={t('video.watermark')}
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
          {optFlow.open && optFlow.loading ? t('video25.optimize.optimizingShort') : t('video.generate')}
        </button>
        {/* credsOK 会被 optimizeBlocked 拉成 false，改以 apiKey 为门槛，
            否则「提示词优化需要文字生成接入点」永远显示不出来。 */}
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
            {t('video.activeTasks', { count: activeCount })}
          </div>
        )}
      </div>

      {/* T20: Confirm clearing incompatible items. Reverse-order removal
          keeps indexes valid as we splice — both per-thumb-index lists and
          the video / audio bulk removals walk from the end. */}
      <ConfirmModal
        open={showClearConfirm}
        title={t('video.incompat.confirmTitle', { count: incompatCount })}
        subtitle={t('video.incompat.confirmSubtitle')}
        confirmLabel={t('video.incompat.confirmLabel')}
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

      {/* 条件渲染（而非只切 open prop）：每次优化都让 Modal 全新 mount，
          编辑区状态随卸载归零。
          注意这是防御纵深，不是唯一机制：「编辑过 → 重试 → LLM 返回字节完全相同的
          结果」这条路径其实已被 Modal 内部的 props-diff 同步接住（重试会先经过
          loading + optimizedPrompt:''，该次变动就会重设编辑区）。留着条件渲染是结构性
          保险——往后若有人改动重试路径而不再经过 optimizedPrompt:''，残留编辑内容
          被当成本次结果送出的 bug 不会回归。 */}
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
            // 参数修正必须照样套用。API 是依 content.role + 提示词触发词判定任务类型，
            // 不是依我们送哪一份提示词字符串——两条路径的 role 与用户意图完全相同，
            // 而 taskType 本来就是从「原文」推导出来的（runOptimize 送的是 prepared.prompt），
            // 所以用原文生成被判成 edit 的概率只高不低。少了这行就会送出 duration:10
            // 换来非同步的 InvalidParameter.TaskTypeConstraint 失败。
            // 刻意不带 originalPrompt：用户否决了改写，history 的「已优化」徽章不该亮。
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
