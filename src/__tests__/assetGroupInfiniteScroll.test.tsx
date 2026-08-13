import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AssetGroupSidebar from '../components/assets/AssetGroupSidebar'
import type { AssetGroup } from '../types/asset'

function g(id: string, name: string): AssetGroup {
  return {
    id,
    name,
    groupType: 'AIGC',
    projectName: 'default',
    createTime: '',
    updateTime: '',
  }
}
const groups = [g('a', '甲'), g('b', '乙'), g('c', '丙')]

function makeProps(
  overrides: Partial<Parameters<typeof AssetGroupSidebar>[0]> = {},
) {
  return {
    groups,
    selectedId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(async () => {}),
    onRename: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onBatchDelete: vi.fn(async () => null as { failedIds: string[] } | null),
    onLoadMore: vi.fn(),
    hasMore: true,
    loadingMore: false,
    loadMoreError: null as string | null,
    totalCount: 10,
    ...overrides,
  }
}

/** 捲動容器 = `aside` 本身（唯一 overflowY:auto 的層）。 */
const scroller = () => screen.getByRole('complementary')

/**
 * jsdom 不做版面，三個幾何屬性恆為 0（`0 - 0 - 0 < 200` 會讓每個 scroll 事件
 * 都看起來像「到底了」）。全部自己定義，閾值兩側才測得出差別。
 * 預設 scrollHeight 1000 / clientHeight 400 → 底部在 scrollTop 600。
 */
function setScrollGeometry(
  el: HTMLElement,
  { scrollTop, scrollHeight = 1000, clientHeight = 400 }: { scrollTop: number; scrollHeight?: number; clientHeight?: number },
) {
  const geometry = { scrollHeight, clientHeight, scrollTop }
  for (const [prop, value] of Object.entries(geometry)) {
    Object.defineProperty(el, prop, {
      value,
      configurable: true,
      writable: true,
    })
  }
}

/** 捲到距底 100px（< 200 閾值）。 */
function scrollNearBottom() {
  const el = scroller()
  setScrollGeometry(el, { scrollTop: 500 })
  fireEvent.scroll(el)
}

describe('AssetGroupSidebar infinite scroll', () => {
  it('fires onLoadMore once when scrolled within 200px of the bottom', () => {
    const props = makeProps()
    render(<AssetGroupSidebar {...props} />)
    scrollNearBottom()
    expect(props.onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not fire outside the 200px threshold', () => {
    const props = makeProps()
    render(<AssetGroupSidebar {...props} />)
    const el = scroller()
    // 1000 - 100 - 400 = 500px 距底 —— 還早得很
    setScrollGeometry(el, { scrollTop: 100 })
    fireEvent.scroll(el)
    expect(props.onLoadMore).not.toHaveBeenCalled()
  })

  it('does not fire while a page is already in flight', () => {
    // 頁面的 ref guard 讓重覆呼叫無害，但 sidebar 不該在下一頁回來前
    // 對每一個 scroll 事件（捲動中每幀都來一發）都叫一次。
    const props = makeProps({ loadingMore: true })
    render(<AssetGroupSidebar {...props} />)
    scrollNearBottom()
    expect(props.onLoadMore).not.toHaveBeenCalled()
  })

  it('does not fire when everything is already loaded', () => {
    const props = makeProps({ hasMore: false })
    render(<AssetGroupSidebar {...props} />)
    scrollNearBottom()
    expect(props.onLoadMore).not.toHaveBeenCalled()
  })

  it('stops auto-firing after a failure — retry is the retry row, not the scrollbar', () => {
    // 失敗後若照樣自動重試，使用者停在底部就會變成無限重打同一個壞請求。
    const props = makeProps({ loadMoreError: '第 2 頁爆了' })
    render(<AssetGroupSidebar {...props} />)
    scrollNearBottom()
    expect(props.onLoadMore).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '載入更多失敗，點擊重試' }))
    expect(props.onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('footer shows 已載入 N / M while more remain', () => {
    const { container } = render(<AssetGroupSidebar {...makeProps()} />)
    expect(screen.getByText('已載入 3 / 10')).toBeInTheDocument()
    expect(container.querySelector('.spinner')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '載入更多失敗，點擊重試' }),
    ).toBeNull()
  })

  it('footer progress row is announced to screen readers (role=status, parity with the spinner row)', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    // 沒有這個屬性的話，捲動接上新一頁對螢幕報讀器使用者是完全無聲的 ——
    // 載入中的 spinner 列有 role="status"，進度列不能少一等。
    expect(screen.getByRole('status')).toHaveTextContent('已載入 3 / 10')
  })

  it('footer shows a spinner row while loading more', () => {
    const { container } = render(
      <AssetGroupSidebar {...makeProps({ loadingMore: true })} />,
    )
    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText('已載入 3 / 10')).toBeNull()
  })

  it('footer shows the retry row on failure, replacing the progress text', () => {
    const { container } = render(
      <AssetGroupSidebar {...makeProps({ loadMoreError: '第 2 頁爆了' })} />,
    )
    expect(
      screen.getByRole('button', { name: '載入更多失敗，點擊重試' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('已載入 3 / 10')).toBeNull()
    expect(container.querySelector('.spinner')).toBeNull()
  })

  it('footer renders nothing once the list is fully loaded', () => {
    const { container } = render(
      <AssetGroupSidebar {...makeProps({ hasMore: false, totalCount: 3 })} />,
    )
    expect(screen.queryByText(/^已載入/)).toBeNull()
    expect(container.querySelector('.spinner')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '載入更多失敗，點擊重試' }),
    ).toBeNull()
  })

  it('footer stays visible in manage mode, above the sticky action bar', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    const footer = screen.getByText('已載入 3 / 10')
    // 操作列 sticky 貼底，footer 不 sticky —— DOM 順序上 footer 必須在它之前，
    // 否則進度字會被壓在操作列底下（或跑到操作列下方）。
    const bar = screen.getByRole('button', { name: '全選' })
    expect(
      footer.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('scrolling still loads more while in manage mode', () => {
    const props = makeProps()
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    scrollNearBottom()
    expect(props.onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('rows carry no per-group count badge', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    // count 扇出已刪除，徽章連同 `counts` prop 一起移除 —— 舊實作在沒有
    // count 時渲染 '—'，它的存在就是徽章復活的信號。
    expect(screen.queryByText('—')).toBeNull()
    // 列上只剩名稱（資料夾 icon 與 ⋯ 觸發鈕都沒有文字內容）
    expect(screen.getByTestId('group-row-a').textContent).toBe('甲')
  })
})
