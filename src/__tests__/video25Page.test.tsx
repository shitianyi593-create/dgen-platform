/**
 * /video-25 页面接线测试（Task 13）。
 *
 * 这里刻意渲染整个 <App />（而非单独的 Video25GenPage），因为要验证的正是
 * 「路由表 + 导航列 + 页面壳层」三者接在一起」这件事：
 *   - App.tsx 的 <Route path="/video-25"> 有排在 catch-all 之前
 *   - Header 的分页能导到该路由
 *   - 页面把 useStore={useVideo25Store} 真的传给了共用的 Preview / History
 *
 * 最后一点是最容易回归的地方：漏传 prop 不会有型别错误（prop 选填、默认 2.0
 * store），只会静静地在 2.5 页显示 2.0 的记录与预览。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { useVideoStore } from '../stores/videoStore'
import { useVideo25Store } from '../stores/video25Store'
import { I18nProvider } from '../i18n/I18nProvider'
import { messages } from '../i18n/locales'

const t = messages['zh-CN']

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
    prompt: '二点五的记录',
    createdAt: Date.now() / 1000,
    videoUrl: 'https://example.com/v25.mp4',
  })
  useVideoStore.getState().addHistory({
    taskId: 'cgt-20-page',
    status: 'succeeded',
    prompt: '二点零的记录',
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
  it('挂载 2.5 参数面板、预览与任务记录三栏', () => {
    renderAppAt('/video-25')
    expect(screen.getByText('Seedance 2.5')).toBeInTheDocument()               // Video25Params 模型栏
    expect(screen.getByRole('checkbox', { name: t['video25.optimize.toggle'] })).toBeInTheDocument()
    expect(screen.getByText(t['video.history.title'])).toBeInTheDocument()                    // VideoHistory
  })

  it('/video 仍是 2.0 页，没有提示词优化开关', () => {
    renderAppAt('/video')
    expect(screen.getByText('Seedance 2.0')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: t['video25.optimize.toggle'] })).not.toBeInTheDocument()
  })
})

describe('Header 视频生成 2.5 分页', () => {
  it('分页存在且点击后导向 2.5 页', async () => {
    const user = userEvent.setup()
    renderAppAt('/video')
    const tab = screen.getByRole('button', { name: '视频生成 2.5' })
    expect(tab).toBeInTheDocument()

    await user.click(tab)
    expect(screen.getByText('Seedance 2.5')).toBeInTheDocument()
    expect(screen.queryByText('Seedance 2.0')).not.toBeInTheDocument()
  })
})

describe('2.5 页的共用组件绑定 useVideo25Store', () => {
  it('/video-25 的任务记录只显示 2.5 store 的项目', () => {
    seedBothHistories()
    renderAppAt('/video-25')
    expect(screen.getByText('二点五的记录')).toBeInTheDocument()
    expect(screen.queryByText('二点零的记录')).not.toBeInTheDocument()
  })

  it('/video 的任务记录只显示 2.0 store 的项目（2.5 未污染 2.0）', () => {
    seedBothHistories()
    renderAppAt('/video')
    expect(screen.getByText('二点零的记录')).toBeInTheDocument()
    expect(screen.queryByText('二点五的记录')).not.toBeInTheDocument()
  })

  it('/video-25 的预览读 2.5 store 的 currentTask', () => {
    seedBothHistories()
    useVideo25Store.getState().setCurrentTask('cgt-25-page')
    useVideoStore.getState().setCurrentTask('cgt-20-page')
    renderAppAt('/video-25')
    expect(screen.getAllByText(/cgt-25-page/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/cgt-20-page/)).not.toBeInTheDocument()
  })

  // 栏宽 storage key 若被复制成 2.0 页的（videoGenPage.*），型别完全正确、
  // 只会让两页的拖拽宽度互相覆写 —— 与 useStore prop 同一类的静默失败。
  it('栏宽 storage key 与 2.0 页互不干扰', () => {
    localStorage.setItem('videoGenPage.paramsWidth', '500')
    renderAppAt('/video-25')
    expect(localStorage.getItem('video25GenPage.paramsWidth')).toBe('320')
    expect(localStorage.getItem('videoGenPage.paramsWidth')).toBe('500')
  })
})
