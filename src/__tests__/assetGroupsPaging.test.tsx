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

const TOTAL = 120 // > 單頁 100，所以「載更多」有第 2 頁可抓

function fakeGroup(i: number): AssetGroup {
  return {
    id: `g-${i}`, name: `群組 ${i}`, groupType: 'AIGC',
    projectName: 'default', createTime: '', updateTime: '',
  }
}

/** 正常伺服器：供應 TOTAL 個群組中的任一視窗。 */
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
 * Sidebar 替身。真的捲動 UI（footer、onScroll 閾值）是 Task 3 的活，但載更多
 * 的頁面狀態機現在就要能被觸發與觀察 —— 替身只把 Task 2 傳下去的 props 攤成
 * 一顆按鈕與兩條訊息，不模擬任何真 sidebar 的行為。
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
      {/* 字直接送進 onQueryChange（debounce 與伺服器搜尋都在頁面那邊）。 */}
      <input
        aria-label="搜尋群組"
        onChange={(e) => props.onQueryChange?.(e.target.value)}
      />
      {/* 刻意不看 hasMore/loadingMore：這顆按鈕代表「一個沒被 sidebar 門檻
          過濾的呼叫端」，要測的正是頁面自己的守門。 */}
      <button type="button" onClick={() => props.onLoadMore?.()}>
        載入更多
      </button>
      {/* 同一個 closure、同一個 tick 連呼兩次 —— 捲動事件在 React 重渲染前
          連發的最小重現。兩顆按鈕分開點會隔著一次 re-render，測不到這個。 */}
      <button
        type="button"
        onClick={() => {
          props.onLoadMore?.()
          props.onLoadMore?.()
        }}
      >
        載入更多×2
      </button>
      {props.groups.map((g, i) => (
        // key 帶上 index 而非只用 id：重複的 id 要以「兩列」現形給下方的
        // dedup 斷言看，而不是變成一則 React duplicate-key 警告。
        <div key={`${g.id}-${i}`} data-testid={`group-row-${g.id}`}>
          {g.name}
        </div>
      ))}
    </aside>
  ),
}))

