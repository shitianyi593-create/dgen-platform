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

/** 滚动容器 = `aside` 本身（唯一 overflowY:auto 的层）。 */
const scroller = () => screen.getByRole('complementary')

/**
 * jsdom 不做版面，三个几何属性恒为 0（`0 - 0 - 0 < 200` 会让每个 scroll 事件
 * 都看起来像「到底了」）。全部自己定义，閾值两侧才测得出差别。
 * 默认 scrollHeight 1000 / clientHeight 400 → 底部在 scrollTop 600。
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

/** 滚到距底 100px（< 200 閾值）。 */
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
    // 1000 - 100 - 400 = 500px 距底 —— 还早得很
    setScrollGeometry(el, { scrollTop: 100 })
    fireEvent.scroll(el)
    expect(props.onLoadMore).not.toHaveBeenCalled()
  })

  it('does not fire while a page is already in flight', () => {
    // 页面的 ref guard 让重覆呼叫无害，但 sidebar 不该在下一页回来前
    // 对每一个 scroll 事件（滚动中每帧都来一发）都叫一次。
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
    // 失败后若照样自动重试，用户停在底部就会变成无限重打同一个坏请求。
    const props = makeProps({ loadMoreError: '第 2 页爆了' })
    render(<AssetGroupSidebar {...props} />)
    scrollNearBottom()
    expect(props.onLoadMore).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '加载更多失败，点击重试' }))
    expect(props.onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('footer shows 已加载 N / M while more remain', () => {
    const { container } = render(<AssetGroupSidebar {...makeProps()} />)
    expect(screen.getByText('已加载 3 / 10')).toBeInTheDocument()
    expect(container.querySelector('.spinner')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '加载更多失败，点击重试' }),
    ).toBeNull()
  })

  it('footer progress row is announced to screen readers (role=status, parity with the spinner row)', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    // 没有这个属性的话，滚动接上新一页对螢幕报读器用户是完全无声的 ——
    // 加载中的 spinner 列有 role="status"，进度列不能少一等。
    expect(screen.getByRole('status')).toHaveTextContent('已加载 3 / 10')
  })

  it('footer shows a spinner row while loading more', () => {
    const { container } = render(
      <AssetGroupSidebar {...makeProps({ loadingMore: true })} />,
    )
    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText('已加载 3 / 10')).toBeNull()
  })

  it('footer shows the retry row on failure, replacing the progress text', () => {
    const { container } = render(
      <AssetGroupSidebar {...makeProps({ loadMoreError: '第 2 页爆了' })} />,
    )
    expect(
      screen.getByRole('button', { name: '加载更多失败，点击重试' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('已加载 3 / 10')).toBeNull()
    expect(container.querySelector('.spinner')).toBeNull()
  })

  it('footer renders nothing once the list is fully loaded', () => {
    const { container } = render(
      <AssetGroupSidebar {...makeProps({ hasMore: false, totalCount: 3 })} />,
    )
    expect(screen.queryByText(/^已加载/)).toBeNull()
    expect(container.querySelector('.spinner')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '加载更多失败，点击重试' }),
    ).toBeNull()
  })

  it('footer stays visible in manage mode, above the sticky action bar', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    const footer = screen.getByText('已加载 3 / 10')
    // 操作列 sticky 贴底，footer 不 sticky —— DOM 顺序上 footer 必须在它之前，
    // 否则进度字会被压在操作列底下（或跑到操作列下方）。
    const bar = screen.getByRole('button', { name: '全选' })
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
    // count 扇出已删除，徽章连同 `counts` prop 一起移除 —— 旧实作在没有
    // count 时渲染 '—'，它的存在就是徽章复活的信号。
    expect(screen.queryByText('—')).toBeNull()
    // 列上只剩名称（数据夹 icon 与 ⋯ 触发钮都没有文字内容）
    expect(screen.getByTestId('group-row-a').textContent).toBe('甲')
  })
})
