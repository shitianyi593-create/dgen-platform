/**
 * useVideoGeneration hook 測試
 *
 * Create-only contract: generate() resolves immediately after createVideoTask
 * registers the task; polling is owned by useBackgroundPoller.
 *
 * 涵蓋需求：
 * - 任務建立後加入 activeTaskIds + history（status=queued）
 * - History 帶有 executionExpiresAfter
 * - request body 帶有 execution_expires_after
 * - base64 轉換後作為 content 送出
 * - asset:// URI 根據 type 生成正確的 content item 格式
 * - 缺少 apiKey / endpoint / prompt 時顯示錯誤提示
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVideoStore } from '../stores/videoStore'
import { useAuthStore } from '../stores/authStore'
import { useVideoGeneration } from '../hooks/useVideoGeneration'

// Mock API calls
vi.mock('../api/video', () => ({
  createVideoTask: vi.fn(),
  pollTaskUntilDone: vi.fn(),
}))

vi.mock('../api/fileUtils', () => ({
  fileToBase64DataUri: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

import { createVideoTask, pollTaskUntilDone } from '../api/video'
import { fileToBase64DataUri } from '../api/fileUtils'
import toast from 'react-hot-toast'

const mockedCreate = createVideoTask as Mock
// Kept as a non-asserted import so the "polling not called" test can verify it.
const mockedPoll = pollTaskUntilDone as Mock
const mockedBase64 = fileToBase64DataUri as Mock

function resetStores() {
  useVideoStore.setState(useVideoStore.getInitialState())
  useAuthStore.setState({ apiKey: 'test-key', endpoint: 'ep-test' })
}

describe('useVideoGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStores()
  })

  describe('validation', () => {
    it('should show error when apiKey is empty', async () => {
      useAuthStore.setState({ apiKey: '', endpoint: 'ep-test' })
      useVideoStore.getState().setPrompt('hello')

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(toast.error).toHaveBeenCalledWith('請先輸入 API 金鑰')
      expect(mockedCreate).not.toHaveBeenCalled()
    })

    it('should show error when endpoint is empty', async () => {
      useAuthStore.setState({ apiKey: 'key', endpoint: '' })
      useVideoStore.getState().setPrompt('hello')

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(toast.error).toHaveBeenCalledWith('請先輸入影片生成接入點 (Endpoint)')
    })

    it('should show error when prompt is empty', async () => {
      useVideoStore.getState().setPrompt('   ')

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(toast.error).toHaveBeenCalledWith('請輸入提示詞')
    })
  })

  describe('create-only flow', () => {
    it('creates task, writes history with executionExpiresAfter, pushes to activeTaskIds', async () => {
      mockedCreate.mockResolvedValue({ id: 'cgt-new' })

      // Set executionExpiresAfter via store before calling generate
      useVideoStore.setState({
        ...useVideoStore.getInitialState(),
        prompt: 'a fox',
        executionExpiresAfter: 7200,
      })
      useAuthStore.setState({
        ...useAuthStore.getState(),
        apiKey: 'ark-fake-uuid',
        endpoint: 'ep-20260101000000-abcde',
      })

      const { result } = renderHook(() => useVideoGeneration())
      await act(async () => {
        await result.current.generate()
      })

      const state = useVideoStore.getState()
      expect(state.activeTaskIds).toContain('cgt-new')
      const item = state.history.find((h) => h.taskId === 'cgt-new')
      expect(item).toBeDefined()
      expect(item?.executionExpiresAfter).toBe(7200)
      expect(item?.status).toBe('queued')

      // pollTaskUntilDone is NOT called — polling is delegated to useBackgroundPoller
      expect(mockedPoll).not.toHaveBeenCalled()
    })

    it('sends execution_expires_after in the request body', async () => {
      mockedCreate.mockResolvedValue({ id: 'cgt-2' })
      useVideoStore.setState({
        ...useVideoStore.getInitialState(),
        prompt: 'p',
        executionExpiresAfter: 14400,
      })
      useAuthStore.setState({
        ...useAuthStore.getState(),
        apiKey: 'ark-fake-uuid',
        endpoint: 'ep-20260101000000-abcde',
      })

      const { result } = renderHook(() => useVideoGeneration())
      await act(async () => {
        await result.current.generate()
      })

      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ execution_expires_after: 14400 }),
      )
    })

    it('should store requestContent in history for export', async () => {
      useVideoStore.getState().setPrompt('test prompt')
      useVideoStore.getState().setRatio('9:16')
      useVideoStore.getState().setDuration(8)
      mockedCreate.mockResolvedValue({ id: 'cgt-200' })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const histItem = useVideoStore.getState().history.find(h => h.taskId === 'cgt-200')
      expect(histItem!.requestContent).toBeDefined()
      expect(histItem!.requestContent!.model).toBe('ep-test')
      expect(histItem!.requestContent!.ratio).toBe('9:16')
      expect(histItem!.requestContent!.duration).toBe(8)
    })
  })

  describe('asset references', () => {
    it('should send image asset as image_url content item', async () => {
      useVideoStore.getState().setPrompt('test')
      useVideoStore.getState().addAssetRef({ id: 'asset-img-001', type: 'image' })
      mockedCreate.mockResolvedValue({ id: 'cgt-asset' })
      mockedPoll.mockResolvedValue({ id: 'cgt-asset', status: 'succeeded', content: { video_url: 'url' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const assetItem = callArgs.content.find(
        (c: { type: string }) => c.type === 'image_url'
      )
      expect(assetItem).toBeDefined()
      expect(assetItem.image_url.url).toBe('asset://asset-img-001')
      expect(assetItem.role).toBe('reference_image')
    })

    it('should send video asset as video_url content item', async () => {
      useVideoStore.getState().setPrompt('test')
      useVideoStore.getState().addAssetRef({ id: 'asset-vid-001', type: 'video' })
      mockedCreate.mockResolvedValue({ id: 'cgt-av' })
      mockedPoll.mockResolvedValue({ id: 'cgt-av', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const assetItem = callArgs.content.find(
        (c: { type: string }) => c.type === 'video_url'
      )
      expect(assetItem).toBeDefined()
      expect(assetItem.video_url.url).toBe('asset://asset-vid-001')
      expect(assetItem.role).toBe('reference_video')
    })

    it('should send audio asset as audio_url content item', async () => {
      useVideoStore.getState().setPrompt('test')
      useVideoStore.getState().addAssetRef({ id: 'asset-aud-001', type: 'audio' })
      mockedCreate.mockResolvedValue({ id: 'cgt-aa' })
      mockedPoll.mockResolvedValue({ id: 'cgt-aa', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const assetItem = callArgs.content.find(
        (c: { type: string }) => c.type === 'audio_url'
      )
      expect(assetItem).toBeDefined()
      expect(assetItem.audio_url.url).toBe('asset://asset-aud-001')
      expect(assetItem.role).toBe('reference_audio')
    })

    it('should not add asset:// prefix if already present', async () => {
      useVideoStore.getState().setPrompt('test')
      useVideoStore.getState().addAssetRef({ id: 'asset://asset-pre', type: 'image' })
      mockedCreate.mockResolvedValue({ id: 'cgt-p' })
      mockedPoll.mockResolvedValue({ id: 'cgt-p', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const assetItem = callArgs.content.find(
        (c: { type: string; image_url?: { url: string } }) =>
          c.type === 'image_url' && c.image_url?.url.startsWith('asset://')
      )
      expect(assetItem.image_url.url).toBe('asset://asset-pre')
    })

    it('passes an https URL through verbatim (no asset:// wrapping) — for chaining', async () => {
      useVideoStore.getState().setPrompt('chain')
      useVideoStore.getState().addAssetRef({
        id: 'https://tos.example/last-frame.png?X-Tos-Expires=10800',
        type: 'image',
      })
      mockedCreate.mockResolvedValue({ id: 'cgt-chain' })
      mockedPoll.mockResolvedValue({ id: 'cgt-chain', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const item = callArgs.content.find((c: { type: string }) => c.type === 'image_url')
      expect(item.image_url.url).toBe(
        'https://tos.example/last-frame.png?X-Tos-Expires=10800',
      )
      // must NOT have been wrapped
      expect(item.image_url.url.startsWith('asset://')).toBe(false)
    })

    it('passes an http (non-TLS) URL through verbatim too', async () => {
      useVideoStore.getState().setPrompt('chain')
      useVideoStore.getState().addAssetRef({ id: 'http://example.test/v.mp4', type: 'video' })
      mockedCreate.mockResolvedValue({ id: 'cgt-http' })
      mockedPoll.mockResolvedValue({ id: 'cgt-http', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const item = callArgs.content.find((c: { type: string }) => c.type === 'video_url')
      expect(item.video_url.url).toBe('http://example.test/v.mp4')
    })
  })

  describe('base64 media upload', () => {
    it('should convert reference image to base64 and include in content', async () => {
      const fakeFile = new File(['data'], 'test.png', { type: 'image/png' })
      useVideoStore.getState().setPrompt('with image')
      useVideoStore.getState().addReferenceImage({
        file: fakeFile,
        preview: 'blob:preview',
        uploading: false,
      })
      mockedBase64.mockResolvedValue('data:image/png;base64,abc123')
      mockedCreate.mockResolvedValue({ id: 'cgt-img' })
      mockedPoll.mockResolvedValue({ id: 'cgt-img', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(mockedBase64).toHaveBeenCalledWith(fakeFile)
      const callArgs = mockedCreate.mock.calls[0][0]
      const imgItem = callArgs.content.find(
        (c: { type: string }) => c.type === 'image_url'
      )
      expect(imgItem.image_url.url).toBe('data:image/png;base64,abc123')
    })
  })

  describe('reference video / audio uploaded URL', () => {
    it('uses media.uploadedUrl directly for video and never calls base64 helper', async () => {
      const file = new File(['v'], 'ref.mp4', { type: 'video/mp4' })
      useVideoStore.getState().setPrompt('with vid')
      useVideoStore.getState().addReferenceVideo({
        file,
        preview: 'blob:v',
        uploading: false,
        uploadedUrl: 'https://tos.example/x.mp4?X-Tos-Expires=10800',
        tosKey: 'seedance-2-0/2026/04/uuid-ref.mp4',
      })
      mockedCreate.mockResolvedValue({ id: 'cgt-v' })
      mockedPoll.mockResolvedValue({ id: 'cgt-v', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(mockedBase64).not.toHaveBeenCalled()
      const callArgs = mockedCreate.mock.calls[0][0]
      const item = callArgs.content.find((c: { type: string }) => c.type === 'video_url')
      expect(item.video_url.url).toBe('https://tos.example/x.mp4?X-Tos-Expires=10800')
      expect(item.role).toBe('reference_video')
    })

    it('uses media.uploadedUrl directly for audio and never calls base64 helper', async () => {
      const file = new File(['a'], 'ref.mp3', { type: 'audio/mpeg' })
      useVideoStore.getState().setPrompt('with aud')
      useVideoStore.getState().addReferenceAudio({
        file,
        preview: 'blob:a',
        uploading: false,
        uploadedUrl: 'https://tos.example/y.mp3?X-Tos-Expires=10800',
        tosKey: 'seedance-2-0/2026/04/uuid-ref.mp3',
      })
      mockedCreate.mockResolvedValue({ id: 'cgt-a' })
      mockedPoll.mockResolvedValue({ id: 'cgt-a', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(mockedBase64).not.toHaveBeenCalled()
      const callArgs = mockedCreate.mock.calls[0][0]
      const item = callArgs.content.find((c: { type: string }) => c.type === 'audio_url')
      expect(item.audio_url.url).toBe('https://tos.example/y.mp3?X-Tos-Expires=10800')
      expect(item.role).toBe('reference_audio')
    })

    it('blocks when reference video is still uploading', async () => {
      useVideoStore.getState().setPrompt('p')
      useVideoStore.getState().addReferenceVideo({
        file: new File(['v'], 'r.mp4', { type: 'video/mp4' }),
        preview: 'blob:v',
        uploading: true,
      })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/上傳中/))
      expect(mockedCreate).not.toHaveBeenCalled()
    })

    it('blocks when reference audio is still uploading', async () => {
      useVideoStore.getState().setPrompt('p')
      useVideoStore.getState().addReferenceAudio({
        file: new File(['a'], 'r.mp3', { type: 'audio/mpeg' }),
        preview: 'blob:a',
        uploading: true,
      })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/上傳中/))
      expect(mockedCreate).not.toHaveBeenCalled()
    })

    it('blocks when reference video has no uploadedUrl (upload failed)', async () => {
      useVideoStore.getState().setPrompt('p')
      useVideoStore.getState().addReferenceVideo({
        file: new File(['v'], 'r.mp4', { type: 'video/mp4' }),
        preview: 'blob:v',
        uploading: false,
        error: 'TOS upload failed: HTTP 403',
      })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/影片尚未取得 URL/))
      expect(mockedCreate).not.toHaveBeenCalled()
    })

    it('blocks when reference audio has no uploadedUrl (upload failed)', async () => {
      useVideoStore.getState().setPrompt('p')
      useVideoStore.getState().addReferenceAudio({
        file: new File(['a'], 'r.mp3', { type: 'audio/mpeg' }),
        preview: 'blob:a',
        uploading: false,
        error: 'TOS upload failed: HTTP 403',
      })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/音訊尚未取得 URL/))
      expect(mockedCreate).not.toHaveBeenCalled()
    })

    it('emits 3 video_url items when 3 reference videos all have uploadedUrl', async () => {
      useVideoStore.getState().setPrompt('three vids')
      for (let i = 1; i <= 3; i++) {
        useVideoStore.getState().addReferenceVideo({
          file: new File(['v'], `v${i}.mp4`, { type: 'video/mp4' }),
          preview: `blob:v${i}`,
          uploading: false,
          uploadedUrl: `https://tos.example/v${i}.mp4?sig`,
          tosKey: `seedance-2-0/v${i}.mp4`,
        })
      }
      mockedCreate.mockResolvedValue({ id: 'cgt-3v' })
      mockedPoll.mockResolvedValue({ id: 'cgt-3v', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const videoItems = callArgs.content.filter((c: { type: string }) => c.type === 'video_url')
      expect(videoItems).toHaveLength(3)
      expect(videoItems.map((v: { video_url: { url: string } }) => v.video_url.url)).toEqual([
        'https://tos.example/v1.mp4?sig',
        'https://tos.example/v2.mp4?sig',
        'https://tos.example/v3.mp4?sig',
      ])
    })

    it('passes duration=-1 (Auto) through to the request body', async () => {
      useVideoStore.getState().setPrompt('p')
      useVideoStore.getState().setDuration(-1)
      mockedCreate.mockResolvedValue({ id: 'cgt-auto' })
      mockedPoll.mockResolvedValue({ id: 'cgt-auto', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      expect(callArgs.duration).toBe(-1)
    })

    it('passes a custom valid integer duration (e.g. 12) through unchanged', async () => {
      useVideoStore.getState().setPrompt('p')
      useVideoStore.getState().setDuration(12)
      mockedCreate.mockResolvedValue({ id: 'cgt-12' })
      mockedPoll.mockResolvedValue({ id: 'cgt-12', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(mockedCreate.mock.calls[0][0].duration).toBe(12)
    })

    it('sends resolution=720p by default in the request body', async () => {
      useVideoStore.getState().setPrompt('p')
      mockedCreate.mockResolvedValue({ id: 'cgt-r' })
      mockedPoll.mockResolvedValue({ id: 'cgt-r', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(mockedCreate.mock.calls[0][0].resolution).toBe('720p')
    })

    it.each(['480p', '720p', '1080p'] as const)(
      'sends resolution=%s when user picks it',
      async (res) => {
        useVideoStore.getState().setPrompt('p')
        useVideoStore.getState().setResolution(res)
        mockedCreate.mockResolvedValue({ id: `cgt-${res}` })
        mockedPoll.mockResolvedValue({ id: `cgt-${res}`, status: 'succeeded', content: { video_url: 'u' } })

        const { result } = renderHook(() => useVideoGeneration())
        await act(() => result.current.generate())

        expect(mockedCreate.mock.calls[0][0].resolution).toBe(res)
      },
    )

    it('sends return_last_frame=true by default', async () => {
      useVideoStore.getState().setPrompt('p')
      mockedCreate.mockResolvedValue({ id: 'cgt-rlf-default' })
      mockedPoll.mockResolvedValue({ id: 'cgt-rlf-default', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(mockedCreate.mock.calls[0][0].return_last_frame).toBe(true)
    })

    it('sends return_last_frame=false when toggled off', async () => {
      useVideoStore.getState().setPrompt('p')
      useVideoStore.getState().setReturnLastFrame(false)
      mockedCreate.mockResolvedValue({ id: 'cgt-rlf-off' })
      mockedPoll.mockResolvedValue({ id: 'cgt-rlf-off', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      expect(mockedCreate.mock.calls[0][0].return_last_frame).toBe(false)
    })

    it('emits 3 audio_url items when 3 reference audios all have uploadedUrl', async () => {
      useVideoStore.getState().setPrompt('three auds')
      for (let i = 1; i <= 3; i++) {
        useVideoStore.getState().addReferenceAudio({
          file: new File(['a'], `a${i}.mp3`, { type: 'audio/mpeg' }),
          preview: `blob:a${i}`,
          uploading: false,
          uploadedUrl: `https://tos.example/a${i}.mp3?sig`,
          tosKey: `seedance-2-0/a${i}.mp3`,
        })
      }
      mockedCreate.mockResolvedValue({ id: 'cgt-3a' })
      mockedPoll.mockResolvedValue({ id: 'cgt-3a', status: 'succeeded', content: { video_url: 'u' } })

      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())

      const callArgs = mockedCreate.mock.calls[0][0]
      const audioItems = callArgs.content.filter((c: { type: string }) => c.type === 'audio_url')
      expect(audioItems).toHaveLength(3)
      expect(audioItems.map((a: { audio_url: { url: string } }) => a.audio_url.url)).toEqual([
        'https://tos.example/a1.mp3?sig',
        'https://tos.example/a2.mp3?sig',
        'https://tos.example/a3.mp3?sig',
      ])
    })
  })

  describe('seed', () => {
    beforeEach(() => {
      mockedCreate.mockResolvedValue({ id: 'cgt-seed' })
      mockedPoll.mockResolvedValue({
        id: 'cgt-seed',
        status: 'succeeded',
        content: { video_url: 'https://cdn.example.com/v.mp4' },
        seed: 0,
        resolution: '1280x720',
        framespersecond: 24,
        updated_at: 1,
        created_at: 1,
      })
    })

    it('includes seed: -1 in the request body when default', async () => {
      useVideoStore.getState().setPrompt('hello')
      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())
      expect(mockedCreate).toHaveBeenCalled()
      const body = mockedCreate.mock.calls[0][0]
      expect(body.seed).toBe(-1)
    })

    it('passes user-set seed through to the API', async () => {
      useVideoStore.getState().setPrompt('hello')
      useVideoStore.getState().setSeed(2024)
      const { result } = renderHook(() => useVideoGeneration())
      await act(() => result.current.generate())
      const body = mockedCreate.mock.calls[0][0]
      expect(body.seed).toBe(2024)
    })
  })

  describe('failed submit preserved in history', () => {
    it('writes a failed history entry with synthetic taskId, error message, and requestContent when createVideoTask throws', async () => {
      mockedCreate.mockRejectedValueOnce(new Error('500 Internal Server Error'))

      useVideoStore.setState({
        ...useVideoStore.getInitialState(),
        prompt: 'a cat in a hat',
        ratio: '16:9',
        duration: 5,
      })
      useAuthStore.setState({ apiKey: 'ark-test', endpoint: 'ep-test' })

      const { result } = renderHook(() => useVideoGeneration())
      await act(async () => { await result.current.generate() })

      const history = useVideoStore.getState().history
      expect(history).toHaveLength(1)
      const entry = history[0]
      expect(entry.taskId).toMatch(/^local-failed-\d+-[a-z0-9]+$/)
      expect(entry.status).toBe('failed')
      expect(entry.prompt).toBe('a cat in a hat')
      expect(entry.error).toBe('500 Internal Server Error')
      expect(entry.requestContent).toBeDefined()
      expect(entry.requestContent?.ratio).toBe('16:9')
      expect(entry.requestContent?.duration).toBe(5)

      expect(toast.error).toHaveBeenCalledWith('錯誤: 500 Internal Server Error')
    })

    it('uses "Unknown error" when a non-Error value is thrown', async () => {
      mockedCreate.mockRejectedValueOnce('plain string rejection')

      useVideoStore.setState({
        ...useVideoStore.getInitialState(),
        prompt: 'p',
      })
      useAuthStore.setState({ apiKey: 'ark-test', endpoint: 'ep-test' })

      const { result } = renderHook(() => useVideoGeneration())
      await act(async () => { await result.current.generate() })

      const history = useVideoStore.getState().history
      expect(history).toHaveLength(1)
      expect(history[0].error).toBe('Unknown error')
    })
  })

  describe('useVideoGeneration — mode-driven role submission', () => {
    beforeEach(() => {
      useAuthStore.setState({ apiKey: 'k', endpoint: 'ep' })
      useVideoStore.getState().resetForNewTask()
      useVideoStore.setState({ mode: 'multimodal' })
      mockedCreate.mockResolvedValue({ id: 'cgt-mode' })
      mockedBase64.mockResolvedValue('data:image/png;base64,xyz')
    })

    it('submits role=first_frame when in first_frame mode', async () => {
      useVideoStore.setState({ mode: 'first_frame', prompt: 'p' })
      useVideoStore.getState().addReferenceImage({
        file: new File([''], 'a.png', { type: 'image/png' }),
        preview: 'blob:a',
        uploading: false,
      })
      const { result } = renderHook(() => useVideoGeneration())
      await act(async () => { await result.current.generate() })

      const body = (createVideoTask as Mock).mock.calls[0][0]
      const image = body.content.find((c: { type: string }) => c.type === 'image_url')
      expect(image.role).toBe('first_frame')
    })

    it('submits first_frame + last_frame in first_last_frame mode', async () => {
      useVideoStore.setState({ mode: 'first_last_frame', prompt: 'p' })
      useVideoStore.getState().addReferenceImage({
        file: new File([''], 'a.png', { type: 'image/png' }),
        preview: 'blob:a', uploading: false,
      })
      useVideoStore.getState().addReferenceImage({
        file: new File([''], 'b.png', { type: 'image/png' }),
        preview: 'blob:b', uploading: false,
      })
      const { result } = renderHook(() => useVideoGeneration())
      await act(async () => { await result.current.generate() })

      const body = (createVideoTask as Mock).mock.calls[0][0]
      const imgs = body.content.filter((c: { type: string }) => c.type === 'image_url')
      expect(imgs.map((i: { role: string }) => i.role)).toEqual(['first_frame', 'last_frame'])
    })

    it('blocks submission when canGenerate is false (mode mismatch)', async () => {
      useVideoStore.setState({ mode: 'first_frame', prompt: 'p' })
      useVideoStore.getState().addReferenceImage({
        file: new File([''], 'a.png', { type: 'image/png' }),
        preview: 'blob:a', uploading: false, role: 'reference_image',  // incompatible role
      })
      const { result } = renderHook(() => useVideoGeneration())
      await act(async () => { await result.current.generate() })

      expect(createVideoTask).not.toHaveBeenCalled()
    })
  })
})
