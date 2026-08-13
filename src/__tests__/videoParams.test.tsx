/**
 * VideoParams component test
 *
 * 涵蓋需求：
 * - DOM 順序：提示詞 → Asset 參考 → 參考圖片 → 參考影片 → 參考音訊
 * - 多模態說明文字存在
 * - 各 MediaUploader 顯示正確的 hint（圖片/影片/音訊）
 * - 「新任務」按鈕：清 prompt + 4 個 reference 陣列；保留 ratio/duration、history、active tasks；revoke blob URLs
 * - Ratio 下拉包含 'adaptive' 選項；預設選中 adaptive
 * - 加入 reference image 後，縮圖出現 [Image 1] badge
 * - Asset 行旁顯示對應 [Type N] label，計數會接續 reference 後
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VideoParams from '../components/video/VideoParams'
import { useVideoStore } from '../stores/videoStore'
import { useAuthStore } from '../stores/authStore'

vi.mock('../api/tos', () => ({
  uploadToTos: vi.fn(),
  signPutUrl: vi.fn(),
  signGetUrl: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function resetState() {
  useVideoStore.setState(useVideoStore.getInitialState())
  useAuthStore.setState({
    apiKey: '',
    endpoint: '',
    tosCreds: {
      accessKeyId: 'test-ak',
      accessKeySecret: 'test-sk',
      region: 'ap-southeast-1',
      bucket: 'test-bucket',
    },
  })
}

beforeEach(() => {
  resetState()
})

afterEach(() => {
  cleanup()
})

describe('VideoParams — layout & hints', () => {
  it('renders sections in the new order: prompt → asset → image → video → audio', () => {
    render(<VideoParams />)
    const html = document.body.innerHTML
    const promptIdx = html.indexOf('提示詞')
    const assetIdx = html.indexOf('Asset 參考')
    const imageIdx = html.indexOf('參考圖片')
    const videoIdx = html.indexOf('參考影片')
    const audioIdx = html.indexOf('參考音訊')

    expect(promptIdx).toBeGreaterThanOrEqual(0)
    expect(promptIdx).toBeLessThan(assetIdx)
    expect(assetIdx).toBeLessThan(imageIdx)
    expect(imageIdx).toBeLessThan(videoIdx)
    expect(videoIdx).toBeLessThan(audioIdx)
  })

  it('does not show the (now removed) multimodal cheatsheet text', () => {
    render(<VideoParams />)
    // Per UX cleanup: each uploader has its own hint, so the redundant
    // top-level cheatsheet was removed.
    expect(screen.queryByText(/多模態參考生成/)).toBeNull()
  })

  it('shows the [Image N] / [Video N] / [Audio N] usage hint under prompt', () => {
    const { container } = render(<VideoParams />)
    // The hint wraps `[Image 1]` inside <code>, so query by class and check
    // the combined textContent.
    const hints = Array.from(container.querySelectorAll('.hint'))
    const usageHint = hints.find(
      (el) =>
        /可用/.test(el.textContent ?? '') &&
        /\[Image 1\]/.test(el.textContent ?? '') &&
        /引用素材/.test(el.textContent ?? ''),
    )
    expect(usageHint).toBeDefined()
  })

  it('image uploader hint mentions 0–9', () => {
    render(<VideoParams />)
    expect(screen.getByText(/0–9 張/)).toBeInTheDocument()
  })

  it('video uploader hint mentions 0–3 and 15 秒', () => {
    render(<VideoParams />)
    expect(screen.getByText(/0–3 段.*15 秒.*mp4/)).toBeInTheDocument()
  })

  it('audio uploader hint mentions 0–3 and 15 秒', () => {
    render(<VideoParams />)
    expect(screen.getByText(/0–3 段.*15 秒.*mp3/)).toBeInTheDocument()
  })
})

describe('VideoParams — Ratio adaptive', () => {
  it('includes an "adaptive" option in the ratio select', () => {
    render(<VideoParams />)
    const adaptiveOption = screen.getByRole('option', { name: /Adaptive/ })
    expect(adaptiveOption).toBeInTheDocument()
  })

  it('defaults the ratio select to adaptive', () => {
    render(<VideoParams />)
    expect(useVideoStore.getState().ratio).toBe('adaptive')
    // The select element's value follows the store
    const adaptiveOption = screen.getByRole('option', {
      name: /Adaptive/,
    }) as HTMLOptionElement
    expect(adaptiveOption.selected).toBe(true)
  })
})

describe('VideoParams — Resolution options', () => {
  it('exposes 480p / 720p / 1080p in the resolution select', () => {
    render(<VideoParams />)
    expect(screen.getByRole('option', { name: '480p' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '720p' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1080p' })).toBeInTheDocument()
  })

  it('defaults the resolution to 720p (Seedance 2.0 spec)', () => {
    render(<VideoParams />)
    expect(useVideoStore.getState().resolution).toBe('720p')
    const sevenTwenty = screen.getByRole('option', {
      name: '720p',
    }) as HTMLOptionElement
    expect(sevenTwenty.selected).toBe(true)
  })

  it.each(['480p', '1080p'] as const)(
    'selecting %s updates the store',
    async (target) => {
      const user = userEvent.setup()
      render(<VideoParams />)
      const select = screen.getByDisplayValue('720p')
      await user.selectOptions(select, target)
      expect(useVideoStore.getState().resolution).toBe(target)
    },
  )

  it('renders 解析度 label above 畫面比例 in the DOM', () => {
    render(<VideoParams />)
    const html = document.body.innerHTML
    const resolutionIdx = html.indexOf('解析度')
    const ratioIdx = html.indexOf('畫面比例')
    expect(resolutionIdx).toBeGreaterThanOrEqual(0)
    expect(ratioIdx).toBeGreaterThanOrEqual(0)
    expect(resolutionIdx).toBeLessThan(ratioIdx)
  })
})

describe('VideoParams — Return last frame toggle', () => {
  it('renders the toggle with default ON state (matches store default)', () => {
    render(<VideoParams />)
    const toggle = screen.getByTestId('toggle-return-last-frame')
    expect(toggle).toBeInTheDocument()
    // default ON → should have the 'active' class
    expect(toggle.className).toMatch(/active/)
    expect(useVideoStore.getState().returnLastFrame).toBe(true)
  })

  it('clicking the toggle flips the store value', async () => {
    const user = userEvent.setup()
    render(<VideoParams />)
    const toggle = screen.getByTestId('toggle-return-last-frame')

    await user.click(toggle)
    expect(useVideoStore.getState().returnLastFrame).toBe(false)

    await user.click(toggle)
    expect(useVideoStore.getState().returnLastFrame).toBe(true)
  })

  it('shows hint text describing the chaining workflow', () => {
    render(<VideoParams />)
    expect(screen.getByText(/前段尾幀.*下段首幀/)).toBeInTheDocument()
  })
})

describe('VideoParams — Duration options', () => {
  it('exposes Auto + every integer second in [4, 15] (13 options)', () => {
    render(<VideoParams />)
    // Auto option
    expect(screen.getByRole('option', { name: /Auto/ })).toBeInTheDocument()
    // Every valid integer
    for (let s = 4; s <= 15; s++) {
      expect(
        screen.getByRole('option', { name: new RegExp(`^${s} 秒$`) }),
      ).toBeInTheDocument()
    }
    // Defensive: discontinued discrete-only set must be gone
    // (e.g. nothing exclusive to "5 / 8 / 11" remains as the only options).
    const allDurationOptions = screen.getAllByRole('option', {
      name: /秒|Auto/,
    })
    // Auto + 4..15 == 13
    expect(allDurationOptions.length).toBe(13)
  })

  it('defaults the duration select to 5 秒', () => {
    render(<VideoParams />)
    expect(useVideoStore.getState().duration).toBe(5)
    const fiveSec = screen.getByRole('option', {
      name: /^5 秒$/,
    }) as HTMLOptionElement
    expect(fiveSec.selected).toBe(true)
  })

  it('selecting Auto sets duration to -1 in the store', async () => {
    const user = userEvent.setup()
    render(<VideoParams />)
    const select = screen.getByDisplayValue(/^5 秒$/)
    await user.selectOptions(select, '-1')
    expect(useVideoStore.getState().duration).toBe(-1)
  })

  it('selecting 12 秒 sets duration to 12', async () => {
    const user = userEvent.setup()
    render(<VideoParams />)
    const select = screen.getByDisplayValue(/^5 秒$/)
    await user.selectOptions(select, '12')
    expect(useVideoStore.getState().duration).toBe(12)
  })
})

describe('VideoParams — 新任務 button', () => {
  it('clears prompt and all reference media; preserves ratio/duration/history/activeTasks', async () => {
    const user = userEvent.setup()
    // Pre-populate store with a bit of everything.
    useVideoStore.getState().setPrompt('to-clear')
    useVideoStore.getState().setRatio('9:16')
    useVideoStore.getState().setDuration(11)
    useVideoStore.getState().addReferenceImage({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      preview: 'blob:img',
      uploading: false,
    })
    useVideoStore.getState().addReferenceVideo({
      file: new File(['x'], 'a.mp4', { type: 'video/mp4' }),
      preview: 'blob:vid',
      uploading: false,
      uploadedUrl: 'https://tos/x.mp4',
    })
    useVideoStore.getState().addAssetRef({ id: 'asset-1', type: 'image' })
    useVideoStore.getState().addHistory({
      taskId: 't-history',
      status: 'succeeded',
      prompt: 'old',
      createdAt: Date.now() / 1000,
    })
    useVideoStore.getState().addActiveTask('t-running')

    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    render(<VideoParams />)
    const newTaskBtn = screen.getByRole('button', { name: /新任務/ })
    await user.click(newTaskBtn)

    const s = useVideoStore.getState()
    // Cleared
    expect(s.prompt).toBe('')
    expect(s.referenceImages).toEqual([])
    expect(s.referenceVideos).toEqual([])
    expect(s.referenceAudios).toEqual([])
    expect(s.assetRefs).toEqual([])
    // Preserved
    expect(s.ratio).toBe('9:16')
    expect(s.duration).toBe(11)
    expect(s.history).toHaveLength(1)
    expect(s.activeTaskIds).toEqual(['t-running'])
    // Blob URLs revoked
    expect(revokeSpy).toHaveBeenCalledWith('blob:img')
    expect(revokeSpy).toHaveBeenCalledWith('blob:vid')

    revokeSpy.mockRestore()
  })
})

describe('VideoParams — content labels', () => {
  it('renders [Image 1] badge on the only reference image', () => {
    useVideoStore.getState().addReferenceImage({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      preview: 'blob:img',
      uploading: false,
    })
    render(<VideoParams />)
    const badges = screen.getAllByTestId('media-label-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('[Image 1]')
  })

  it('numbers asset rows continuing from the reference counts', () => {
    // 2 reference images → asset images start at [Image 3]
    useVideoStore.getState().addReferenceImage({
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      preview: 'blob:img1',
      uploading: false,
    })
    useVideoStore.getState().addReferenceImage({
      file: new File(['x'], 'b.png', { type: 'image/png' }),
      preview: 'blob:img2',
      uploading: false,
    })
    useVideoStore.getState().addAssetRef({ id: 'asset-a', type: 'image' })
    useVideoStore.getState().addAssetRef({ id: 'asset-b', type: 'video' })

    render(<VideoParams />)
    const assetLabels = screen.getAllByTestId('asset-label')
    expect(assetLabels).toHaveLength(2)
    expect(assetLabels[0]).toHaveTextContent('[Image 3]')
    expect(assetLabels[1]).toHaveTextContent('[Video 1]')
  })

  it('shows [Image 1] [Image 2] [Image 3] when 3 images uploaded', () => {
    for (let i = 0; i < 3; i++) {
      useVideoStore.getState().addReferenceImage({
        file: new File(['x'], `${i}.png`, { type: 'image/png' }),
        preview: `blob:${i}`,
        uploading: false,
      })
    }
    render(<VideoParams />)
    const badges = screen.getAllByTestId('media-label-badge')
    expect(badges.map((b) => b.textContent)).toEqual([
      '[Image 1]',
      '[Image 2]',
      '[Image 3]',
    ])
  })
})

/** Seed / 任務最長等待時間 / 浮水印 現在收在「進階設定」折疊區內。 */
function openAdvancedSettings() {
  fireEvent.click(screen.getByRole('button', { name: /進階設定/ }))
}

