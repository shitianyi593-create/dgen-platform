import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import VideoHistory from '../components/video/VideoHistory'
import VideoPreview from '../components/video/VideoPreview'
import { useVideo25Store } from '../stores/video25Store'
import { useVideoStore } from '../stores/videoStore'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function seed25HistoryItem() {
  useVideo25Store.getState().addHistory({
    taskId: 'cgt-25-demo',
    status: 'succeeded',
    prompt: '優化後的提示詞內容',
    originalPrompt: '原始提示詞',
    model: 'dreamina-seedance-2-5-260628',
    createdAt: Date.now() / 1000,
    videoUrl: 'https://example.com/v.mp4',
  })
}

describe('VideoHistory / VideoPreview with injected 2.5 store', () => {
  beforeEach(() => {
    useVideoStore.setState(useVideoStore.getInitialState())
    useVideo25Store.setState(useVideo25Store.getInitialState())
  })

  it('renders items from the injected store and shows the 已優化 badge', () => {
    seed25HistoryItem()
    render(<VideoHistory useStore={useVideo25Store} />)
    expect(screen.getByText('優化後的提示詞內容')).toBeInTheDocument()
    expect(screen.getByTestId('optimized-tag')).toBeInTheDocument()
  })

  it('default store does NOT show items from the 2.5 store', () => {
    seed25HistoryItem()
    render(<VideoHistory />)
    expect(screen.queryByText('優化後的提示詞內容')).not.toBeInTheDocument()
  })

  it('no badge when originalPrompt is absent (2.0 items unaffected)', () => {
    useVideoStore.getState().addHistory({
      taskId: 'cgt-20-demo',
      status: 'succeeded',
      prompt: 'plain',
      createdAt: Date.now() / 1000,
    })
    render(<VideoHistory />)
    expect(screen.queryByTestId('optimized-tag')).not.toBeInTheDocument()
  })

  it('VideoPreview reads the injected store', () => {
    seed25HistoryItem()
    useVideo25Store.getState().setCurrentTask('cgt-25-demo')
    render(<VideoPreview useStore={useVideo25Store} />)
    expect(screen.getByText(/cgt-25-demo/)).toBeInTheDocument()
  })
})
