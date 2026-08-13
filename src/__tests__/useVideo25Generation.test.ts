import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVideo25Store } from '../stores/video25Store'
import { useAuthStore } from '../stores/authStore'
import { useVideo25Generation } from '../hooks/useVideo25Generation'
import { SEEDANCE_25_MODEL_ID } from '../types'

vi.mock('../api/video', () => ({
  createVideoTask: vi.fn(),
}))
vi.mock('../api/fileUtils', () => ({
  fileToBase64DataUri: vi.fn(),
}))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

import { createVideoTask } from '../api/video'
import toast from 'react-hot-toast'
const mockedCreate = createVideoTask as Mock

function resetStores() {
  useVideo25Store.setState(useVideo25Store.getInitialState())
  useAuthStore.setState({ apiKey: 'test-key', endpoint: '', videoEndpoint25: '', textEndpoint: '' })
}

describe('useVideo25Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStores()
  })

  it('falls back to the Model ID when videoEndpoint25 is empty (2.0 endpoint NOT required)', async () => {
    mockedCreate.mockResolvedValue({ id: 'cgt-25-a' })
    useVideo25Store.getState().setPrompt('a fox')

    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => { await result.current.generate() })

    expect(mockedCreate).toHaveBeenCalledTimes(1)
    expect(mockedCreate.mock.calls[0][0].model).toBe(SEEDANCE_25_MODEL_ID)
  })

  it('uses videoEndpoint25 when present', async () => {
    mockedCreate.mockResolvedValue({ id: 'cgt-25-b' })
    useAuthStore.setState({ videoEndpoint25: 'ep-25-configured' })
    useVideo25Store.getState().setPrompt('a fox')

    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => { await result.current.generate() })

    expect(mockedCreate.mock.calls[0][0].model).toBe('ep-25-configured')
  })

  it('coerces ratio to adaptive in first_frame mode even if store has 16:9', async () => {
    mockedCreate.mockResolvedValue({ id: 'cgt-25-c' })
    useVideo25Store.setState({ mode: 'first_frame', ratio: '16:9', prompt: 'p' })
    // first_frame 需要恰好 1 張首幀圖
    useVideo25Store.getState().addReferenceImage({
      file: new File(['x'], 'f.png', { type: 'image/png' }),
      preview: 'blob:f', uploading: false, role: 'first_frame',
    })
    const { fileToBase64DataUri } = await import('../api/fileUtils')
    ;(fileToBase64DataUri as Mock).mockResolvedValue('data:image/png;base64,AAA')

    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => { await result.current.generate() })

    expect(mockedCreate.mock.calls[0][0].ratio).toBe('adaptive')
  })

  it('submit() applies duration/ratio overrides and records originalPrompt + model in history', async () => {
    mockedCreate.mockResolvedValue({ id: 'cgt-25-d' })
    useVideo25Store.setState({ prompt: '原文', duration: 10, ratio: '16:9' })

    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => {
      const prepared = result.current.prepare()
      expect(prepared).not.toBeNull()
      await result.current.submit(prepared!, '優化後', {
        originalPrompt: '原文',
        duration: -1,
        ratio: 'adaptive',
      })
    })

    const body = mockedCreate.mock.calls[0][0]
    expect(body.duration).toBe(-1)
    expect(body.ratio).toBe('adaptive')
    expect(body.content[0]).toEqual({ type: 'text', text: '優化後' })

    const item = useVideo25Store.getState().history.find((h) => h.taskId === 'cgt-25-d')
    expect(item?.prompt).toBe('優化後')
    expect(item?.originalPrompt).toBe('原文')
    expect(item?.model).toBe(SEEDANCE_25_MODEL_ID)
  })

  it('blocks when apiKey missing', async () => {
    useAuthStore.setState({ apiKey: '' })
    useVideo25Store.getState().setPrompt('p')
    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => { await result.current.generate() })
    expect(toast.error).toHaveBeenCalledWith('請先輸入 API 金鑰')
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('allows 10 reference images in multimodal (beyond the 2.0 cap of 9)', async () => {
    mockedCreate.mockResolvedValue({ id: 'cgt-25-e' })
    const { fileToBase64DataUri } = await import('../api/fileUtils')
    ;(fileToBase64DataUri as Mock).mockResolvedValue('data:image/png;base64,AAA')
    useVideo25Store.getState().setPrompt('p')
    for (let i = 0; i < 10; i++) {
      useVideo25Store.getState().addReferenceImage({
        file: new File(['x'], `f${i}.png`, { type: 'image/png' }),
        preview: `blob:${i}`, uploading: false, role: 'reference_image',
      })
    }
    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => { await result.current.generate() })
    expect(mockedCreate).toHaveBeenCalledTimes(1)
    expect(mockedCreate.mock.calls[0][0].content).toHaveLength(11) // text + 10 images
  })

  it('blocks at 31 images — the 2.5 cap is 30, not merely ">9"', async () => {
    useVideo25Store.getState().setPrompt('p')
    for (let i = 0; i < 31; i++) {
      useVideo25Store.getState().addReferenceImage({
        file: new File(['x'], `f${i}.png`, { type: 'image/png' }),
        preview: `blob:${i}`, uploading: false, role: 'reference_image',
      })
    }
    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => { await result.current.generate() })
    expect(toast.error).toHaveBeenCalledWith('圖片數量與模式不符')
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('preserves a failed submit in history with model + originalPrompt', async () => {
    mockedCreate.mockRejectedValue(new Error('API is down'))
    useVideo25Store.setState({ prompt: '原文' })

    const { result } = renderHook(() => useVideo25Generation())
    await act(async () => {
      const prepared = result.current.prepare()
      await result.current.submit(prepared!, '優化後', { originalPrompt: '原文' })
    })

    const item = useVideo25Store.getState().history[0]
    expect(item.status).toBe('failed')
    expect(item.taskId).toMatch(/^local-failed-/)
    expect(item.error).toBe('API is down')
    expect(item.prompt).toBe('優化後')
    expect(item.originalPrompt).toBe('原文')
    expect(item.model).toBe(SEEDANCE_25_MODEL_ID)
    expect(item.requestContent).toBeDefined()
  })
})
