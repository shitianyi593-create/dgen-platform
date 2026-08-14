import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import AssetLibraryPage from '../components/assets/AssetLibraryPage'
import { useAssetStore } from '../stores/assetStore'
import { useAuthStore } from '../stores/authStore'
import type { AssetGroup, PageInfo } from '../types/asset'

// `custom`/`dismiss` are what useAssetJobToasts drives the progress toasts with.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn(),
  }),
}))

const TOTAL = 120 // > 单页 100，所以「载更多」有第 2 页可抓

function fakeGroup(i: number): AssetGroup {
  return {
    id: `g-${i}`, name: `群组 ${i}`, groupType: 'AIGC',
    projectName: 'default', createTime: '', updateTime: '',
  }
}

/** 正常服务器：供应 TOTAL 个群组中的任一视窗。 */
async function pagedFetch(
  _filter?: unknown,
  page: { pageNumber: number; pageSize: number } = { pageNumber: 1, pageSize: 100 },
): Promise<{ items: AssetGroup[]; page: PageInfo }> {
  const start = (page.pageNumber - 1) * page.pageSize
  const items = Array.from(
    { length: Math.max(0, Math.min(page.pageSize, TOTAL - start)) },
    (_, i) => fakeGroup(start + i),
  )
  return { items, page: { ...page, totalCount: TOTAL } }
}

vi.mock('../api/asset', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/asset')>()
  return {
    ...orig,
    // Deferred call into pagedFetch: the factory runs before this module's
    // top-level bindings are initialised.
    listAssetGroups: vi.fn(
      (...args: Parameters<typeof pagedFetch>) => pagedFetch(...args),
    ),
    listAssets: vi.fn(async () => ({
      items: [], page: { pageNumber: 1, pageSize: 100, totalCount: 0 },
    })),
    countAssetsInGroup: vi.fn(async () => 3),
  }
})
import { countAssetsInGroup, listAssetGroups } from '../api/asset'

/**
 * Sidebar 替身。真的滚动 UI（footer、onScroll 閾值）是 Task 3 的活，但载更多
 * 的页面状态机现在就要能被触发与观察 —— 替身只把 Task 2 传下去的 props 摊成
 * 一颗按钮与两条消息，不模擬任何真 sidebar 的行为。
 */
interface SidebarStubProps {
  groups: AssetGroup[]
  loadError?: string | null
  onLoadMore?: () => void
  hasMore?: boolean
  loadingMore?: boolean
  loadMoreError?: string | null
  onQueryChange?: (q: string) => void
}
vi.mock('../components/assets/AssetGroupSidebar', () => ({
  ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH: 260,
  default: (props: SidebarStubProps) => (
    <aside>
      {props.loadError && <div role="alert">{props.loadError}</div>}
      {props.loadMoreError && (
        <div data-testid="load-more-error">{props.loadMoreError}</div>
      )}
      <div data-testid="has-more">{String(props.hasMore)}</div>
      {/* 字直接送进 onQueryChange（debounce 与服务器搜索都在页面那边）。 */}
      <input
        aria-label="搜索群组"
        onChange={(e) => props.onQueryChange?.(e.target.value)}
      />
      {/* 刻意不看 hasMore/loadingMore：这颗按钮代表「一个没被 sidebar 门槛
          过滤的呼叫端」，要测的正是页面自己的守门。 */}
      <button type="button" onClick={() => props.onLoadMore?.()}>
        加载更多
      </button>
      {/* 同一个 closure、同一个 tick 连呼两次 —— 滚动事件在 React 重渲染前
          连发的最小重现。两颗按钮分开点会隔著一次 re-render，测不到这个。 */}
      <button
        type="button"
        onClick={() => {
          props.onLoadMore?.()
          props.onLoadMore?.()
        }}
      >
        加载更多×2
      </button>
      {props.groups.map((g, i) => (
        // key 带上 index 而非只用 id：重复的 id 要以「两列」现形给下方的
        // dedup 断言看，而不是变成一则 React duplicate-key 警告。
        <div key={`${g.id}-${i}`} data-testid={`group-row-${g.id}`}>
          {g.name}
        </div>
      ))}
    </aside>
  ),
}))

