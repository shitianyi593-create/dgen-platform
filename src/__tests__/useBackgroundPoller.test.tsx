import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBackgroundPoller } from '../hooks/useBackgroundPoller'
import { useVideoStore } from '../stores/videoStore'
import { useAuthStore } from '../stores/authStore'

vi.mock('../api/video', () => ({
  getVideoTask: vi.fn(),
  nextPollInterval: () => 10, // fast in tests
}))

import { getVideoTask } from '../api/video'
const mockedGet = getVideoTask as unknown as ReturnType<typeof vi.fn>

describe('useBackgroundPoller', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      activeTaskIds: [],
      history: [],
    })
    useAuthStore.setState({
      ...useAuthStore.getState(),
      apiKey: 'ark-fake',
    })
    mockedGet.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('polls each activeTaskId until terminal and removes from active', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'cgt-1', model: 'm', status: 'running', created_at: 0,
    }).mockResolvedValueOnce({
      id: 'cgt-1', model: 'm', status: 'succeeded',
      content: { video_url: 'https://x/a.mp4' }, created_at: 0,
    })

    useVideoStore.setState({
      activeTaskIds: ['cgt-1'],
      history: [{ taskId: 'cgt-1', status: 'queued', prompt: 'p', createdAt: 0 }],
    })

    renderHook(() => useBackgroundPoller())

    await waitFor(() => {
      expect(useVideoStore.getState().activeTaskIds).toEqual([])
    }, { timeout: 1000 })

    const item = useVideoStore.getState().history[0]
    expect(item.status).toBe('succeeded')
    expect(item.videoUrl).toBe('https://x/a.mp4')
  })

  it('does not start a second polling loop for the same id (dedupe)', async () => {
    mockedGet.mockImplementation(async () => ({
      id: 'cgt-2', model: 'm', status: 'running', created_at: 0,
    }))

    useVideoStore.setState({
      activeTaskIds: ['cgt-2'],
      history: [{ taskId: 'cgt-2', status: 'queued', prompt: 'p', createdAt: 0 }],
    })

    const { rerender } = renderHook(() => useBackgroundPoller())
    rerender()
    rerender()

    // Allow one polling tick
    await new Promise((r) => setTimeout(r, 50))
    const callCount = mockedGet.mock.calls.length
    expect(callCount).toBeGreaterThanOrEqual(3) // proves it actually polled
    expect(callCount).toBeLessThanOrEqual(8)    // single loop ceiling at 10ms × ~50ms
  })

  it('marks task orphaned and stops polling on 401', async () => {
    const err: Error & { status?: number } = new Error('Authentication Failed')
    err.status = 401
    mockedGet.mockRejectedValueOnce(err)

    useVideoStore.setState({
      activeTaskIds: ['cgt-3'],
      history: [{ taskId: 'cgt-3', status: 'queued', prompt: 'p', createdAt: 0 }],
    })

    renderHook(() => useBackgroundPoller())

    await waitFor(() => {
      expect(useVideoStore.getState().history[0].orphaned).toBe(true)
    }, { timeout: 1000 })
    expect(useVideoStore.getState().activeTaskIds).toEqual([])
  })

  it('does not mark task orphaned when error has no .status (transient)', async () => {
    // First call: transient error (no .status). Second call: succeed terminal.
    mockedGet
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({
        id: 'cgt-transient', model: 'm', status: 'succeeded',
        content: { video_url: 'https://x/a.mp4' },
        created_at: 0, updated_at: 100,
      })

    useVideoStore.setState({
      activeTaskIds: ['cgt-transient'],
      history: [{ taskId: 'cgt-transient', status: 'queued', prompt: 'p', createdAt: 0 }],
    })

    renderHook(() => useBackgroundPoller())

    // Wait long enough for the retry to come around. The transient backoff
    // is 10s in production but the test mock returns immediately on the
    // second call once it fires; we only assert the orphan flag never
    // gets set during this window.
    await new Promise((r) => setTimeout(r, 50))
    expect(useVideoStore.getState().history[0].orphaned).toBeFalsy()
  })

  it('writes updatedAt for failed status (not just succeeded)', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'cgt-fail', model: 'm', status: 'failed',
      error: { message: 'content policy' },
      created_at: 1000, updated_at: 1100,
    })

    useVideoStore.setState({
      activeTaskIds: ['cgt-fail'],
      history: [{ taskId: 'cgt-fail', status: 'running', prompt: 'p', createdAt: 1000 }],
    })

    renderHook(() => useBackgroundPoller())

    await waitFor(() => {
      expect(useVideoStore.getState().history[0].status).toBe('failed')
    }, { timeout: 1000 })
    expect(useVideoStore.getState().history[0].updatedAt).toBe(1100)
    expect(useVideoStore.getState().history[0].error).toBe('content policy')
  })

  it('writes expired status from server to history', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'cgt-4', model: 'm', status: 'expired', created_at: 0,
    })

    useVideoStore.setState({
      activeTaskIds: ['cgt-4'],
      history: [{ taskId: 'cgt-4', status: 'running', prompt: 'p', createdAt: 0 }],
    })

    renderHook(() => useBackgroundPoller())

    await waitFor(() => {
      expect(useVideoStore.getState().history[0].status).toBe('expired')
    }, { timeout: 1000 })
    expect(useVideoStore.getState().activeTaskIds).toEqual([])
  })

  it('pauses polling when apiKey is empty (does not remove from active)', async () => {
    useAuthStore.setState({ ...useAuthStore.getState(), apiKey: '' })
    mockedGet.mockResolvedValue({
      id: 'cgt-5', model: 'm', status: 'running', created_at: 0,
    })

    useVideoStore.setState({
      activeTaskIds: ['cgt-5'],
      history: [{ taskId: 'cgt-5', status: 'queued', prompt: 'p', createdAt: 0 }],
    })

    renderHook(() => useBackgroundPoller())

    await new Promise((r) => setTimeout(r, 100))
    expect(useVideoStore.getState().activeTaskIds).toEqual(['cgt-5'])
    expect(mockedGet).not.toHaveBeenCalled()
  })
})
