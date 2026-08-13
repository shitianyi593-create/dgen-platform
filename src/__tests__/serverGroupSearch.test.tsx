import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from '@testing-library/react'
import AssetLibraryPage from '../components/assets/AssetLibraryPage'
import { useAssetStore } from '../stores/assetStore'
import { useAuthStore } from '../stores/authStore'
import type { Asset, AssetGroup, PageInfo } from '../types/asset'

// `custom`/`dismiss` are what useAssetJobToasts drives the progress toasts with.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn(),
  }),
}))

/** 遠多於初載的 1 頁（100 筆）→ `已載入 < TotalCount` 成立 → 伺服器端搜尋模式。 */
const TOTAL = 1500

function fakeGroup(i: number): AssetGroup {
  return {
    id: `g-${i}`, name: `群組 ${i}`, groupType: 'AIGC',
    projectName: 'default', createTime: '', updateTime: '',
  }
}
const ALL = Array.from({ length: TOTAL }, (_, i) => fakeGroup(i))

/** 每個群組給 2 個 Active 素材 — 「勾了素材再搜尋」的劫持路徑要有東西可勾。 */
function fakeAssets(groupId: string): Asset[] {
  return [1, 2].map((n) => ({
    id: `${groupId}-a${n}`,
    name: `素材 ${groupId}-${n}`,
    url: `https://example.invalid/${groupId}-${n}`,
    groupId,
    assetType: 'Image',
    status: 'Active',
    projectName: 'default',
    createTime: '',
    updateTime: '',
  }))
}

/** 假伺服器：Name 子字串過濾 + 分頁，TotalCount 回報過濾後的總數。 */
async function pagedFetch(
  filter: { name?: string } = {},
  page: { pageNumber: number; pageSize: number } = { pageNumber: 1, pageSize: 100 },
): Promise<{ items: AssetGroup[]; page: PageInfo }> {
  const name = filter.name
  const universe = name ? ALL.filter((g) => g.name.includes(name)) : ALL
  const start = (page.pageNumber - 1) * page.pageSize
  return {
    items: universe.slice(start, start + page.pageSize),
    page: { ...page, totalCount: universe.length },
  }
}

vi.mock('../api/asset', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/asset')>()
  const listAssetGroups = vi.fn(
    // Deferred call into pagedFetch: the factory runs before this module's
    // top-level bindings are initialised.
    (...args: Parameters<typeof pagedFetch>) => pagedFetch(...args),
  )
  return {
    ...orig,
    listAssetGroups,
    listAssets: vi.fn(async (filter?: { groupId?: string }) => {
      const items = filter?.groupId ? fakeAssets(filter.groupId) : []
      return {
        items,
        page: { pageNumber: 1, pageSize: 100, totalCount: items.length },
      }
    }),
    countAssetsInGroup: vi.fn(async () => 0),
    deleteAssetGroup: vi.fn(async () => {}),
    createAssetGroup: vi.fn(async (input: { name: string }) => ({
      id: `new-${input.name}`,
      name: input.name,
      groupType: 'AIGC' as const,
      projectName: 'default',
      createTime: '',
      updateTime: '',
    })),
  }
})
import { createAssetGroup, deleteAssetGroup, listAssetGroups } from '../api/asset'

/** 有沒有打過「Name = q」的伺服器端搜尋。 */
function searchedFor(q: string): boolean {
  return vi
    .mocked(listAssetGroups)
    .mock.calls.some(([f]) => (f as { name?: string } | undefined)?.name === q)
}

/** 輸入搜尋字並跨過 300ms debounce。 */
async function typeSearch(q: string) {
  vi.useFakeTimers()
  fireEvent.change(screen.getByLabelText('搜尋群組'), { target: { value: q } })
  await act(async () => {
    vi.advanceTimersByTime(320)
  })
  vi.useRealTimers()
}

/** 捲動容器 = sidebar 的 `aside`（唯一 overflowY:auto 的層）。 */
const sidebar = () => screen.getByRole('complementary')

