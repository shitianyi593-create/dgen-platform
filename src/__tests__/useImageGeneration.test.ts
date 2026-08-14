import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import toast from 'react-hot-toast'
import {
  useImageGeneration,
  buildImageRequest,
  computeImageBlockReason,
} from '../hooks/useImageGeneration'
import { useImageStore } from '../stores/imageStore'
import { useAuthStore } from '../stores/authStore'
import { generateImages } from '../api/image'
import { fileToBase64DataUri } from '../api/fileUtils'

vi.mock('../api/image', () => ({ generateImages: vi.fn() }))
vi.mock('../api/fileUtils', () => ({ fileToBase64DataUri: vi.fn() }))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const mockGenerate = vi.mocked(generateImages)
const mockToDataUri = vi.mocked(fileToBase64DataUri)

const VALID_KEY = '12345678-1234-1234-1234-123456789012'
const IMG_EP = 'ep-20260202000000-bbbbb'

function primeStores() {
  useAuthStore.setState({ apiKey: VALID_KEY, imageEndpoint: IMG_EP })
  useImageStore.setState(useImageStore.getInitialState(), true)
  useImageStore.getState().setPrompt('a cat')
}

beforeEach(() => {
  vi.clearAllMocks()
  primeStores()
})

describe('buildImageRequest', () => {
  it('text-to-image: no image field; preset size; ratio appended to prompt', () => {
    const req = buildImageRequest({
      endpoint: IMG_EP,
      prompt: 'a cat',
      modelKey: 'seedream-5-0-pro',
      sizeMode: 'preset',
      sizeLevel: '2K',
      aspectRatio: '16:9',
      customWidth: 0,
      customHeight: 0,
      outputFormat: 'png',
      watermark: false,
      sequentialEnabled: false,
      maxImages: 4,
      imageInputs: [],
    })
    expect(req).toEqual({
      model: IMG_EP,
      prompt: 'a cat\n\nAspect ratio: 16:9.',
      size: '2K',
      response_format: 'url',
      output_format: 'png',
      watermark: false,
      stream: false,
    })
    expect(req.image).toBeUndefined()
  })

  it('single ref → image is a string; multiple → array', () => {
    const single = buildImageRequest({
      endpoint: IMG_EP, prompt: 'p', modelKey: 'seedream-5-0-pro',
      sizeMode: 'preset', sizeLevel: '1K', aspectRatio: 'auto',
      customWidth: 0, customHeight: 0, outputFormat: 'jpeg',
      watermark: true, sequentialEnabled: false, maxImages: 4,
      imageInputs: ['data:image/png;base64,AAA'],
    })
    expect(single.image).toBe('data:image/png;base64,AAA')

    const multi = buildImageRequest({
      endpoint: IMG_EP, prompt: 'p', modelKey: 'seedream-5-0-pro',
      sizeMode: 'preset', sizeLevel: '1K', aspectRatio: 'auto',
      customWidth: 0, customHeight: 0, outputFormat: 'jpeg',
      watermark: true, sequentialEnabled: false, maxImages: 4,
      imageInputs: ['https://a/1.png', 'https://a/2.png'],
    })
    expect(multi.image).toEqual(['https://a/1.png', 'https://a/2.png'])
  })

  it('custom size mode sends WxH and does NOT append ratio to prompt', () => {
    const req = buildImageRequest({
      endpoint: IMG_EP, prompt: 'p', modelKey: 'seedream-4-0',
      sizeMode: 'custom', sizeLevel: '2K', aspectRatio: '16:9',
      customWidth: 1280, customHeight: 720, outputFormat: 'jpeg',
      watermark: false, sequentialEnabled: false, maxImages: 4,
      imageInputs: [],
    })
    expect(req.size).toBe('1280x720')
    expect(req.prompt).toBe('p')
  })

  it('sequential on: sends auto + clamped max_images; off: omits both fields', () => {
    const on = buildImageRequest({
      endpoint: IMG_EP, prompt: 'p', modelKey: 'seedream-5-0-lite',
      sizeMode: 'preset', sizeLevel: '2K', aspectRatio: 'auto',
      customWidth: 0, customHeight: 0, outputFormat: 'png',
      watermark: false, sequentialEnabled: true, maxImages: 10,
      imageInputs: ['https://a/1.png', 'https://a/2.png'], // 2 refs → cap 13
    })
    expect(on.sequential_image_generation).toBe('auto')
    expect(on.sequential_image_generation_options).toEqual({ max_images: 10 })

    const capped = buildImageRequest({
      endpoint: IMG_EP, prompt: 'p', modelKey: 'seedream-5-0-lite',
      sizeMode: 'preset', sizeLevel: '2K', aspectRatio: 'auto',
      customWidth: 0, customHeight: 0, outputFormat: 'png',
      watermark: false, sequentialEnabled: true, maxImages: 15,
      imageInputs: Array.from({ length: 12 }, (_, i) => `https://a/${i}.png`),
    })
    expect(capped.sequential_image_generation_options).toEqual({ max_images: 3 })

    const off = buildImageRequest({
      endpoint: IMG_EP, prompt: 'p', modelKey: 'seedream-5-0-lite',
      sizeMode: 'preset', sizeLevel: '2K', aspectRatio: 'auto',
      customWidth: 0, customHeight: 0, outputFormat: 'png',
      watermark: false, sequentialEnabled: false, maxImages: 4,
      imageInputs: [],
    })
    expect(off.sequential_image_generation).toBeUndefined()
    expect(off.sequential_image_generation_options).toBeUndefined()
  })

  it('format-locked models (4-5/4-0) omit output_format', () => {
    const req = buildImageRequest({
      endpoint: IMG_EP, prompt: 'p', modelKey: 'seedream-4-5',
      sizeMode: 'preset', sizeLevel: '2K', aspectRatio: 'auto',
      customWidth: 0, customHeight: 0, outputFormat: 'jpeg',
      watermark: false, sequentialEnabled: false, maxImages: 4,
      imageInputs: [],
    })
    expect(req.output_format).toBeUndefined()
  })
})

