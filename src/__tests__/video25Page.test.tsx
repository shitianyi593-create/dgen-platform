/**
 * /video-25 頁面接線測試（Task 13）。
 *
 * 這裡刻意渲染整個 <App />（而非單獨的 Video25GenPage），因為要驗證的正是
 * 「路由表 + 導覽列 + 頁面殼層」三者接在一起」這件事：
 *   - App.tsx 的 <Route path="/video-25"> 有排在 catch-all 之前
 *   - Header 的分頁能導到該路由
 *   - 頁面把 useStore={useVideo25Store} 真的傳給了共用的 Preview / History
 *
 * 最後一點是最容易回歸的地方：漏傳 prop 不會有型別錯誤（prop 選填、預設 2.0
 * store），只會靜靜地在 2.5 頁顯示 2.0 的紀錄與預覽。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { useVideoStore } from '../stores/videoStore'
import { useVideo25Store } from '../stores/video25Store'
import { I18nProvider } from '../i18n/I18nProvider'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  Toaster: () => null,
}))

function renderAppAt(path: string) {
  window.history.pushState({}, '', path)
  return render(
    <I18nProvider initialLocale="zh-CN">
      <App />
    </I18nProvider>,
  )
}

function seedBothHistories() {
  useVideo25Store.getState().addHistory({
    taskId: 'cgt-25-page',
    status: 'succeeded',
    prompt: '二點五的紀錄',
    createdAt: Date.now() / 1000,
    videoUrl: 'https://example.com/v25.mp4',
  })
  useVideoStore.getState().addHistory({
    taskId: 'cgt-20-page',
    status: 'succeeded',
    prompt: '二點零的紀錄',
    createdAt: Date.now() / 1000,
    videoUrl: 'https://example.com/v20.mp4',
  })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  useVideoStore.setState(useVideoStore.getInitialState())
  useVideo25Store.setState(useVideo25Store.getInitialState())
})

describe('/video-25 route', () => {
  it('掛載 2.5 參數面板、預覽與任務紀錄三欄', () => {
    renderAppAt('/video-25')
    expect(screen.getByText('Seedance 2.5')).toBeInTheDocument()               // Video25Params 模型欄
    expect(screen.getByRole('checkbox', { name: '提示詞優化' })).toBeInTheDocument()
    expect(screen.getByText('任務紀錄')).toBeInTheDocument()                    // VideoHistory
  })

  it('/video 仍是 2.0 頁，沒有提示詞優化開關', () => {
    renderAppAt('/video')
    expect(screen.getByText('Seedance 2.0')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '提示詞優化' })).not.toBeInTheDocument()
  })
})

describe('Header 影片生成 2.5 分頁', () => {
  it('分頁存在且點擊後導向 2.5 頁', async () => {
    const user = userEvent.setup()
    renderAppAt('/video')
    const tab = screen.getByRole('button', { name: '视频生成 2.5' })
    expect(tab).toBeInTheDocument()

    await user.click(tab)
    expect(screen.getByText('Seedance 2.5')).toBeInTheDocument()
    expect(screen.queryByText('Seedance 2.0')).not.toBeInTheDocument()
  })
})

describe('2.5 頁的共用元件綁定 useVideo25Store', () => {
  it('/video-25 的任務紀錄只顯示 2.5 store 的項目', () => {
    seedBothHistories()
    renderAppAt('/video-25')
    expect(screen.getByText('二點五的紀錄')).toBeInTheDocument()
    expect(screen.queryByText('二點零的紀錄')).not.toBeInTheDocument()
  })

  it('/video 的任務紀錄只顯示 2.0 store 的項目（2.5 未污染 2.0）', () => {
    seedBothHistories()
    renderAppAt('/video')
    expect(screen.getByText('二點零的紀錄')).toBeInTheDocument()
    expect(screen.queryByText('二點五的紀錄')).not.toBeInTheDocument()
  })

  it('/video-25 的預覽讀 2.5 store 的 currentTask', () => {
    seedBothHistories()
    useVideo25Store.getState().setCurrentTask('cgt-25-page')
    useVideoStore.getState().setCurrentTask('cgt-20-page')
    renderAppAt('/video-25')
    expect(screen.getAllByText(/cgt-25-page/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/cgt-20-page/)).not.toBeInTheDocument()
  })

  // 欄寬 storage key 若被複製成 2.0 頁的（videoGenPage.*），型別完全正確、
  // 只會讓兩頁的拖曳寬度互相覆寫 —— 與 useStore prop 同一類的靜默失敗。
  it('欄寬 storage key 與 2.0 頁互不干擾', () => {
    localStorage.setItem('videoGenPage.paramsWidth', '500')
    renderAppAt('/video-25')
    expect(localStorage.getItem('video25GenPage.paramsWidth')).toBe('320')
    expect(localStorage.getItem('videoGenPage.paramsWidth')).toBe('500')
  })
})