describe('VideoParams — 進階設定 collapse', () => {
  it('is collapsed by default: seed / exec-expires controls not rendered', () => {
    render(<VideoParams />)
    const header = screen.getByRole('button', { name: /進階設定/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    // 摘要文字
    expect(screen.getByText('Seed · 等待時間 · 浮水印')).toBeInTheDocument()
    // 內容為條件渲染 — 收合時完全不在 DOM
    expect(screen.queryByLabelText('隨機種子 (Seed)')).toBeNull()
    expect(screen.queryByLabelText('任務最長等待時間')).toBeNull()
    expect(screen.queryByLabelText('浮水印')).toBeNull()
  })

  it('clicking the header expands the section and toggles aria-expanded', () => {
    render(<VideoParams />)
    openAdvancedSettings()
    const header = screen.getByRole('button', { name: /進階設定/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('隨機種子 (Seed)')).toBeInTheDocument()
    expect(screen.getByLabelText('任務最長等待時間')).toBeInTheDocument()
    expect(screen.getByLabelText('浮水印')).toBeInTheDocument()
    // 再點一次收回
    openAdvancedSettings()
    expect(screen.queryByLabelText('隨機種子 (Seed)')).toBeNull()
  })

  it('watermark toggle inside the section flips the store', () => {
    render(<VideoParams />)
    openAdvancedSettings()
    const initial = useVideoStore.getState().watermark
    fireEvent.click(screen.getByLabelText('浮水印'))
    expect(useVideoStore.getState().watermark).toBe(!initial)
  })
})

describe('VideoParams — seed input', () => {
  it('renders the seed label and a number input defaulting to -1', () => {
    render(<VideoParams />)
    openAdvancedSettings()
    const input = screen.getByLabelText('隨機種子 (Seed)') as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('-1')
  })

  it('typing a number updates the store', async () => {
    const user = userEvent.setup()
    render(<VideoParams />)
    openAdvancedSettings()
    const input = screen.getByLabelText('隨機種子 (Seed)')
    await user.clear(input)
    await user.type(input, '42')
    expect(useVideoStore.getState().seed).toBe(42)
  })

  it('clicking the 🎲 button generates a random integer in [0, 2^32-1] and updates the visible input', async () => {
    const user = userEvent.setup()
    useVideoStore.getState().setSeed(-1)
    render(<VideoParams />)
    openAdvancedSettings()
    const dice = screen.getByRole('button', { name: '隨機 seed' })
    await user.click(dice)

    const seed = useVideoStore.getState().seed
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(4294967295)

    // Visible input must reflect the new value, not stay at -1
    const input = screen.getByLabelText('隨機種子 (Seed)') as HTMLInputElement
    expect(input.value).toBe(String(seed))
  })

  it('non-numeric input falls back to -1', async () => {
    const user = userEvent.setup()
    render(<VideoParams />)
    openAdvancedSettings()
    const input = screen.getByLabelText('隨機種子 (Seed)')
    await user.clear(input)
    await user.type(input, 'abc')
    expect(useVideoStore.getState().seed).toBe(-1)
  })
})

describe('VideoParams — uploader limits', () => {
  it('image dropzone is hidden once maxItems (9) is reached', () => {
    // Add 9 reference images
    for (let i = 0; i < 9; i++) {
      useVideoStore.getState().addReferenceImage({
        file: new File(['x'], `${i}.png`, { type: 'image/png' }),
        preview: `blob:${i}`,
        uploading: false,
      })
    }
    const { container } = render(<VideoParams />)
    // Find the 參考圖片 section by label, then check its dropzone count
    const sections = container.querySelectorAll('.dropzone')
    // Image is the first one in DOM after asset section. With items.length === maxItems,
    // dropzone is not rendered for images. Count sections still should be 2 (video, audio).
    expect(sections).toHaveLength(2)
  })

  it('video dropzone shows when fewer than 3 items (since limit is now 3)', () => {
    useVideoStore.getState().addReferenceVideo({
      file: new File(['x'], 'a.mp4', { type: 'video/mp4' }),
      preview: 'blob:v',
      uploading: false,
      uploadedUrl: 'https://tos/x.mp4',
    })
    const { container } = render(<VideoParams />)
    // 1 video item present, max=3 → dropzone for video should still render
    const dropzones = container.querySelectorAll('.dropzone')
    // 3 dropzones: image, video, audio
    expect(dropzones).toHaveLength(3)
  })
})

describe('VideoParams — clickable label insert', () => {
  beforeEach(() => {
    useVideoStore.setState({
      prompt: '',
      assetRefs: [{ id: 'asset-x', type: 'image' as const }],
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
  })

  it('clicking an asset-ref label button inserts the label into the prompt', async () => {
    const user = userEvent.setup()
    render(<VideoParams />)
    const labelButton = screen.getByRole('button', { name: /\[Image 1\]/ })
    await user.click(labelButton)
    expect(useVideoStore.getState().prompt).toBe('[Image 1] ')
  })

  it('appends a leading space when prompt has trailing non-whitespace', async () => {
    const user = userEvent.setup()
    useVideoStore.setState({ prompt: 'a cat dancing' })
    render(<VideoParams />)
    const labelButton = screen.getByRole('button', { name: /\[Image 1\]/ })
    await user.click(labelButton)
    expect(useVideoStore.getState().prompt).toBe('a cat dancing [Image 1] ')
  })

  it('inserts at the last-known cursor position even after the textarea loses focus', () => {
    // 真實瀏覽器點擊插入按鈕時，textarea 會先 blur 才觸發 click——
    // 插入位置必須用失焦前記住的游標，而不是 fallback 到結尾。
    useVideoStore.setState({ prompt: 'redcar' })
    render(<VideoParams />)
    const ta = screen.getByPlaceholderText('描述您想要生成的影片內容...') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(3, 3)
    fireEvent.select(ta)
    ta.blur()
    fireEvent.click(screen.getByRole('button', { name: /\[Image 1\]/ }))
    expect(useVideoStore.getState().prompt).toBe('red [Image 1] car')
  })

  it('replaces the selected range remembered before blur', () => {
    useVideoStore.setState({ prompt: 'a OLD b' })
    render(<VideoParams />)
    const ta = screen.getByPlaceholderText('描述您想要生成的影片內容...') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(2, 5)
    fireEvent.select(ta)
    ta.blur()
    fireEvent.click(screen.getByRole('button', { name: /\[Image 1\]/ }))
    expect(useVideoStore.getState().prompt).toBe('a [Image 1]  b')
  })

  it('does NOT add leading space when prompt is empty', async () => {
    const user = userEvent.setup()
    render(<VideoParams />)
    const labelButton = screen.getByRole('button', { name: /\[Image 1\]/ })
    await user.click(labelButton)
    expect(useVideoStore.getState().prompt).toBe('[Image 1] ')
  })

  it('shows no asset-label button when there are no asset refs', () => {
    useVideoStore.setState({ assetRefs: [] })
    render(<VideoParams />)
    expect(screen.queryByRole('button', { name: /\[Image \d+\]/ })).toBeNull()
  })

  it('asset-label button is disabled when asset id is empty', () => {
    useVideoStore.setState({
      assetRefs: [{ id: '', type: 'image' as const }],
    })
    render(<VideoParams />)
    const btn = screen.getByTestId('asset-label') as HTMLButtonElement
    expect(btn).toBeDisabled()
  })

  it('asset-label button is disabled when asset id is junk text (no asset-/asset://-/http(s)://-prefix)', () => {
    useVideoStore.setState({
      assetRefs: [{ id: 'just some random text', type: 'image' as const }],
    })
    render(<VideoParams />)
    const btn = screen.getByTestId('asset-label') as HTMLButtonElement
    expect(btn).toBeDisabled()
  })

  it.each([
    ['asset-id form', 'asset-20260224213258-pnqkh'],
    ['asset:// URI', 'asset://asset-20260224213258-pnqkh'],
    ['https URL', 'https://cdn.example.com/x.mp4'],
    ['http URL', 'http://x/y'],
  ])('asset-label button is enabled for %s', (_label, value) => {
    useVideoStore.setState({
      assetRefs: [{ id: value, type: 'image' as const }],
    })
    render(<VideoParams />)
    const btn = screen.getByTestId('asset-label') as HTMLButtonElement
    expect(btn).not.toBeDisabled()
  })
})

describe('VideoParams — mode tab strip', () => {
  it('renders three mode tabs', () => {
    render(<VideoParams />)
    expect(screen.getByRole('button', { name: /首幀/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /首\+尾/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /多模態/ })).toBeInTheDocument()
  })

  it('clicking a tab updates videoStore.mode', async () => {
    render(<VideoParams />)
    await userEvent.click(screen.getByRole('button', { name: /首\+尾/ }))
    expect(useVideoStore.getState().mode).toBe('first_last_frame')
  })
})

describe('VideoParams — image role badges & dropdown', () => {
  it('renders role badge on thumbs based on media.role', () => {
    useVideoStore.setState({
      mode: 'first_last_frame',
      referenceImages: [
        { preview: 'a', uploading: false, role: 'first_frame' },
        { preview: 'b', uploading: false, role: 'last_frame' },
      ],
    })
    render(<VideoParams />)
    expect(screen.getByText('1ST')).toBeInTheDocument()
    expect(screen.getByText('LAST')).toBeInTheDocument()
  })

  it('shows role dropdown only in first_last_frame mode', () => {
    // Use the role-select-{idx} testid emitted by MediaUploader's per-thumb
    // dropdown — `queryAllByRole('combobox')` would also pick up the
    // resolution/ratio/duration/etc selects on the page, which aren't related.
    useVideoStore.setState({
      mode: 'multimodal',
      referenceImages: [{ preview: 'a', uploading: false, role: 'reference_image' }],
    })
    const { rerender } = render(<VideoParams />)
    expect(
      document.querySelectorAll('[data-testid^="role-select-"]').length,
    ).toBe(0)

    useVideoStore.setState({
      mode: 'first_last_frame',
      referenceImages: [{ preview: 'a', uploading: false, role: 'first_frame' }],
    })
    rerender(<VideoParams />)
    expect(
      document.querySelectorAll('[data-testid^="role-select-"]').length,
    ).toBeGreaterThan(0)
  })
})

describe('VideoParams — incompatibility banner', () => {
  it('shows incompatibility banner when items mismatch mode', () => {
    useVideoStore.setState({
      mode: 'first_frame',
      referenceImages: [
        { preview: 'a', uploading: false, role: 'reference_image' },
        { preview: 'b', uploading: false, role: 'reference_image' },
      ],
    })
    render(<VideoParams />)
    // Banner header reads "{n} 個項目不相容"; the clear button matches /不相容/
    // too, so anchor on the header phrase to be unambiguous.
    expect(screen.getByText(/個項目不相容/)).toBeInTheDocument()
  })

  it('clear incompatible removes all mismatched items', async () => {
    useVideoStore.setState({
      mode: 'first_frame',
      referenceImages: [
        { preview: 'a', uploading: false, role: 'reference_image' },
        { preview: 'b', uploading: false, role: 'first_frame' },
      ],
      referenceVideos: [{ preview: 'v', uploading: false }],
    })
    render(<VideoParams />)
    await userEvent.click(
      screen.getByRole('button', { name: /清掉不相容項目/ }),
    )
    const modal = screen.getByRole('dialog')
    await userEvent.click(within(modal).getByRole('button', { name: /清掉/ }))
    expect(useVideoStore.getState().referenceImages).toEqual([
      { preview: 'b', uploading: false, role: 'first_frame' },
    ])
    expect(useVideoStore.getState().referenceVideos).toEqual([])
  })

  it('cancel keeps incompatible items intact', async () => {
    useVideoStore.setState({
      mode: 'first_frame',
      referenceImages: [
        { preview: 'a', uploading: false, role: 'reference_image' },
        { preview: 'b', uploading: false, role: 'first_frame' },
      ],
      referenceVideos: [{ preview: 'v', uploading: false }],
    })
    render(<VideoParams />)
    await userEvent.click(screen.getByRole('button', { name: /清掉不相容項目/ }))
    const modal = screen.getByRole('dialog')
    await userEvent.click(within(modal).getByRole('button', { name: /取消/ }))
    // State unchanged
    expect(useVideoStore.getState().referenceImages.length).toBe(2)
    expect(useVideoStore.getState().referenceVideos.length).toBe(1)
  })

  it('shows incompat marker on asset ref row when type=video in first_frame mode', () => {
    useVideoStore.setState({
      mode: 'first_frame',
      assetRefs: [{ id: 'asset-vid', type: 'video' }],
    })
    render(<VideoParams />)
    expect(screen.getByTestId('asset-ref-row-0')).toHaveAttribute('data-incompat', 'true')
  })

  it('disables Generate button when canGenerate is false (mode mismatch)', () => {
    useAuthStore.setState({ apiKey: 'k', endpoint: 'ep' })
    useVideoStore.setState({
      mode: 'first_frame',
      prompt: 'p',
      referenceImages: [
        { preview: 'a', uploading: false, role: 'first_frame' },
        { preview: 'b', uploading: false, role: 'first_frame' },
      ],
    })
    render(<VideoParams />)
    expect(screen.getByRole('button', { name: /生成/ })).toBeDisabled()
    // The reason appears both inside the banner and as the inline hint
    // below the Generate button — both call sites use generateBlockReason.
    expect(screen.getAllByText(/圖片數量與模式不符/).length).toBeGreaterThan(0)
  })

  it('shows banner for roleSetOK violation (both images first_frame)', () => {
    useAuthStore.setState({ apiKey: 'k', endpoint: 'ep' })
    useVideoStore.setState({
      mode: 'first_last_frame',
      prompt: 'p',
      referenceImages: [
        { preview: 'a', uploading: false, role: 'first_frame' },
        { preview: 'b', uploading: false, role: 'first_frame' },
      ],
    })
    render(<VideoParams />)
    expect(screen.getByText(/參數與目前模式不符/)).toBeInTheDocument()
    expect(screen.getAllByText(/首尾幀模式需要恰好一張首幀與一張尾幀/).length).toBeGreaterThan(0)
  })

  it('asset-ref image row shows role select in first_last_frame mode', () => {
    useVideoStore.setState({
      mode: 'first_last_frame',
      assetRefs: [{ id: 'asset-img', type: 'image', role: 'first_frame' }],
    })
    render(<VideoParams />)
    const row = screen.getByTestId('asset-ref-row-0')
    expect(row.querySelector('select')).toBeTruthy()
  })
})

describe('execution_expires_after dropdown', () => {
  it('renders with seven preset options and 3600 selected by default', () => {
    render(<VideoParams />)
    openAdvancedSettings()
    const select = screen.getByLabelText('任務最長等待時間') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.options).toHaveLength(7)
    expect(select.value).toBe('3600')
  })

  it('updates the store when changed', () => {
    render(<VideoParams />)
    openAdvancedSettings()
    const select = screen.getByLabelText('任務最長等待時間') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '14400' } })
    expect(useVideoStore.getState().executionExpiresAfter).toBe(14400)
  })
})