/**
 * 捲到距底 100px（< 200 閾值）。jsdom 不做版面，三個幾何屬性恆為 0 ——
 * `0 - 0 - 0 < 200` 會讓每個 scroll 事件都看起來像「到底了」，所以全部自己
 * 定義，測到的才是「捲近底部」而不是 jsdom 的預設。
 */
function scrollNearBottom() {
  const el = sidebar()
  const geometry = { scrollHeight: 1000, clientHeight: 400, scrollTop: 500 }
  for (const [prop, value] of Object.entries(geometry)) {
    Object.defineProperty(el, prop, { value, configurable: true, writable: true })
  }
  fireEvent.scroll(el)
}

/** 讓 scroll 之後可能發生的請求有機會跑完（沒有請求時就是一次空轉）。 */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 在 sidebar 底部載入列上點「管理」→ 勾一列 → 走完 typed-confirm 批刪。 */
async function batchDeleteRow(testId: string) {
  fireEvent.click(screen.getByRole('button', { name: '管理' }))
  fireEvent.click(screen.getByTestId(testId))
  fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(1\)/ }))
  fireEvent.change(await screen.findByPlaceholderText('輸入「刪除」以確認'), {
    target: { value: '刪除' },
  })
  const listCallsBefore = vi.mocked(listAssetGroups).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
  // 收尾的訊號是批次結束後的那次群組清單請求（重跑查詢或重載第 1 頁）。
  await waitFor(
    () =>
      expect(vi.mocked(listAssetGroups).mock.calls.length).toBeGreaterThan(
        listCallsBefore,
      ),
    { timeout: 3000 },
  )
  await flush()
}

