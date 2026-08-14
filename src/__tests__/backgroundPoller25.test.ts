import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBackgroundPoller } from '../hooks/useBackgroundPoller'
import { useVideo25Store } from '../stores/video25Store'
import { useVideoStore } from '../stores/videoStore'
import { useAuthStore } from '../stores/authStore'

vi.mock('../api/video', () => ({
  getVideoTask: vi.fn(),
  nextPollInterval: () => 10,
}))
import { getVideoTask } from '../api/video'
const mockedGet = getVideoTask as Mock

describe('useBackgroundPoller polls the 2.5 store too', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useVideoStore.setState(useVideoStore.getInitialState())
    useVideo25Store.setState(useVideo25Store.getInitialState())
    useAuthStore.setState({ apiKey: 'test-key' })
  })

  it('finalizes a 2.5 task into the 2.5 history and clears activeTaskIds', async () => {
    mockedGet.mockResolvedValue({
      id: 'cgt-25-x',
      model: 'dreamina-seedance-2-5-260628',
      status: 'succeeded',
      content: { video_url: 'https://v/25.mp4' },
      created_at: 1,
      updated_at: 2,
    })
    useVideo25Store.getState().addHistory({
      taskId: 'cgt-25-x', status: 'queued', prompt: 'p', createdAt: 1,
    })
    useVideo25Store.getState().addActiveTask('cgt-25-x')

    renderHook(() => useBackgroundPoller())

    await waitFor(() => {
      const item = useVideo25Store.getState().history.find((h) => h.taskId === 'cgt-25-x')
      expect(item?.status).toBe('succeeded')
      expect(item?.videoUrl).toBe('https://v/25.mp4')
      expect(useVideo25Store.getState().activeTaskIds).not.toContain('cgt-25-x')
    })
    // 2.0 store 不受影响
    expect(useVideoStore.getState().history).toHaveLength(0)
  })
})
