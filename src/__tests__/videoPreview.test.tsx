/**
 * VideoPreview component test
 *
 * 涵盖需求：
 * - 视频元素「不」带 autoplay attribute（用户必须手动按播放键）
 * - 视频元素带 controls 属性（提供标准播放控制）
 * - 无 currentVideoUrl 时显示 placeholder（不渲染 <video>）
 * - 有 objectUrl 时优先用 objectUrl 而非 videoUrl 作为 source
 * - 切换 videoSrc 时 <video> 用 key 强制 remount，避免缓存问题
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VideoPreview from '../components/video/VideoPreview'
import { useVideoStore } from '../stores/videoStore'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  copyWithToast: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  useVideoStore.setState(useVideoStore.getInitialState())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VideoPreview — autoplay disabled', () => {
  it('renders the <video> element WITHOUT an autoplay attribute', () => {
    useVideoStore.getState().setCurrentVideoUrl('https://example.test/v.mp4')
    useVideoStore.getState().setCurrentTask('t1')

    const { container } = render(<VideoPreview />)
    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    // Both the lowercase HTML attribute name and the React property must be off.
    expect(video!.hasAttribute('autoplay')).toBe(false)
    expect((video as HTMLVideoElement).autoplay).toBe(false)
  })

  it('keeps the controls attribute so the user can press play manually', () => {
    useVideoStore.getState().setCurrentVideoUrl('https://example.test/v.mp4')

    const { container } = render(<VideoPreview />)
    const video = container.querySelector('video')
    expect(video!.hasAttribute('controls')).toBe(true)
  })
})

describe('VideoPreview — placeholder', () => {
  it('shows the empty placeholder when there is no current video', () => {
    const { container, getByText } = render(<VideoPreview />)
    expect(container.querySelector('video')).toBeNull()
    expect(getByText('生成的视频将显示在这里。')).toBeInTheDocument()
  })
})

describe('VideoPreview — source selection', () => {
  it('prefers objectUrl over the remote videoUrl', () => {
    useVideoStore.getState().addHistory({
      taskId: 'tlocal',
      status: 'succeeded',
      prompt: 'hi',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://remote.test/r.mp4',
      objectUrl: 'blob:fake-imported-mp4',
    })
    useVideoStore.getState().setCurrentTask('tlocal')
    useVideoStore.getState().setCurrentVideoUrl('https://remote.test/r.mp4')

    const { container } = render(<VideoPreview />)
    const source = container.querySelector('video source')
    expect(source?.getAttribute('src')).toBe('blob:fake-imported-mp4')
  })

  it('falls back to videoUrl when no local copy exists', () => {
    useVideoStore.getState().addHistory({
      taskId: 'tremote',
      status: 'succeeded',
      prompt: 'hi',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://remote.test/r.mp4',
    })
    useVideoStore.getState().setCurrentTask('tremote')
    useVideoStore.getState().setCurrentVideoUrl('https://remote.test/r.mp4')

    const { container } = render(<VideoPreview />)
    const source = container.querySelector('video source')
    expect(source?.getAttribute('src')).toBe('https://remote.test/r.mp4')
  })

  // Pre-existing bug surfaced during the export-bundle branch: when a freshly
  // submitted task transitions queued → succeeded via the background poller,
  // history.videoUrl is patched but currentVideoUrl in the store is whatever
  // it was at submit time (typically null). Without this fallback the preview
  // stays blank until the user clicks the card.
  it('falls back to currentItem.videoUrl when currentVideoUrl is null (auto-display on poll-completion)', () => {
    useVideoStore.getState().addHistory({
      taskId: 'tfresh',
      status: 'succeeded',
      prompt: 'just finished',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://remote.test/just-finished.mp4',
    })
    useVideoStore.getState().setCurrentTask('tfresh')
    // Simulate the gap: user submitted, didn't click anything, poller marked
    // succeeded — currentVideoUrl was never updated.
    useVideoStore.getState().setCurrentVideoUrl(null)

    const { container } = render(<VideoPreview />)
    const source = container.querySelector('video source')
    expect(source?.getAttribute('src')).toBe('https://remote.test/just-finished.mp4')
  })
})

describe('VideoPreview — last frame display', () => {
  it('does NOT render last frame section when lastFrameUrl is missing', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-no-frame',
      status: 'succeeded',
      prompt: 'no frame',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://cdn/v.mp4',
    })
    useVideoStore.getState().setCurrentTask('t-no-frame')
    useVideoStore.getState().setCurrentVideoUrl('https://cdn/v.mp4')

    render(<VideoPreview />)
    expect(screen.queryByTestId('last-frame-section')).toBeNull()
  })

  it('renders the last frame <img> when lastFrameUrl is present', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-with-frame',
      status: 'succeeded',
      prompt: 'with frame',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://cdn/v.mp4',
      lastFrameUrl: 'https://cdn/last.png',
    })
    useVideoStore.getState().setCurrentTask('t-with-frame')
    useVideoStore.getState().setCurrentVideoUrl('https://cdn/v.mp4')

    const { container } = render(<VideoPreview />)
    const section = screen.getByTestId('last-frame-section')
    expect(section).toBeInTheDocument()
    const img = container.querySelector('[data-testid="last-frame-section"] img')
    expect(img?.getAttribute('src')).toBe('https://cdn/last.png')
  })

  it('prefers frameObjectUrl over lastFrameUrl when both exist', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-local-frame',
      status: 'succeeded',
      prompt: 'local frame',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://cdn/v.mp4',
      lastFrameUrl: 'https://cdn/last.png',
      frameObjectUrl: 'blob:fake-imported-frame',
    })
    useVideoStore.getState().setCurrentTask('t-local-frame')
    useVideoStore.getState().setCurrentVideoUrl('https://cdn/v.mp4')

    const { container } = render(<VideoPreview />)
    const img = container.querySelector('[data-testid="last-frame-section"] img')
    expect(img?.getAttribute('src')).toBe('blob:fake-imported-frame')
  })
})

describe('VideoPreview — URL section + copy', () => {
  function selectTaskWithUrls() {
    useVideoStore.getState().addHistory({
      taskId: 't-urls',
      status: 'succeeded',
      prompt: 'with urls',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://cdn/v.mp4',
      lastFrameUrl: 'https://cdn/last.png',
    })
    useVideoStore.getState().setCurrentTask('t-urls')
    useVideoStore.getState().setCurrentVideoUrl('https://cdn/v.mp4')
  }

  it('renders both URL rows with the values shown in input fields', () => {
    selectTaskWithUrls()
    render(<VideoPreview />)
    const videoRow = screen.getByTestId('video-url-row')
    const frameRow = screen.getByTestId('last-frame-url-row')
    const videoInput = videoRow.querySelector('input') as HTMLInputElement
    const frameInput = frameRow.querySelector('input') as HTMLInputElement
    expect(videoInput.value).toBe('https://cdn/v.mp4')
    expect(frameInput.value).toBe('https://cdn/last.png')
  })

  it('复制 button copies the row URL (via shared copyWithToast)', async () => {
    selectTaskWithUrls()
    const { copyWithToast } = await import('../utils/clipboard')
    vi.mocked(copyWithToast).mockClear()

    const user = userEvent.setup()
    render(<VideoPreview />)

    const videoRow = screen.getByTestId('video-url-row')
    await user.click(within(videoRow).getByRole('button', { name: '复制' }))
    expect(copyWithToast).toHaveBeenCalledWith('视频 URL', 'https://cdn/v.mp4')

    const frameRow = screen.getByTestId('last-frame-url-row')
    await user.click(within(frameRow).getByRole('button', { name: '复制' }))
    expect(copyWithToast).toHaveBeenCalledWith('尾帧 URL', 'https://cdn/last.png')
  })

  it('hides the URL section entirely when neither URL is present', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-empty',
      status: 'failed',
      prompt: 'failed',
      createdAt: Date.now() / 1000,
      error: 'oops',
    })
    useVideoStore.getState().setCurrentTask('t-empty')

    render(<VideoPreview />)
    expect(screen.queryByTestId('url-section')).toBeNull()
  })
})