describe('server-side group search (>1000 groups)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps implementations, but re-arm the pager anyway so a
    // future mockImplementation-per-test can't leak into its neighbours.
    vi.mocked(listAssetGroups).mockImplementation(
      (...args: Parameters<typeof pagedFetch>) => pagedFetch(...args),
    )
    useAssetStore.setState(
      (useAssetStore as unknown as { getInitialState: () => object }).getInitialState(),
    )
    useAuthStore.setState({
      assetCreds: { accessKeyId: 'ak', accessKeySecret: 'sk', projectName: 'default' },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('typing queries the server (debounced) and swaps in the results', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('搜尋群組'), { target: { value: '1234' } })
    expect(searchedFor('1234')).toBe(false) // debounce 300ms 內不打伺服器
    await act(async () => {
      vi.advanceTimersByTime(320)
    })
    vi.useRealTimers()

    await waitFor(() => {
      expect(searchedFor('1234')).toBe(true)
      // 全量清單抓不到的第 1234 個群組，靠伺服器端搜尋現身
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('group-row-g-0')).not.toBeInTheDocument()
  })

  it('clearing the query restores the (capped) full list', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('1234')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )

    await typeSearch('')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
  })

  it('zero server-side matches show 無符合群組, not the empty-tenant CTA', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('沒有這種群組')
    await waitFor(() => expect(screen.getByText('無符合群組')).toBeInTheDocument())
    // groups 被設成 [] 不代表這個 tenant 沒有群組 —— 有 1500 個，只是搜不到。
    expect(screen.queryByText('建立第一個群組')).not.toBeInTheDocument()
    // 「無符合群組」配上「已載入 0 / 1500」是自相矛盾的一對：一個說搜不到，
    // 另一個說清單載到一半。搜尋顯示中沒有累積進度可言 —— footer 靜音。
    expect(screen.queryByText(/^已載入/)).toBeNull()
  })

  it('a stale error banner + a zero-result search must not take over the page', async () => {
    // 審查者重現的鏈：手上留著一條錯誤（groups 非空，所以還沒接管）→ 使用者
    // 搜到零筆 → setGroups([]) →「error && groups 空」成立 → 整頁翻成憑證診斷
    // 畫面，sidebar 連同搜尋框一起被卸載。使用者連改個搜尋字自救都做不到，
    // 唯一出路是重新整理。
    //（錯誤來源原本是全量走訪的第 2 頁失敗；走訪刪除後改由「清空搜尋觸發的
    //  重載第 1 頁失敗」製造同一個狀態 —— 釘的是接管判斷，不是錯誤的出處。）
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('567')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-567')).toBeInTheDocument(),
    )
    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('reload exploded'))
    await typeSearch('') // → 重載第 1 頁，失敗 → 側欄橫幅
    await waitFor(() =>
      expect(screen.getByText('reload exploded')).toBeInTheDocument(),
    )

    await typeSearch('沒有這種群組')
    await waitFor(() => expect(screen.getByText('無符合群組')).toBeInTheDocument())

    // 整頁沒有被接管：sidebar 與搜尋框都還在，換個搜尋字就能繼續。
    expect(screen.queryByText('無法連線到 ARK Asset API')).toBeNull()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByLabelText('搜尋群組')).toBeInTheDocument()
    // 舊橫幅也不該留著：它講的是那份剛被搜尋結果換掉的清單。
    expect(screen.queryByText('reload exploded')).toBeNull()
  })

  it('a failed reload behind a zero-result search still keeps the sidebar', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('沒有這種群組') // → groups 變成 []
    await waitFor(() => expect(screen.getByText('無符合群組')).toBeInTheDocument())

    // 清空搜尋 → 全量重載，而這次第 1 頁就失敗（憑證過期 / 網路斷）：groups
    // 留在搜尋結果的 []，error 被設起來。
    vi.mocked(listAssetGroups).mockRejectedValue(new Error('page 1 exploded'))
    await typeSearch('')
    await waitFor(() =>
      expect(screen.getByText('page 1 exploded')).toBeInTheDocument(),
    )

    // 這個 tenant 有 1500 個群組（groupTotal 記著），「一筆都載不到」不等於
    // 「伺服器上沒有群組」—— 接管條件少了 groupTotal === 0 就會把側欄連同
    // 搜尋框一起卸載，使用者只剩重新整理一途。錯誤改以側欄橫幅呈現。
    expect(screen.queryByText('無法連線到 ARK Asset API')).toBeNull()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByLabelText('搜尋群組')).toBeInTheDocument()
    expect(
      within(screen.getByRole('complementary')).getByRole('alert'),
    ).toHaveTextContent('page 1 exploded')
  })

  it('a full reload still in flight cannot overwrite newer search results', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    // 先搜一次讓搜尋框非空 — 不然「清空」那一步的 change 事件值沒變，
    // React 根本不會觸發 onChange（測試會靜悄悄地什麼都沒驗到）。
    await typeSearch('567')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-567')).toBeInTheDocument(),
    )

    // 全量載入（清空搜尋觸發的那次）卡在第 1 頁不回來
    let releaseFullLoad: (() => void) | undefined
    vi.mocked(listAssetGroups).mockImplementation(async (filter, page) => {
      if (!filter?.name && page?.pageNumber === 1) {
        await new Promise<void>((r) => {
          releaseFullLoad = r
        })
      }
      return pagedFetch(filter, page)
    })

    await typeSearch('') // → refreshGroups()，卡住
    expect(releaseFullLoad).toBeDefined() // 卡住的那次真的起跑了
    await typeSearch('1234') // 使用者不等，直接再搜一次 — 這次很快就回來
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )

    await act(async () => {
      releaseFullLoad?.()
      await new Promise((r) => setTimeout(r, 0))
    })
    // 過期的全量清單不得蓋掉剛搜到的結果（否則使用者眼前的群組會憑空消失）
    expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-g-0')).not.toBeInTheDocument()
  })

  it('swapping in server-search results does NOT clear the manage-mode checks', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()

    await typeSearch('1234')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )
    // 伺服器端搜尋是「整批換一批可見清單」，不是「群組被刪」——
    // 搜尋前勾好的 g-0 必須留著（client 模式的過濾也是這個行為）。
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()

    // 跨搜尋累積多選：>1000 群組時，多選只能靠一次搜尋一個慢慢累積。
    fireEvent.click(screen.getByTestId('group-row-g-1234'))
    expect(
      screen.getByRole('button', { name: /刪除選取 \(2\)/ }),
    ).toBeInTheDocument()
  })

  it('a search that re-points the selected group drops the asset-level checks', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    // g-0 被自動選中 → 勾它的兩個素材，浮動列現形
    fireEvent.click(await screen.findByLabelText('選取 素材 g-0-1'))
    fireEvent.click(screen.getByLabelText('選取 素材 g-0-2'))
    expect(
      within(screen.getByRole('toolbar')).getByRole('button', {
        name: /刪除 2 個/,
      }),
    ).toBeInTheDocument()

    await typeSearch('1234')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )

    // 搜尋結果整批換掉清單，選取的 g-0 不在裡面 → store 改指 g-1234。素材層的
    // 勾選若留著，指的是已經看不見的 g-0 的素材，而確認 Modal 的縮圖與摘要是
    // 對著新群組的 displayedAssets 解析的：名單空白、只剩「刪除 2 個？不可逆」。
    expect(useAssetStore.getState().selectedGroupId).toBe('g-1234')
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('the group batch-delete list names groups checked in an earlier search', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))

    await typeSearch('1234')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByTestId('group-row-g-1234'))

    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(2\)/ }))
    const dialog = await screen.findByRole('dialog')
    // 伺服器模式下 groups 只剩這次搜尋的結果，先前勾到的 g-0 已不在裡面 ——
    // 只查 groups 解析名稱會讓名單退化成裸 id（「將刪除以下群組：g-0」）。
    // 級聯刪除（組內素材一併永久刪除）前的這份名單是最後一道防線。
    expect(dialog.textContent).toContain('群組 0')
    expect(dialog.textContent).toContain('群組 1234')
    expect(dialog.textContent).not.toContain('g-0')
  })

  it('flipping into server-search mode re-fires a query typed during the initial load', async () => {
    // 全量載入回來之前 groupTotal 還是 0 → serverSearchMode 為 false，這期間
    // 打的字會被呼叫端的 early-return 吞掉。模式翻真時前端過濾也同時關掉，
    // 於是「完整清單配著非空搜尋字」停在畫面上直到下一鍵。
    let releaseFullLoad!: () => void
    const gate = new Promise<void>((r) => {
      releaseFullLoad = r
    })
    vi.mocked(listAssetGroups).mockImplementation(async (filter, page) => {
      if (!filter?.name) await gate
      return pagedFetch(filter, page)
    })

    render(<AssetLibraryPage />)
    fireEvent.change(await screen.findByLabelText('搜尋群組'), {
      target: { value: '1234' },
    })
    expect(searchedFor('1234')).toBe(false) // 這一鍵被吞掉了

    await act(async () => {
      releaseFullLoad()
    })
    await waitFor(
      () => {
        expect(searchedFor('1234')).toBe(true)
        expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
    expect(screen.queryByTestId('group-row-g-0')).not.toBeInTheDocument()
  })

  // ── 搜尋顯示期間的無限捲動互斥（spec §5「搜尋中捲動」）──
  // 以下這組刻意跑「真頁面 + 真 sidebar」：捲動門檻、footer 三態與頁面的
  // 累積狀態機之間的接縫，正是 bug 住的地方，任一邊換成替身就測不到。

  it('scrolling while a search is displayed does not append the unfiltered next page', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群組 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )
    const callsAfterSearch = vi.mocked(listAssetGroups).mock.calls.length

    scrollNearBottom()
    await flush()

    // 沒有擋的話：搜尋結果（1 筆）配著「還有 1399 筆沒載」，捲到底就把未過濾
    // 的第 2 頁接上去 → 101 列、頁尾「已載入 101 / 1500」、搜尋框還寫著查詢字，
    // 而 disableClientFilter 讓前端過濾不會把多出來的列藏起來。再捲幾次，那筆
    // 搜尋結果還會在它真正的頁碼上重複回傳（seen 沒收過它）→ 重複 key。
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(callsAfterSearch)
    expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-g-100')).toBeNull()
    expect(screen.queryByTestId('group-row-g-0')).toBeNull()
  })

  it('a scroll inside the debounce window still loads more, and that page cannot land on the results', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    let releasePage2!: (v: Awaited<ReturnType<typeof pagedFetch>>) => void
    vi.mocked(listAssetGroups).mockImplementationOnce(
      () => new Promise((r) => (releasePage2 = r)),
    )

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('搜尋群組'), {
      target: { value: '群組 150' },
    })
    // debounce 還沒到期 → 畫面上仍是累積清單，這時捲到底就該照常接下一頁。
    // 逐鍵的 onQueryChange 若順手把「搜尋顯示中」立起來，使用者一邊打字一邊
    // 捲動就會發現清單不動了（而且要等 debounce 過後才恢復）。
    scrollNearBottom()
    expect(releasePage2).toBeDefined()

    await act(async () => {
      vi.advanceTimersByTime(320) // debounce 到期 → 搜尋接管清單
    })
    vi.useRealTimers()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    // 卡住的第 2 頁這時才回來。seq 已被搜尋 bump 過 —— 它必須整份作廢，
    // 否則 100 筆未過濾的群組會接在 1 筆搜尋結果後面。
    await act(async () => {
      releasePage2(await pagedFetch({}, { pageNumber: 2, pageSize: 100 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-g-100')).toBeNull()
  })

  it('the footer goes quiet while a search is displayed', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())
    // 累積清單顯示中：進度列如常
    expect(screen.getByText('已載入 100 / 1500')).toBeInTheDocument()

    await typeSearch('群組 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    // 「已載入 1 / 1500」是把搜尋命中數當成累積進度來報 —— 累積其實還停在
    // 100 筆，而使用者讀到的是「1500 個群組只載到 1 個」。
    expect(screen.queryByText(/^已載入/)).toBeNull()
    expect(sidebar().querySelector('.spinner')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '載入更多失敗，點擊重試' }),
    ).toBeNull()
  })

  it('a pre-search load-more failure does not leave its retry row under the results', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('page 2 exploded'))
    scrollNearBottom()
    expect(
      await screen.findByRole('button', { name: '載入更多失敗，點擊重試' }),
    ).toBeInTheDocument()

    await typeSearch('群組 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )
    // 那條錯誤講的是一份已經被搜尋結果換掉的清單。留著的話重試列會掛在搜尋
    // 結果底下，點下去就是把未過濾的第 2 頁接上來。
    expect(
      screen.queryByRole('button', { name: '載入更多失敗，點擊重試' }),
    ).toBeNull()
  })

  it('scrolling appends the next page and counts the footer up', async () => {
    // 端到端的正常路徑（真頁面 + 真 sidebar）：捲動 → 第 2 頁 → 進度前進。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())
    expect(screen.getByText('已載入 100 / 1500')).toBeInTheDocument()

    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    expect(screen.getByText('已載入 200 / 1500')).toBeInTheDocument()
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument() // append 不是 replace
  })

  it('clearing the query reloads page 1 and restarts the accumulation', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    scrollNearBottom() // 累積到 200 筆，下一頁是第 3 頁
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )

    await typeSearch('群組 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    await typeSearch('')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 1, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    // 累積真的重來：畫面回到第 1 頁，進度列跟著回到 100
    expect(screen.queryByTestId('group-row-g-199')).toBeNull()
    expect(screen.getByText('已載入 100 / 1500')).toBeInTheDocument()

    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )
    // nextPageNumber 也回到 2 —— 沒重置的話這一發會去抓第 3 頁，g-100..199
    // 整頁被跳過（而 hasMore 仍為 true，使用者再也捲不回那一段）。
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    // seen 是「重建」而非「併入」：重載後那一頁的每個 id 都要能重新進來
    //（併入的話 g-100..199 全被當成看過的而濾掉），而搜尋期間現身過的
    // g-150 也只該有一列（搜尋路徑從沒餵過 seen）。
    expect(screen.getAllByTestId('group-row-g-150')).toHaveLength(1)
    expect(screen.getAllByTestId('group-row-g-100')).toHaveLength(1)
  })

  // ── 批刪收尾（spec §4.2 / 前作 §8 債 #1）──

  it('a batch delete finished during a search re-runs that query', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群組 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    await batchDeleteRow('group-row-g-150')

    expect(vi.mocked(deleteAssetGroup)).toHaveBeenCalledWith('g-150')
    // 收尾若走重載第 1 頁，剛在搜尋結果裡刪完的使用者會被丟回清單開頭，
    // 同一輪還沒刪完的項目要重打一次搜尋字才找得回來。
    expect(vi.mocked(listAssetGroups).mock.calls.at(-1)?.[0]).toEqual({
      name: '群組 150',
    })
  })

  it('a batch delete finished with no active query reloads page 1', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await batchDeleteRow('group-row-g-0')

    expect(vi.mocked(deleteAssetGroup)).toHaveBeenCalledWith('g-0')
    expect(vi.mocked(listAssetGroups).mock.calls.at(-1)).toEqual([
      {},
      { pageNumber: 1, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    ])
  })

  // ── activeGroupQuery 的非同步安全性（code review 發現的競態）──

  it('a failed search leaves the accumulated list scrollable — the flag restores instead of sticking', async () => {
    // 搜尋失敗時 groups 沒被換掉（還是累積清單），旗標若停在剛剛樂觀寫入的
    // 查詢字，footer 會無聲消失、捲動被凍結，直到使用者再動一次搜尋框 ——
    // 而搜尋最容易失敗的正是流控帳戶，這時使用者連原本能用的累積清單都動不了。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())
    expect(screen.getByText('已載入 100 / 1500')).toBeInTheDocument()

    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('flow limit'))
    const callsBeforeSearch = vi.mocked(listAssetGroups).mock.calls.length
    await typeSearch('群組 777')
    await waitFor(() =>
      expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(
        callsBeforeSearch + 1,
      ),
    )
    // 清單沒被換掉：還是累積的第 1 頁，搜尋框仍顯示查詢字。
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument()
    expect(screen.getByLabelText('搜尋群組')).toHaveValue('群組 777')
    // footer 回來了（旗標已還原成 null），捲動照常可用 —— 不是卡死在
    // 「畫面是累積清單，旗標卻說是搜尋結果」。
    expect(screen.getByText('已載入 100 / 1500')).toBeInTheDocument()

    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
  })

  it('a failed reload behind a cleared search still blocks scroll from appending an unfiltered page', async () => {
    // 釘住「旗標只在 refreshGroups 成功分支才清」這個放置位置：清空搜尋後的
    // 重載若失敗，groups 仍是搜尋結果（這裡 1 筆 g-150）。旗標這時如果被
    // 清成 null（例如挪到函式開頭），接下來的捲動就會把未過濾的下一頁接到
    // 這一筆搜尋結果後面 —— 跟 C1 是同一個洞，只是換一個進入點。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群組 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('reload exploded'))
    const callsBeforeClear = vi.mocked(listAssetGroups).mock.calls.length
    await typeSearch('') // → refreshGroups()，失敗
    await waitFor(() =>
      expect(screen.getByText('reload exploded')).toBeInTheDocument(),
    )
    const callsAfterFailedReload = vi.mocked(listAssetGroups).mock.calls.length
    expect(callsAfterFailedReload).toBe(callsBeforeClear + 1) // 只有那次失敗的重載

    scrollNearBottom()
    await flush()

    // 沒有多打一個未過濾的下一頁請求，搜尋結果那一列還在，累積清單的列
    // （例如 g-100）沒有混進來。
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(
      callsAfterFailedReload,
    )
    expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-g-100')).toBeNull()
  })

  it('a batch delete finished after the search changed mid-run requeries what is on screen at finish, not at start', async () => {
    // runGroupBatchDelete 是一般函式，呼叫當下就把那個 render 的 closure
    // 定住了；批刪跑好幾秒（QPS 4），期間讀 state 只會拿到「批刪開始那一刻」
    // 的搜尋字。這裡中途換一次搜尋字，收尾若讀 state 就會重跑舊查詢
    // （群組 150），搜尋框卻已經寫著新查詢字（群組 42）—— 畫面對不上。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群組 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    // deleteAssetGroup 卡住，撐出批刪「還在跑」的窗口。
    let releaseDelete!: () => void
    vi.mocked(deleteAssetGroup).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          releaseDelete = r
        }),
    )

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-150'))
    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(1\)/ }))
    fireEvent.change(await screen.findByPlaceholderText('輸入「刪除」以確認'), {
      target: { value: '刪除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    await waitFor(() => expect(releaseDelete).toBeDefined())

    // 刪除卡在半路 —— 中途換一次搜尋字，這次很快就回來。
    await typeSearch('群組 42')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-42')).toBeInTheDocument(),
    )

    const callsBeforeFinish = vi.mocked(listAssetGroups).mock.calls.length
    await act(async () => {
      releaseDelete()
      await new Promise((r) => setTimeout(r, 0))
    })
    await waitFor(() =>
      expect(vi.mocked(listAssetGroups).mock.calls.length).toBeGreaterThan(
        callsBeforeFinish,
      ),
    )

    // 收尾讀到的是「現在顯示的查詢」（群組 42），不是批刪開始那一刻的
    // 「群組 150」——搜尋框與清單必須一致。
    expect(vi.mocked(listAssetGroups).mock.calls.at(-1)?.[0]).toEqual({
      name: '群組 42',
    })
    expect(screen.getByLabelText('搜尋群組')).toHaveValue('群組 42')
    expect(screen.getByTestId('group-row-g-42')).toBeInTheDocument()
  })

  // ── 整份清單重載（refreshGroups/runGroupSearch）與 load-more 的搶跑 ──
  // （final branch review 發現：兩者共用 refreshSeq，但 seq 只能偵測「已經
  // bump 過的」過期請求，擋不住「重載才剛起跑、都還沒 bump 完，load-more 就
  // 在同一輪搶跑」這個窗口——這時兩者持有同一個 seq，各自的 seq 檢查都會
  // 通過。守門是 `listReloadDepth`，跟 seq 是兩件事，這裡單獨測。）

  it('a full reload still in flight blocks load-more from starting (no silently-skipped page)', async () => {
    // 刻意不用搜尋觸發重載：清空搜尋觸發的 refreshGroups() 在途時
    // activeGroupQuery 仍非 null（要等它成功才會清），sidebar 收到的 hasMore
    // 早就被那道既有防線擋成 false，捲動連 onLoadMore 都不會發，測不到這裡
    // 要測的東西。建立群組（handleCreateGroup → refreshGroups()）從頭到尾
    // 不碰 activeGroupQuery，才能單獨隔離出 `listReloadDepth` 這道新防線。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    // 累積到 200 筆，下一頁是第 3 頁。
    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )

    // 建立群組觸發的 refreshGroups() 卡住不回來。
    let releaseFullLoad: (() => void) | undefined
    vi.mocked(listAssetGroups).mockImplementation(async (filter, page) => {
      if (!filter?.name && page?.pageNumber === 1) {
        await new Promise<void>((r) => {
          releaseFullLoad = r
        })
      }
      return pagedFetch(filter, page)
    })

    fireEvent.click(screen.getByRole('button', { name: '建立新 Group' }))
    fireEvent.change(screen.getByPlaceholderText('群組名稱'), {
      target: { value: '測試群組' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => expect(vi.mocked(createAssetGroup)).toHaveBeenCalled())
    await waitFor(() => expect(releaseFullLoad).toBeDefined())

    // 重載還在途時捲動：沒有防護的話，這裡會用「重載前」殘留的 nextPageNumber
    // （4）去抓一頁，等重載完成、把清單換回第 1 頁之後才回來 append —— 於是
    // 第 2、3 頁憑空消失，捲動接上一段跟畫面上第 1 頁不連續的資料。
    const callsBeforeScroll = vi.mocked(listAssetGroups).mock.calls.length
    scrollNearBottom()
    await flush()
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(callsBeforeScroll) // 沒有多打一個請求

    await act(async () => {
      releaseFullLoad?.()
      await new Promise((r) => setTimeout(r, 0))
    })
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('group-row-g-199')).toBeNull() // 重載真的重置了累積

    // 重載結束後才捲動：現在應該正常接上第 2 頁（不是被卡住時殘留的第 4 頁）。
    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
  })
})
