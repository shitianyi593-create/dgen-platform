import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import Video25Params from '../components/video25/Video25Params'
import { useVideo25Store } from '../stores/video25Store'
import { useAuthStore } from '../stores/authStore'
import { optimizePrompt } from '../utils/sd25PromptOptimizer'
import { createVideoTask } from '../api/video'
import toast from 'react-hot-toast'
import { messages } from '../i18n/locales'

const t = messages['zh-CN']

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
// 优化器走网路 — 组件测试一律 mock
vi.mock('../utils/sd25PromptOptimizer', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../utils/sd25PromptOptimizer')>()
  return { ...orig, optimizePrompt: vi.fn() }
})
vi.mock('../api/video', () => ({ createVideoTask: vi.fn().mockResolvedValue({ id: 'cgt-x' }) }))

describe('Video25Params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useVideo25Store.setState(useVideo25Store.getInitialState())
    useAuthStore.setState({
      apiKey: 'k', endpoint: '', videoEndpoint25: '', textEndpoint: '',
      tosCreds: { accessKeyId: '', accessKeySecret: '', region: 'ap-southeast-1', bucket: '' },
    })
  })

  it('model select shows a static Seedance 2.5', () => {
    render(<Video25Params />)
    expect(screen.getByRole('option', { name: 'Seedance 2.5' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Seedance 2.0' })).not.toBeInTheDocument()
  })

  it('resolution has no 1080p; duration offers Auto and 30 秒', () => {
    render(<Video25Params />)
    expect(screen.queryByRole('option', { name: '1080p' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Auto（模型自选）' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '30 秒' })).toBeInTheDocument()
  })

  it('ratio select is locked to adaptive in first_frame mode', () => {
    useVideo25Store.setState({ mode: 'first_frame' })
    render(<Video25Params />)
    const ratioSelect = screen.getByLabelText(t['video.aspectRatio']) as HTMLSelectElement
    expect(ratioSelect.disabled).toBe(true)
    expect(ratioSelect.value).toBe('adaptive')
  })

  it('ratio select is enabled in multimodal mode', () => {
    render(<Video25Params />)
    const ratioSelect = screen.getByLabelText(t['video.aspectRatio']) as HTMLSelectElement
    expect(ratioSelect.disabled).toBe(false)
  })

  it('shows the prompt optimize toggle and persists it to the store', () => {
    render(<Video25Params />)
    const toggle = screen.getByLabelText(t['video25.optimize.toggle']) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(useVideo25Store.getState().promptOptimize).toBe(true)
  })

  it('blocks generate with a reason when optimize is ON but textEndpoint missing', () => {
    useVideo25Store.setState({ prompt: 'p', promptOptimize: true })
    render(<Video25Params />)
    expect(screen.getByText(t['video25.block.textEndpoint'])).toBeInTheDocument()
    expect((screen.getByRole('button', { name: new RegExp(t['video.generate']) }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('image labels use the @ format', () => {
    useVideo25Store.getState().addReferenceImage({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      preview: 'blob:a', uploading: false, role: 'reference_image',
    })
    render(<Video25Params />)
    // 提示词说明也印了一份 <code>@Image1</code>，所以锁定素材缩图上的标签徽章。
    expect(screen.getByTestId('media-label-badge')).toHaveTextContent('@Image1')
  })

  it('runs the optimize flow and submits the edited prompt with original-prompt provenance', async () => {
    useVideo25Store.setState({ prompt: 'p', promptOptimize: true })
    useAuthStore.setState({ textEndpoint: 'ep-text' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t['video.generate']) }))

    const ta = (await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])) as HTMLTextAreaElement
    expect(ta.value).toBe('OPT')
    fireEvent.change(ta, { target: { value: 'OPT edited' } })
    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.confirmGenerate'] }))

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    expect(vi.mocked(createVideoTask).mock.calls[0][0].content[0])
      .toEqual({ type: 'text', text: 'OPT edited' })
    await waitFor(() =>
      expect(useVideo25Store.getState().history[0]?.originalPrompt).toBe('p'),
    )
  })

  it('aborts the in-flight optimize request on cancel; a late rejection does not reopen the modal', async () => {
    useVideo25Store.setState({ prompt: 'p', promptOptimize: true })
    useAuthStore.setState({ textEndpoint: 'ep-text' })
    let signal: AbortSignal | undefined
    let reject: (e: unknown) => void = () => {}
    vi.mocked(optimizePrompt).mockImplementation((_ctx, _ep, s) => {
      signal = s
      return new Promise((_res, rej) => { reject = rej })
    })

    render(<Video25Params />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t['video.generate']) }))
    await screen.findByRole('dialog')
    expect(signal?.aborted).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: t['common.cancel'] }))
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // 晚到的 AbortError 不得被当成优化失败把 Modal 重新打开
    await act(async () => { reject(new DOMException('canceled', 'AbortError')) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // ── 优化流程 × 参数修正的组合（本组件才存在的接线；纯函数层已各自单测） ──

  /** 开优化 + 有文字接入点 + 指定参数的共用前置。 */
  function setupOptimizeFlow(overrides: Partial<{ duration: number; ratio: string; prompt: string }> = {}) {
    useVideo25Store.setState({
      prompt: overrides.prompt ?? 'p',
      promptOptimize: true,
      mode: 'multimodal',
      duration: overrides.duration ?? -1,
      ratio: overrides.ratio ?? 'adaptive',
    })
    useAuthStore.setState({ textEndpoint: 'ep-text' })
  }

  const clickGenerate = () =>
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t['video.generate']) }))

  it('edit 任务：请求锁 duration=-1 + ratio=adaptive，跳修正 toast，并回写 store', async () => {
    setupOptimizeFlow({ duration: 10, ratio: '16:9' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'edit', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])
    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.confirmGenerate'] }))

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.duration).toBe(-1)
    expect(body.ratio).toBe('adaptive')

    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.stringContaining('长度已自动改为 Auto'),
    )
    // 修正必须回写面板，否则 toast 说改了、UI 还显示 10 秒，下次生成又送回 10。
    expect(useVideo25Store.getState().duration).toBe(-1)
    expect(useVideo25Store.getState().ratio).toBe('adaptive')
  })

  it('extend 任务：只锁 ratio，duration 保持不动（spec §3 的 edit/extend 非对稱）', async () => {
    setupOptimizeFlow({ duration: 10, ratio: '16:9' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'extend', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])
    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.confirmGenerate'] }))

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.ratio).toBe('adaptive')
    expect(body.duration).toBe(10)
    expect(useVideo25Store.getState().ratio).toBe('adaptive')
    expect(useVideo25Store.getState().duration).toBe(10)
  })

  it('用原文生成：送原文、不留 originalPrompt 出处，但参数修正照样套用', async () => {
    setupOptimizeFlow({ duration: 10, ratio: '16:9', prompt: '原文' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'edit', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])
    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.useOriginal'] }))

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.content[0]).toEqual({ type: 'text', text: '原文' })
    // API 依 content.role + 触发词判任务类型，与我们送哪份提示词无关 —
    // 这条路径同样会被判成 edit，少了修正就会拿到 TaskTypeConstraint 失败。
    expect(body.duration).toBe(-1)
    expect(body.ratio).toBe('adaptive')

    await waitFor(() => expect(useVideo25Store.getState().history).toHaveLength(1))
    // 用户否决了改写 → history 不该亮「已优化」徽章。
    expect(useVideo25Store.getState().history[0].originalPrompt).toBeUndefined()
  })

  it('优化失败 → 重试 → 成功，可继续送出（错误态只在本组件可达）', async () => {
    setupOptimizeFlow()
    vi.mocked(optimizePrompt)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ taskType: 'reference', prompt: 'OPT2' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByText(/优化失败：boom/)

    fireEvent.click(screen.getByRole('button', { name: t['common.retry'] }))
    const ta = (await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])) as HTMLTextAreaElement
    expect(ta.value).toBe('OPT2')

    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.confirmGenerate'] }))
    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    expect(vi.mocked(createVideoTask).mock.calls[0][0].content[0])
      .toEqual({ type: 'text', text: 'OPT2' })
  })

  it('快照隔离：Modal 打开期间改动 store，送出的仍是按下生成当下的值', async () => {
    setupOptimizeFlow({ duration: 5, ratio: '16:9', prompt: 'SNAP' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])

    // 用户在 Modal 开著时继续动面板 —— 这些都不该影响本次送出。
    act(() => { useVideo25Store.setState({ prompt: 'CHANGED', duration: 12 }) })

    fireEvent.click(screen.getByRole('button', { name: t['video25.optimize.confirmGenerate'] }))
    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.duration).toBe(5)

    await waitFor(() => expect(useVideo25Store.getState().history).toHaveLength(1))
    expect(useVideo25Store.getState().history[0].originalPrompt).toBe('SNAP')
  })

  it('空的 asset 列不进优化器编号 — 标签口径与 submit() 真正送出的素材一致', async () => {
    setupOptimizeFlow()
    // 「+ 新增」建出但没填 id 的空列：submit() 会略过，优化器也不该替它编号，
    // 否则 LLM 被告知有 @Image1/@Image2，实际卻只送一份素材。
    useVideo25Store.setState({
      assetRefs: [
        { id: '', type: 'image' },
        { id: 'asset-real', type: 'image' },
      ],
    })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])

    const ctx = vi.mocked(optimizePrompt).mock.calls[0][0]
    expect(ctx.assets.map((a) => a.label)).toEqual(['@Image1'])
  })

  it('mode 也在快照内：失败后切模式再重试，优化 context 仍是按下生成当下的 mode', async () => {
    setupOptimizeFlow() // multimodal
    vi.mocked(optimizePrompt)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByText(/优化失败：boom/)

    // 用户在错误态下切了模式；重试用的素材快照仍是多模态那份，
    // mode 若改读 live store 就会组出「首帧模式 + 多模态素材」的假 context。
    act(() => { useVideo25Store.setState({ mode: 'first_frame' }) })

    fireEvent.click(screen.getByRole('button', { name: t['common.retry'] }))
    await screen.findByLabelText(t['video25.optimize.optimizedPrompt'])

    expect(vi.mocked(optimizePrompt).mock.calls[1][0].mode).toBe('multimodal')
  })

  it('优化开关 OFF：直送，不开 Modal、不呼叫 LLM', async () => {
    useVideo25Store.setState({ prompt: 'p', promptOptimize: false })
    useAuthStore.setState({ textEndpoint: 'ep-text' })

    render(<Video25Params />)
    clickGenerate()

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    expect(vi.mocked(createVideoTask).mock.calls[0][0].content[0])
      .toEqual({ type: 'text', text: 'p' })
    expect(vi.mocked(optimizePrompt)).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