describe('computeImageBlockReason', () => {
  it('orders: key → image ep → prompt → stale → bad url → ref cap → custom size', () => {
    useAuthStore.setState({ apiKey: '', imageEndpoint: '' })
    expect(computeImageBlockReason()).toContain('API 密钥')

    useAuthStore.setState({ apiKey: VALID_KEY })
    expect(computeImageBlockReason()).toContain('图片生成接入点')

    useAuthStore.setState({ imageEndpoint: IMG_EP })
    useImageStore.getState().setPrompt('')
    expect(computeImageBlockReason()).toContain('提示词')

    useImageStore.getState().setPrompt('a cat')
    useImageStore.setState({
      refImages: [{ id: 'r1', preview: '', filename: 'x.png', stale: true }],
    })
    expect(computeImageBlockReason()).toContain('重新上传')

    useImageStore.setState({ refImages: [] })
    useImageStore.setState({ refUrls: ['not-a-url'] })
    expect(computeImageBlockReason()).toContain('URL')

    useImageStore.setState({
      refUrls: Array.from({ length: 11 }, (_, i) => `https://a/${i}.png`),
    })
    expect(computeImageBlockReason()).toContain('参考图') // 5-0-pro cap = 10

    useImageStore.setState({ refUrls: [] })
    useImageStore.getState().setSizeMode('custom')
    useImageStore.getState().setCustomWidth(100)
    useImageStore.getState().setCustomHeight(100)
    expect(computeImageBlockReason()).toContain('总像素')

    useImageStore.getState().setCustomWidth(2048)
    useImageStore.getState().setCustomHeight(2048)
    expect(computeImageBlockReason()).toBeNull()
  })
})

