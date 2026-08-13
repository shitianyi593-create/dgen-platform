/**
 * VideoHistory component test
 *
 * 涵蓋需求：
 * - 匯入項目超過 2 小時仍會顯示在面板（imported flag 跳過時間過濾）
 * - 一般項目超過 2 小時被過濾
 * - 「📥 已匯入」標籤只在 imported 項目顯示
 * - 過期/孤兒任務 chip 顯示
 * - queued 任務的 elapsed time、取消、刪除流程
 *
 * 註：webkitdirectory + drag-drop 的匯入流程依賴瀏覽器 API，
 *     在 jsdom 下無法可靠運行。對應的單元測試在
 *     exportBundle.test.ts / importBundle.test.ts。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import VideoHistory from '../components/video/VideoHistory'
import { useVideoStore } from '../stores/videoStore'
import * as videoApi from '../api/video'
import type { VideoHistoryItem } from '../types'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function resetStore() {
  useVideoStore.setState(useVideoStore.getInitialState())
}

beforeEach(resetStore)
afterEach(cleanup)

const NOW = 1777000000 // arbitrary "now" in seconds
const TWO_HOURS = 7200

function makeItem(
  taskId: string,
  overrides: Partial<VideoHistoryItem> = {},
): VideoHistoryItem {
  return {
    taskId,
    status: 'succeeded',
    prompt: `prompt for ${taskId}`,
    createdAt: NOW,
    ...overrides,
  }
}

describe('VideoHistory — display behavior (no time-based filtering)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW * 1000))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows non-imported items regardless of how old they are', () => {
    useVideoStore.getState().addHistory(
      makeItem('t-old', { createdAt: NOW - TWO_HOURS - 60 }),
    )
    render(<VideoHistory />)
    // Previously this item was hidden by the 2-hour filter; now it must show.
    expect(screen.getByText(/prompt for t-old/)).toBeInTheDocument()
  })

  it('shows imported items regardless of age', () => {
    useVideoStore.getState().addHistory(
      makeItem('t-imported-old', {
        createdAt: NOW - TWO_HOURS - 3600,
        imported: true,
      }),
    )
    render(<VideoHistory />)
    expect(screen.getByText(/prompt for t-imported-old/)).toBeInTheDocument()
  })

  it('shows recent non-imported items', () => {
    useVideoStore.getState().addHistory(
      makeItem('t-recent', { createdAt: NOW - 60 }),
    )
    render(<VideoHistory />)
    expect(screen.getByText(/prompt for t-recent/)).toBeInTheDocument()
  })

  it('renders the 📥 已匯入 tag only for imported items', () => {
    useVideoStore.getState().addHistory(
      makeItem('t-recent', { createdAt: NOW - 60 }),
    )
    useVideoStore.getState().addHistory(
      makeItem('t-imported', {
        createdAt: NOW - TWO_HOURS - 3600,
        imported: true,
      }),
    )
    render(<VideoHistory />)
    const tags = screen.getAllByTestId('imported-tag')
    expect(tags).toHaveLength(1)
  })

  it('uses the new "任務紀錄" header without the "(2小時內)" qualifier', () => {
    render(<VideoHistory />)
    expect(screen.getByText(/任務紀錄/)).toBeInTheDocument()
    expect(screen.queryByText(/2小時內/)).toBeNull()
    expect(screen.queryByText(/近期生成/)).toBeNull()
  })
})

describe('VideoHistory — 下載尾幀 menu item', () => {
  it('renders the download-frame item (in the ⋯ menu) only when lastFrameUrl exists', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-no-lf',
      status: 'succeeded',
      prompt: 'no lf',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://cdn/v.mp4',
    })
    useVideoStore.getState().addHistory({
      taskId: 't-with-lf',
      status: 'succeeded',
      prompt: 'has lf',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://cdn/v.mp4',
      lastFrameUrl: 'https://cdn/last.png',
    })

    render(<VideoHistory />)

    // 「▼ 展開詳情」已移除 — 動作收在每張卡的 ⋯ 選單裡
    expect(screen.queryByText(/展開詳情/)).toBeNull()
    const menuButtons = screen.getAllByRole('button', { name: '更多動作' })
    expect(menuButtons).toHaveLength(2)
    for (const b of menuButtons) fireEvent.click(b)

    const frameButtons = screen.queryAllByTestId('download-frame-button')
    // Only the card with lastFrameUrl should expose the item
    expect(frameButtons).toHaveLength(1)
  })
})

describe('VideoHistory — 匯出 .zip menu item', () => {
  it('is available for failed tasks too (task.json 保留參數，供失敗任務留檔/回填)', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-failed',
      status: 'failed',
      prompt: 'boom',
      createdAt: Date.now() / 1000,
      error: 'quota exceeded',
    })
    render(<VideoHistory />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    expect(screen.getByRole('button', { name: /匯出 \.zip/ })).toBeInTheDocument()
  })

  it('is available for expired tasks', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-expired',
      status: 'expired',
      prompt: 'old',
      createdAt: Date.now() / 1000,
    })
    render(<VideoHistory />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    expect(screen.getByRole('button', { name: /匯出 \.zip/ })).toBeInTheDocument()
  })
})

describe('VideoHistory — persistent card actions (succeeded)', () => {
  it('shows 下載 mp4 and 複製 URL without opening any menu', () => {
    useVideoStore.getState().addHistory({
      taskId: 't-actions',
      status: 'succeeded',
      prompt: 'actions',
      createdAt: Date.now() / 1000,
      videoUrl: 'https://cdn/v.mp4',
    })
    render(<VideoHistory />)
    expect(screen.getByRole('button', { name: /下載 mp4/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /複製 URL/ })).toBeInTheDocument()
    expect(screen.queryByText(/展開詳情/)).toBeNull()
  })
})

describe('expired and orphaned states', () => {
  it('renders 已過期 label for expired status', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{ taskId: 'cgt-x', status: 'expired', prompt: 'p', createdAt: 0 }],
    })
    render(<VideoHistory />)
    expect(screen.getByText('已過期')).toBeInTheDocument()
  })

  it('renders 無法查詢 chip when orphaned', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{
        taskId: 'cgt-y', status: 'queued', prompt: 'p', createdAt: 0,
        orphaned: true,
      }],
    })
    render(<VideoHistory />)
    expect(screen.getByText(/無法查詢/)).toBeInTheDocument()
  })
})

describe('queue/run duration display', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows elapsed time for queued tasks (mm:ss)', () => {
    const startSeconds = 1_700_000_000
    vi.setSystemTime(new Date(startSeconds * 1000 + 75_000)) // 75s elapsed

    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{
        taskId: 'cgt-q', status: 'queued', prompt: 'p',
        createdAt: startSeconds,
      }],
    })
    render(<VideoHistory />)
    // 75s = 1:15
    expect(screen.getByText(/1:15/)).toBeInTheDocument()
  })
})

describe('cancel button for queued tasks', () => {
  it('shows a persistent 取消 button when status is queued', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{ taskId: 'cgt-c', status: 'queued', prompt: 'p', createdAt: 0 }],
    })
    render(<VideoHistory />)
    expect(screen.getByRole('button', { name: '取消任務' })).toBeInTheDocument()
  })

  it('does not show 取消 button when status is succeeded', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{
        taskId: 'cgt-c', status: 'succeeded', prompt: 'p', createdAt: 0,
        videoUrl: 'http://x',
      }],
    })
    render(<VideoHistory />)
    expect(screen.queryByRole('button', { name: '取消任務' })).not.toBeInTheDocument()
  })
})

/** 開啟指定卡片的 ⋯ 選單（新版動作列）。 */
function openOverflowMenu() {
  fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
}

