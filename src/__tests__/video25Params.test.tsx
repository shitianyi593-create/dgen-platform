import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import Video25Params from '../components/video25/Video25Params'
import { useVideo25Store } from '../stores/video25Store'
import { useAuthStore } from '../stores/authStore'
import { optimizePrompt } from '../utils/sd25PromptOptimizer'
import { createVideoTask } from '../api/video'
import toast from 'react-hot-toast'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
// 優化器走網路 — 元件測試一律 mock
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
    expect(screen.getByRole('option', { name: 'Auto（模型自選）' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '30 秒' })).toBeInTheDocument()
  })

  it('ratio select is locked to adaptive in first_frame mode', () => {
    useVideo25Store.setState({ mode: 'first_frame' })
    render(<Video25Params />)
    const ratioSelect = screen.getByLabelText('畫面比例') as HTMLSelectElement
    expect(ratioSelect.disabled).toBe(true)
    expect(ratioSelect.value).toBe('adaptive')
  })

  it('ratio select is enabled in multimodal mode', () => {
    render(<Video25Params />)
    const ratioSelect = screen.getByLabelText('畫面比例') as HTMLSelectElement
    expect(ratioSelect.disabled).toBe(false)
  })

  it('shows the prompt optimize toggle and persists it to the store', () => {
    render(<Video25Params />)
    const toggle = screen.getByLabelText('提示詞優化') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(useVideo25Store.getState().promptOptimize).toBe(true)
  })

  it('blocks generate with a reason when optimize is ON but textEndpoint missing', () => {
    useVideo25Store.setState({ prompt: 'p', promptOptimize: true })
    render(<Video25Params />)
    expect(screen.getByText('提示詞優化需要文字生成接入點')).toBeInTheDocument()
    expect((screen.getByRole('button', { name: /生成影片/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('image labels use the @ format', () => {
    useVideo25Store.getState().addReferenceImage({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      preview: 'blob:a', uploading: false, role: 'reference_image',
    })
    render(<Video25Params />)
    // 提示詞說明也印了一份 <code>@Image1</code>，所以鎖定素材縮圖上的標籤徽章。
    expect(screen.getByTestId('media-label-badge')).toHaveTextContent('@Image1')
  })

  it('runs the optimize flow and submits the edited prompt with original-prompt provenance', async () => {
    useVideo25Store.setState({ prompt: 'p', promptOptimize: true })
    useAuthStore.setState({ textEndpoint: 'ep-text' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    fireEvent.click(screen.getByRole('button', { name: /生成影片/ }))

    const ta = (await screen.findByLabelText('優化後提示詞')) as HTMLTextAreaElement
    expect(ta.value).toBe('OPT')
    fireEvent.change(ta, { target: { value: 'OPT edited' } })
    fireEvent.click(screen.getByRole('button', { name: '確認生成' }))

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
    fireEvent.click(screen.getByRole('button', { name: /生成影片/ }))
    await screen.findByRole('dialog')
    expect(signal?.aborted).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // 晚到的 AbortError 不得被當成優化失敗把 Modal 重新打開
    await act(async () => { reject(new DOMException('canceled', 'AbortError')) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // ── 優化流程 × 參數修正的組合（本元件才存在的接線；純函式層已各自單測） ──

  /** 開優化 + 有文字接入點 + 指定參數的共用前置。 */
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
    fireEvent.click(screen.getByRole('button', { name: /生成影片/ }))

  it('edit 任務：請求鎖 duration=-1 + ratio=adaptive，跳修正 toast，並回寫 store', async () => {
    setupOptimizeFlow({ duration: 10, ratio: '16:9' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'edit', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText('優化後提示詞')
    fireEvent.click(screen.getByRole('button', { name: '確認生成' }))

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.duration).toBe(-1)
    expect(body.ratio).toBe('adaptive')

    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.stringContaining('長度已自動改為 Auto'),
    )
    // 修正必須回寫面板，否則 toast 說改了、UI 還顯示 10 秒，下次生成又送回 10。
    expect(useVideo25Store.getState().duration).toBe(-1)
    expect(useVideo25Store.getState().ratio).toBe('adaptive')
  })

  it('extend 任務：只鎖 ratio，duration 保持不動（spec §3 的 edit/extend 非對稱）', async () => {
    setupOptimizeFlow({ duration: 10, ratio: '16:9' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'extend', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText('優化後提示詞')
    fireEvent.click(screen.getByRole('button', { name: '確認生成' }))

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.ratio).toBe('adaptive')
    expect(body.duration).toBe(10)
    expect(useVideo25Store.getState().ratio).toBe('adaptive')
    expect(useVideo25Store.getState().duration).toBe(10)
  })

  it('用原文生成：送原文、不留 originalPrompt 出處，但參數修正照樣套用', async () => {
    setupOptimizeFlow({ duration: 10, ratio: '16:9', prompt: '原文' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'edit', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText('優化後提示詞')
    fireEvent.click(screen.getByRole('button', { name: '用原文生成' }))

    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.content[0]).toEqual({ type: 'text', text: '原文' })
    // API 依 content.role + 觸發詞判任務類型，與我們送哪份提示詞無關 —
    // 這條路徑同樣會被判成 edit，少了修正就會拿到 TaskTypeConstraint 失敗。
    expect(body.duration).toBe(-1)
    expect(body.ratio).toBe('adaptive')

    await waitFor(() => expect(useVideo25Store.getState().history).toHaveLength(1))
    // 使用者否決了改寫 → history 不該亮「已優化」徽章。
    expect(useVideo25Store.getState().history[0].originalPrompt).toBeUndefined()
  })

  it('優化失敗 → 重試 → 成功，可繼續送出（錯誤態只在本元件可達）', async () => {
    setupOptimizeFlow()
    vi.mocked(optimizePrompt)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ taskType: 'reference', prompt: 'OPT2' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByText(/優化失敗：boom/)

    fireEvent.click(screen.getByRole('button', { name: '重試' }))
    const ta = (await screen.findByLabelText('優化後提示詞')) as HTMLTextAreaElement
    expect(ta.value).toBe('OPT2')

    fireEvent.click(screen.getByRole('button', { name: '確認生成' }))
    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    expect(vi.mocked(createVideoTask).mock.calls[0][0].content[0])
      .toEqual({ type: 'text', text: 'OPT2' })
  })

  it('快照隔離：Modal 開啟期間改動 store，送出的仍是按下生成當下的值', async () => {
    setupOptimizeFlow({ duration: 5, ratio: '16:9', prompt: 'SNAP' })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText('優化後提示詞')

    // 使用者在 Modal 開著時繼續動面板 —— 這些都不該影響本次送出。
    act(() => { useVideo25Store.setState({ prompt: 'CHANGED', duration: 12 }) })

    fireEvent.click(screen.getByRole('button', { name: '確認生成' }))
    await waitFor(() => expect(vi.mocked(createVideoTask)).toHaveBeenCalled())
    const body = vi.mocked(createVideoTask).mock.calls[0][0]
    expect(body.duration).toBe(5)

    await waitFor(() => expect(useVideo25Store.getState().history).toHaveLength(1))
    expect(useVideo25Store.getState().history[0].originalPrompt).toBe('SNAP')
  })

  it('空的 asset 列不進優化器編號 — 標籤口徑與 submit() 真正送出的素材一致', async () => {
    setupOptimizeFlow()
    // 「+ 新增」建出但沒填 id 的空列：submit() 會略過，優化器也不該替它編號，
    // 否則 LLM 被告知有 @Image1/@Image2，實際卻只送一份素材。
    useVideo25Store.setState({
      assetRefs: [
        { id: '', type: 'image' },
        { id: 'asset-real', type: 'image' },
      ],
    })
    vi.mocked(optimizePrompt).mockResolvedValue({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByLabelText('優化後提示詞')

    const ctx = vi.mocked(optimizePrompt).mock.calls[0][0]
    expect(ctx.assets.map((a) => a.label)).toEqual(['@Image1'])
  })

  it('mode 也在快照內：失敗後切模式再重試，優化 context 仍是按下生成當下的 mode', async () => {
    setupOptimizeFlow() // multimodal
    vi.mocked(optimizePrompt)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ taskType: 'reference', prompt: 'OPT' })

    render(<Video25Params />)
    clickGenerate()
    await screen.findByText(/優化失敗：boom/)

    // 使用者在錯誤態下切了模式；重試用的素材快照仍是多模態那份，
    // mode 若改讀 live store 就會組出「首幀模式 + 多模態素材」的假 context。
    act(() => { useVideo25Store.setState({ mode: 'first_frame' }) })

    fireEvent.click(screen.getByRole('button', { name: '重試' }))
    await screen.findByLabelText('優化後提示詞')

    expect(vi.mocked(optimizePrompt).mock.calls[1][0].mode).toBe('multimodal')
  })

  it('優化開關 OFF：直送，不開 Modal、不呼叫 LLM', async () => {
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