/** 初載完成 = 第一頁的列已經畫出來。 */
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
    // 走訪刪除後的核心不變式：初載 = 一個請求。頁面載入的請求數就是靠這個
    // 從 10+ 降到 1（流控帳戶的病灶）。
    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledWith(
      {},
      { pageNumber: 1, pageSize: 100 },
      // 排序顯式送出：走訪刪除後這是唯一保證分頁全序的地方，
      // 少了它伺服器預設漂移就會讓第 2 頁與第 1 頁重疊或漏項。
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    expect(useAssetStore.getState().groups).toHaveLength(100)
    expect(screen.queryByTestId('group-row-g-100')).not.toBeInTheDocument()
    // 還沒載完 → 側欄要知道自己還有得捲
    expect(screen.getByTestId('has-more')).toHaveTextContent('true')
  })

  it('never fans out per-group counts — one call, for the selected group only', async () => {
    await mountAndSettle()
    // 100 個群組 × 1 個 ListAssets 是流控帳戶被打爆的另一半。剩下的這唯一
    // 一發是選中群組的標題數字：它跟著「選取」走，不跟著「清單長度」走 ——
    // 所以第 2 頁再接上 20 個群組之後，它仍然只有 1 次。
    await waitFor(() =>
      expect(vi.mocked(countAssetsInGroup)).toHaveBeenCalledTimes(1),
    )
    expect(vi.mocked(countAssetsInGroup)).toHaveBeenCalledWith('g-0')

    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )
    expect(vi.mocked(countAssetsInGroup)).toHaveBeenCalledTimes(1)
  })

  it('appends the next page and dedups the shifted-window overlap', async () => {
    await mountAndSettle()
    // Desc 排序下抓頁期間有群組被建立 → 視窗整個往下位移，第 1 頁的尾巴
    // 會在第 2 頁重複回傳。沒有 dedup 就是重複列 + 勾選數錯亂。
    vi.mocked(listAssetGroups).mockImplementationOnce(async (_f, page) => ({
      items: [fakeGroup(99), ...Array.from({ length: 20 }, (_, i) => fakeGroup(100 + i))],
      page: { pageNumber: 2, pageSize: 100, totalCount: TOTAL, ...page },
    }))

    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )

    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    // 重疊的 g-99 只留一列，累積清單剛好是 TOTAL（不是 121）
    expect(screen.getAllByTestId('group-row-g-99')).toHaveLength(1)
    expect(useAssetStore.getState().groups).toHaveLength(TOTAL)
    // 第 1 頁的列沒有被換掉 —— append 不是 replace
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument()
    // 全部載完 → 沒有更多可載
    expect(screen.getByTestId('has-more')).toHaveTextContent('false')
  })

  it('a load-more failure keeps the loaded list and stays out of the page error', async () => {
    await mountAndSettle()
    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('page 2 exploded'))

    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('load-more-error')).toHaveTextContent(
        'page 2 exploded',
      ),
    )
    // 全頁 error 不得被污染：已載入的 100 個群組還在，使用者照常操作，
    // 失敗只在清單底部以行內重試列呈現（UI 是 Task 3）。
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useAssetStore.getState().groups).toHaveLength(100)
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument()
    expect(screen.queryByText('無法連線到 ARK Asset API')).toBeNull()

    // 重試成功 → 錯誤列消失、第 2 頁接上
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('load-more-error')).toBeNull()
  })

  it('does not resurrect a group deleted while load-more is in flight', async () => {
    await mountAndSettle()
    // removeGroup（單刪/批刪的每一項）不 bump refreshSeq —— seq 擋不住這條
    // 路。append 必須讀 store 的即時清單，拿在途前的快照就會把剛刪掉的
    // 群組復活。批刪 + 退避重試會把在途窗口拉到數秒，這是實際會撞上的競態。
    let resolvePage2!: (v: Awaited<ReturnType<typeof pagedFetch>>) => void
    vi.mocked(listAssetGroups).mockImplementationOnce(
      () => new Promise((r) => (resolvePage2 = r)),
    )
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))

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
    fireEvent.click(screen.getByRole('button', { name: '載入更多×2' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-119')).toBeInTheDocument(),
    )
    // 初載 1 + 載更多 1。state 守門在同一個 tick 內讀到的都是舊值，會放行
    // 第二發（多打一個請求，第二次 append 還會把第一次的成果蓋掉）——
    // 守門必須靠 ref。
    expect(vi.mocked(listAssetGroups)).toHaveBeenCalledTimes(2)
    expect(useAssetStore.getState().groups).toHaveLength(TOTAL)
  })

  it('refuses to load more while a server search is displayed', async () => {
    await mountAndSettle()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('搜尋群組'), {
      target: { value: '群組 7' },
    })
    await act(async () => {
      vi.advanceTimersByTime(320) // debounce 到期 → 搜尋接管清單
    })
    vi.useRealTimers()
    await waitFor(() =>
      expect(vi.mocked(listAssetGroups).mock.calls.at(-1)?.[0]).toEqual({
        name: '群組 7',
      }),
    )
    const callsAfterSearch = vi.mocked(listAssetGroups).mock.calls.length

    // 抑制必須住在頁面：只有這裡知道清單現在是被搜尋結果劫持著。真 sidebar
    // 收到的 hasMore 也會被算成 false（footer 靜音用的同一個判斷），但那是
    // 顯示層 —— 任何直接呼叫 onLoadMore 的路徑（重試列、未來的呼叫端）都得
    // 撞上這道門，否則未過濾的下一頁就接在搜尋結果後面了。
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(callsAfterSearch)
    expect(useAssetStore.getState().groups).toHaveLength(100)
  })

  it('page-1 failure takes over the whole page (no sidebar, no grid)', async () => {
    // 一筆都沒有時用整頁錯誤接管（而非側欄橫幅）：沒有「部分清單」可留給
    // 使用者操作。接管條件 error && groups 空 && groupTotal===0 不變。
    vi.mocked(listAssetGroups).mockRejectedValue(new Error('bad creds'))
    render(<AssetLibraryPage />)
    expect(
      await screen.findByText('無法連線到 ARK Asset API'),
    ).toBeInTheDocument()
    expect(screen.getByText('bad creds')).toBeInTheDocument()
    // 接管 = 整個常規版面消失（側欄 / 素材區都不在），不是多一條橫幅。
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('main')).toBeNull()
  })

  it('a fully-loaded (single page) tenant filters client-side instead of hitting the server', async () => {
    // 全套件裡沒有頁面層級測過「小帳戶、第 1 頁就載完」這個方向：
    // servergroupSearch.test.tsx 的帳戶固定 >1 頁；這裡直接覆寫一次 mock
    // 驗證 serverSearchMode 算出 false 之後，打字真的不會多打一個
    // ListAssetGroups——反向（尚未載完 → 打伺服器）已有大量覆蓋。
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
    fireEvent.change(screen.getByLabelText('搜尋群組'), {
      target: { value: '1' },
    })
    await new Promise((r) => setTimeout(r, 350)) // 跨過 debounce，確認真的沒有動靜
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(callsBeforeQuery)
  })
})