describe('delete record button flow', () => {
  it('removes the item after confirming in the ConfirmModal (no window.confirm)', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{
        taskId: 'cgt-del', status: 'succeeded', prompt: 'p', createdAt: 0,
        videoUrl: 'http://x',
      }],
    })
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<VideoHistory />)
    openOverflowMenu()
    fireEvent.click(screen.getByRole('button', { name: '刪除記錄' }))
    // window.confirm 已改為 ConfirmModal
    expect(confirmSpy).not.toHaveBeenCalled()
    const modal = screen.getByRole('dialog')
    fireEvent.click(within(modal).getByRole('button', { name: '刪除' }))
    expect(useVideoStore.getState().history).toEqual([])
    confirmSpy.mockRestore()
  })

  it('keeps the item when the ConfirmModal is cancelled', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{
        taskId: 'cgt-keep', status: 'succeeded', prompt: 'p', createdAt: 0,
        videoUrl: 'http://x',
      }],
    })
    render(<VideoHistory />)
    openOverflowMenu()
    fireEvent.click(screen.getByRole('button', { name: '刪除記錄' }))
    const modal = screen.getByRole('dialog')
    fireEvent.click(within(modal).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useVideoStore.getState().history).toHaveLength(1)
  })
})

describe('VideoHistory — 詳情 展開（prompt 與完整參數）', () => {
  it('collapses details by default and reveals full prompt, original prompt and params on toggle', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{
        taskId: 'cgt-detail',
        status: 'succeeded',
        prompt: 'a very long optimized prompt describing the whole scene',
        originalPrompt: 'short original idea',
        createdAt: 0,
        videoUrl: 'http://x',
        model: 'seedance-2-5',
        ratio: '16:9',
        resolution: '720p',
        duration: 5,
        fps: 24,
        seed: 12345,
      }],
    })
    render(<VideoHistory />)

    // Collapsed: expanded-only content is absent
    expect(screen.queryByText('原始 Prompt')).toBeNull()
    expect(screen.queryByText('seedance-2-5')).toBeNull()
    // The banned legacy label must never reappear
    expect(screen.queryByText(/展開詳情/)).toBeNull()

    // Toggle open
    fireEvent.click(screen.getByRole('button', { name: /詳情/ }))

    const panel = screen.getByTestId('task-details')
    expect(within(panel).getByText(/a very long optimized prompt/)).toBeInTheDocument()
    expect(within(panel).getByText('原始 Prompt')).toBeInTheDocument()
    expect(within(panel).getByText('short original idea')).toBeInTheDocument()
    expect(within(panel).getByText('seedance-2-5')).toBeInTheDocument()
    expect(within(panel).getByText('16:9')).toBeInTheDocument()
  })

  it('shows params in 詳情 even for failed tasks (not only succeeded)', () => {
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      history: [{
        taskId: 'cgt-fail-detail',
        status: 'failed',
        prompt: 'p',
        createdAt: 0,
        error: 'boom',
        model: 'seedance-2-5',
        ratio: '9:16',
      }],
    })
    render(<VideoHistory />)
    fireEvent.click(screen.getByRole('button', { name: /詳情/ }))
    const panel = screen.getByTestId('task-details')
    expect(within(panel).getByText('9:16')).toBeInTheDocument()
  })
})

describe('cancel button — post-cancel state', () => {
  it('updates history status to cancelled and removes from activeTaskIds after successful cancel', async () => {
    const deleteSpy = vi.spyOn(videoApi, 'deleteVideoTask').mockResolvedValue(undefined)
    useVideoStore.setState({
      ...useVideoStore.getInitialState(),
      activeTaskIds: ['cgt-cancel'],
      history: [{ taskId: 'cgt-cancel', status: 'queued', prompt: 'p', createdAt: 0 }],
    })
    render(<VideoHistory />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消任務' }))
    })
    expect(deleteSpy).toHaveBeenCalledWith('cgt-cancel')
    const state = useVideoStore.getState()
    expect(state.history[0].status).toBe('cancelled')
    expect(state.activeTaskIds).toEqual([])
    deleteSpy.mockRestore()
  })
})