describe('useImageGeneration.generate', () => {
  it('happy path: history generating → succeeded with urls + expiresAt + debug fields', async () => {
    mockGenerate.mockResolvedValueOnce({
      response: {
        model: 'dola-seedream-5-0-pro-260628',
        created: 1757323224,
        data: [{ url: 'https://ark.example.bytepluses.com/out.png', size: '2048x2048', output_format: 'png' }],
        usage: { generated_images: 1, output_tokens: 16280, total_tokens: 16280, input_images: 2 },
      },
      requestId: 'req-abc',
    })
    const { result } = renderHook(() => useImageGeneration())
    await act(() => result.current.generate())

    const s = useImageStore.getState()
    expect(s.history).toHaveLength(1)
    const entry = s.history[0]
    expect(entry.status).toBe('succeeded')
    expect(entry.images[0].url).toContain('out.png')
    expect(entry.images[0].outputFormat).toBe('png')
    expect(entry.expiresAt).toBeGreaterThan(Date.now())
    expect(entry.expiresAt! - entry.completedAt!).toBe(24 * 3600 * 1000)
    expect(s.currentEntryId).toBe(entry.id)
    expect(toast.success).toHaveBeenCalled()
    // 调试信息
    expect(entry.debug?.requestId).toBe('req-abc')
    expect(entry.debug?.responseModel).toBe('dola-seedream-5-0-pro-260628')
    expect(entry.debug?.createdApi).toBe(1757323224)
    // 擴充的 usage 栏位
    expect(entry.usage?.outputTokens).toBe(16280)
    expect(entry.usage?.inputImages).toBe(2)
    expect(entry.usage?.total_tokens).toBe(16280)
  })

  it('empty data with error.code sets errorCode on the failed entry', async () => {
    mockGenerate.mockResolvedValueOnce({
      response: { data: [], error: { code: 'InputImageSensitiveContentDetected', message: '内容不合规' } },
    })
    const { result } = renderHook(() => useImageGeneration())
    await act(() => result.current.generate())

    const entry = useImageStore.getState().history[0]
    expect(entry.status).toBe('failed')
    expect(entry.errorCode).toBe('InputImageSensitiveContentDetected')
    expect(entry.error).toContain('内容不合规')
  })

  it('converts uploaded files to base64 data URIs before sending', async () => {
    mockToDataUri.mockResolvedValueOnce('data:image/png;base64,FILE1')
    mockGenerate.mockResolvedValueOnce({ response: { data: [{ url: 'https://x/y.png' }] } })
    useImageStore.getState().addRefImage({
      id: 'r1', preview: 'blob:x', filename: 'a.png',
      file: new File(['x'], 'a.png', { type: 'image/png' }),
    })
    useImageStore.getState().addRefUrl()
    useImageStore.getState().updateRefUrl(0, 'https://a/b.png')

    const { result } = renderHook(() => useImageGeneration())
    await act(() => result.current.generate())

    const sent = mockGenerate.mock.calls[0][0]
    expect(sent.image).toEqual(['data:image/png;base64,FILE1', 'https://a/b.png'])
  })

  it('API failure: history entry failed with error message + toast.error', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('rate limit exceeded'))
    const { result } = renderHook(() => useImageGeneration())
    await act(() => result.current.generate())

    const entry = useImageStore.getState().history[0]
    expect(entry.status).toBe('failed')
    expect(entry.error).toContain('rate limit')
    expect(toast.error).toHaveBeenCalled()
  })

  it('blocked: no request sent, toast.error with the reason', async () => {
    useAuthStore.setState({ imageEndpoint: '' })
    const { result } = renderHook(() => useImageGeneration())
    await act(() => result.current.generate())
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('图片生成接入点'))
  })

  it('concurrent generates create independent history entries', async () => {
    let resolveFirst!: (v: { response: { data: Array<{ url: string }> } }) => void
    mockGenerate
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ response: { data: [{ url: 'https://x/2.png' }] } })

    const { result } = renderHook(() => useImageGeneration())
    let p1!: Promise<void>
    act(() => { p1 = result.current.generate() })
    await act(() => result.current.generate())
    act(() => { resolveFirst({ response: { data: [{ url: 'https://x/1.png' }] } }) })
    await act(() => p1)

    const s = useImageStore.getState()
    expect(s.history).toHaveLength(2)
    expect(s.history.every((h) => h.status === 'succeeded')).toBe(true)
  })
})