/** 初载完成 = 第一页的列已经畫出来。 */
async function mountAndSettle() {
  render(<AssetLibraryPage />)
  await waitFor(() =>
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
  )
}

describe('asset group paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps implementations, but re-arm the pager anyway so a
    // mockImplementation-per-test can't leak into its neighbours.
    vi.mocked(listAssetGroups).mockImplementation(
      (...args: Parameters<typeof pagedFetch>) => pagedFetch(...args),
    )
    useAssetStore.setState(useAssetStore.getInitialState())
    useAuthStore.setState({
      assetCreds: { accessKeyId: 'ak', accessKeySecret: 'sk', projectName: 'default' },
    })
  })

  it('loads exactly one page on mount, sorted CreateTime Desc', async () => {
    await mountAndSettle()
    // 走訪删除后的核心不变式：初载 = 一个请求。页面加载的请求数就是靠这个
    // 从 10+ 降到 1（流控账户的病灶）。
    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledWith(
      {},
      { pageNumber: 1, pageSize: 100 },
      // 排序显式送出：走訪删除后这是唯一保证分页全序的地方，
      // 少了它服务器默认漂移就会让第 2 页与第 1 页重叠或漏项。
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    expect(useAssetStore.getState().groups).toHaveLength(100)
    expect(screen.queryByTestId('group-row-g-100')).not.toBeInTheDocument()
    // 还没载完 → 侧栏要知道自己还有得滚
    expect(screen.getByTestId('has-more')).toHaveTextContent('true')
  })

  it('never fans out per-group counts — one call, for the selected group only', async () => {
    await mountAndSettle()
    // 100 个群组 × 1 个 ListAssets 是流控账户被打爆的另一半。剩下的这唯一
    // 一发是选中群组的标题数字：它跟著「选择」走，不跟著「清单长度」走 ——
    // 所以第 2 页再接上 20 个群组之后，它仍然只有 1 次。
    await waitFor(() =>
      expect(vi.mocked(countAssetsInGroup)).toHaveBeenCalledTimes(1),
    )
    expect(vi.mocked(countAssetsInGroup)).toHaveBeenCalledWith('g-0')

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )
    expect(vi.mocked(countAssetsInGroup)).toHaveBeenCalledTimes(1)
  })

  it('appends the next page and dedups the shifted-window overlap', async () => {
    await mountAndSettle()
    // Desc 排序下抓页期间有群组被创建 → 视窗整个往下位移，第 1 页的尾巴
    // 会在第 2 页重复回传。没有 dedup 就是重复列 + 勾选数错亂。
    vi.mocked(listAssetGroups).mockImplementationOnce(async (_f, page) => ({
      items: [fakeGroup(99), ...Array.from({ length: 20 }, (_, i) => fakeGroup(100 + i))],
      page: { pageNumber: 2, pageSize: 100, totalCount: TOTAL, ...page },
    }))

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )

    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    // 重叠的 g-99 只留一列，累積清单刚好是 TOTAL（不是 121）
    expect(screen.getAllByTestId('group-row-g-99')).toHaveLength(1)
    expect(useAssetStore.getState().groups).toHaveLength(TOTAL)
    // 第 1 页的列没有被换掉 —— append 不是 replace
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument()
    // 全部载完 → 没有更多可载
    expect(screen.getByTestId('has-more')).toHaveTextContent('false')
  })

  it('a load-more failure keeps the loaded list and stays out of the page error', async () => {
    await mountAndSettle()
    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('page 2 exploded'))

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('load-more-error')).toHaveTextContent(
        'page 2 exploded',
      ),
    )
    // 全页 error 不得被污染：已加载的 100 个群组还在，用户照常操作，
    // 失败只在清单底部以行内重试列呈现（UI 是 Task 3）。
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useAssetStore.getState().groups).toHaveLength(100)
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument()
    expect(screen.queryByText('无法连接到素材库 API')).toBeNull()

    // 重试成功 → 错误列消失、第 2 页接上
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('load-more-error')).toBeNull()
  })

  it('does not resurrect a group deleted while load-more is in flight', async () => {
    await mountAndSettle()
    // removeGroup（单删/批删的每一项）不 bump refreshSeq —— seq 挡不住这条
    // 路。append 必须读 store 的即时清单，拿在途前的快照就会把刚删掉的
    // 群组复活。批删 + 退避重试会把在途窗口拉到数秒，这是实际会撞上的竞态。
    let resolvePage2!: (v: Awaited<ReturnType<typeof pagedFetch>>) => void
    vi.mocked(listAssetGroups).mockImplementationOnce(
      () => new Promise((r) => (resolvePage2 = r)),
    )
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))

    act(() => useAssetStore.getState().removeGroup('g-50'))
    expect(screen.queryByTestId('group-row-g-50')).toBeNull()

    const page2 = await pagedFetch({}, { pageNumber: 2, pageSize: 100 })
    await act(async () => resolvePage2(page2))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('group-row-g-50')).toBeNull()
    expect(useAssetStore.getState().groups).toHaveLength(TOTAL - 1)
  })

  it('a same-tick double trigger fetches the next page exactly once', async () => {
    await mountAndSettle()
    fireEvent.click(screen.getByRole('button', { name: '加载更多×2' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )
    // 初载 1 + 载更多 1。state 守门在同一个 tick 内读到的都是旧值，会放行
    // 第二发（多打一个请求，第二次 append 还会把第一次的成果盖掉）——
    // 守门必须靠 ref。
    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledTimes(2)
    expect(useAssetStore.getState().groups).toHaveLength(TOTAL)
  })

  it('refuses to load more while a server search is displayed', async () => {
    await mountAndSettle()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('搜索群组'), {
      target: { value: '群组 7' },
    })
    await act(async () => {
      vi.advanceTimersByTime(320) // debounce 到期 → 搜索接管清单
    })
    vi.useRealTimers()
    await waitFor(() =>
      expect(vi.mocked(listAssetGroups).mock.calls.at(-1)?.[0]).toEqual({
        name: '群组 7',
      }),
    )
    const callsAfterSearch = vi.mocked(listAssetGroups).mock.calls.length

    // 抑制必须住在页面：只有这里知道清单现在是被搜索结果劫持著。真 sidebar
    // 收到的 hasMore 也会被算成 false（footer 静音用的同一个判断），但那是
    // 显示层 —— 任何直接呼叫 onLoadMore 的路径（重试列、未来的呼叫端）都得
    // 撞上这道门，否则未过滤的下一页就接在搜索结果后面了。
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(callsAfterSearch)
    expect(useAssetStore.getState().groups).toHaveLength(100)
  })

  it('page-1 failure takes over the whole page (no sidebar, no grid)', async () => {
    // 一笔都没有时用整页错误接管（而非侧栏横幅）：没有「部分清单」可留给
    // 用户操作。接管条件 error && groups 空 && groupTotal===0 不变。
    vi.mocked(listAssetGroups).mockRejectedValue(new Error('bad creds'))
    render(<AssetLibraryPage />)
    expect(
      await screen.findByText('无法连接到素材库 API'),
    ).toBeInTheDocument()
    expect(screen.getByText('bad creds')).toBeInTheDocument()
    // 接管 = 整个常规版面消失（侧栏 / 素材区都不在），不是多一条横幅。
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('main')).toBeNull()
  })

  it('a fully-loaded (single page) tenant filters client-side instead of hitting the server', async () => {
    // 全套件里没有页面层级测过「小账户、第 1 页就载完」这个方向：
    // servergroupSearch.test.tsx 的账户固定 >1 页；这里直接覆写一次 mock
    // 验证 serverSearchMode 算出 false 之后，打字真的不会多打一个
    // ListAssetGroups——反向（尚未载完 → 打服务器）已有大量覆盖。
    vi.mocked(listAssetGroups).mockImplementationOnce(async () => ({
      items: [fakeGroup(0), fakeGroup(1), fakeGroup(2)],
      page: { pageNumber: 1, pageSize: 100, totalCount: 3 },
    }))
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('has-more')).toHaveTextContent('false')

    const callsBeforeQuery = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(screen.getByLabelText('搜索群组'), {
      target: { value: '1' },
    })
    await new Promise((r) => setTimeout(r, 350)) // 跨过 debounce，确认真的没有动静
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(callsBeforeQuery)
  })
})
