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

/** 遠多于初载的 1 页（100 笔）→ `已加载 < TotalCount` 成立 → 服务器端搜索模式。 */
const TOTAL = 1500

function fakeGroup(i: number): AssetGroup {
  return {
    id: `g-${i}`, name: `群组 ${i}`, groupType: 'AIGC',
    projectName: 'default', createTime: '', updateTime: '',
  }
}
const ALL = Array.from({ length: TOTAL }, (_, i) => fakeGroup(i))

/** 每个群组给 2 个 Active 素材 — 「勾了素材再搜索」的劫持路径要有东西可勾。 */
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

/** 假服务器：Name 子字符串过滤 + 分页，TotalCount 回报过滤后的总数。 */
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

/** 有没有打过「Name = q」的服务器端搜索。 */
function searchedFor(q: string): boolean {
  return vi
    .mocked(listAssetGroups)
    .mock.calls.some(([f]) => (f as { name?: string } | undefined)?.name === q)
}

/** 输入搜索字并跨过 300ms debounce。 */
async function typeSearch(q: string) {
  vi.useFakeTimers()
  fireEvent.change(screen.getByLabelText('搜索群组'), { target: { value: q } })
  await act(async () => {
    vi.advanceTimersByTime(320)
  })
  vi.useRealTimers()
}

/** 滚动容器 = sidebar 的 `aside`（唯一 overflowY:auto 的层）。 */
const sidebar = () => screen.getByRole('complementary')

/**
 * 滚到距底 100px（< 200 閾值）。jsdom 不做版面，三个几何属性恒为 0 ——
 * `0 - 0 - 0 < 200` 会让每个 scroll 事件都看起来像「到底了」，所以全部自己
 * 定义，测到的才是「滚近底部」而不是 jsdom 的默认。
 */
function scrollNearBottom() {
  const el = sidebar()
  const geometry = { scrollHeight: 1000, clientHeight: 400, scrollTop: 500 }
  for (const [prop, value] of Object.entries(geometry)) {
    Object.defineProperty(el, prop, { value, configurable: true, writable: true })
  }
  fireEvent.scroll(el)
}

/** 让 scroll 之后可能发生的请求有机会跑完（没有请求时就是一次空转）。 */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 在 sidebar 底部加载列上点「管理」→ 勾一列 → 走完 typed-confirm 批删。 */
async function batchDeleteRow(testId: string) {
  fireEvent.click(screen.getByRole('button', { name: '管理' }))
  fireEvent.click(screen.getByTestId(testId))
  fireEvent.click(screen.getByRole('button', { name: /删除选择 \(1\)/ }))
  fireEvent.change(await screen.findByPlaceholderText('输入「删除」以确认'), {
    target: { value: '删除' },
  })
  const listCallsBefore = vi.mocked(listAssetGroups).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
  // 收尾的讯号是批次结束后的那次群组清单请求（重跑查询或重载第 1 页）。
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
    fireEvent.change(screen.getByLabelText('搜索群组'), { target: { value: '1234' } })
    expect(searchedFor('1234')).toBe(false) // debounce 300ms 内不打服务器
    await act(async () => {
      vi.advanceTimersByTime(320)
    })
    vi.useRealTimers()

    await waitFor(() => {
      expect(searchedFor('1234')).toBe(true)
      // 全量清单抓不到的第 1234 个群组，靠服务器端搜索现身
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

  it('zero server-side matches show 没有匹配的群组, not the empty-tenant CTA', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('没有这种群组')
    await waitFor(() => expect(screen.getByText('没有匹配的群组')).toBeInTheDocument())
    // groups 被设成 [] 不代表这个 tenant 没有群组 —— 有 1500 个，只是搜不到。
    expect(screen.queryByText('创建第一个群组')).not.toBeInTheDocument()
    // 「没有匹配的群组」配上「已加载 0 / 1500」是自相矛盾的一对：一个说搜不到，
    // 另一个说清单载到一半。搜索显示中没有累積进度可言 —— footer 静音。
    expect(screen.queryByText(/^已加载/)).toBeNull()
  })

  it('a stale error banner + a zero-result search must not take over the page', async () => {
    // 审查者重现的链：手上留着一条错误（groups 非空，所以还没接管）→ 用户
    // 搜到零笔 → setGroups([]) →「error && groups 空」成立 → 整页翻成凭证诊断
    // 画面，sidebar 连同搜索框一起被卸载。用户连改个搜索字自救都做不到，
    // 唯一出路是刷新。
    //（错误来源原本是全量走訪的第 2 页失败；走訪删除后改由「清空搜索触发的
    //  重载第 1 页失败」制造同一个状态 —— 钉的是接管判断，不是错误的出处。）
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('567')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-567')).toBeInTheDocument(),
    )
    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('reload exploded'))
    await typeSearch('') // → 重载第 1 页，失败 → 侧栏横幅
    await waitFor(() =>
      expect(screen.getByText('reload exploded')).toBeInTheDocument(),
    )

    await typeSearch('没有这种群组')
    await waitFor(() => expect(screen.getByText('没有匹配的群组')).toBeInTheDocument())

    // 整页没有被接管：sidebar 与搜索框都还在，换个搜索字就能继续。
    expect(screen.queryByText('无法连接到素材库 API')).toBeNull()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByLabelText('搜索群组')).toBeInTheDocument()
    // 旧横幅也不该留着：它讲的是那份刚被搜索结果换掉的清单。
    expect(screen.queryByText('reload exploded')).toBeNull()
  })

  it('a failed reload behind a zero-result search still keeps the sidebar', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('没有这种群组') // → groups 变成 []
    await waitFor(() => expect(screen.getByText('没有匹配的群组')).toBeInTheDocument())

    // 清空搜索 → 全量重载，而这次第 1 页就失败（凭证过期 / 网路断）：groups
    // 留在搜索结果的 []，error 被设起来。
    vi.mocked(listAssetGroups).mockRejectedValue(new Error('page 1 exploded'))
    await typeSearch('')
    await waitFor(() =>
      expect(screen.getByText('page 1 exploded')).toBeInTheDocument(),
    )

    // 这个 tenant 有 1500 个群组（groupTotal 记著），「一笔都载不到」不等于
    // 「服务器上没有群组」—— 接管条件少了 groupTotal === 0 就会把侧栏连同
    // 搜索框一起卸载，用户只剩刷新一途。错误改以侧栏横幅呈现。
    expect(screen.queryByText('无法连接到素材库 API')).toBeNull()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByLabelText('搜索群组')).toBeInTheDocument()
    expect(
      within(screen.getByRole('complementary')).getByRole('alert'),
    ).toHaveTextContent('page 1 exploded')
  })

  it('a full reload still in flight cannot overwrite newer search results', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    // 先搜一次让搜索框非空 — 不然「清空」那一步的 change 事件值没变，
    // React 根本不会触发 onChange（测试会静悄悄地什么都没验到）。
    await typeSearch('567')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-567')).toBeInTheDocument(),
    )

    // 全量加载（清空搜索触发的那次）卡在第 1 页不回来
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
    await typeSearch('1234') // 用户不等，直接再搜一次 — 这次很快就回来
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )

    await act(async () => {
      releaseFullLoad?.()
      await new Promise((r) => setTimeout(r, 0))
    })
    // 过期的全量清单不得盖掉刚搜到的结果（否则用户眼前的群组会凭空消失）
    expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-g-0')).not.toBeInTheDocument()
  })

  it('swapping in server-search results does NOT clear the manage-mode checks', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()

    await typeSearch('1234')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )
    // 服务器端搜索是「整批换一批可见清单」，不是「群组被删」——
    // 搜索前勾好的 g-0 必须留着（client 模式的过滤也是这个行为）。
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()

    // 跨搜索累積多选：>1000 群组时，多选只能靠一次搜索一个慢慢累積。
    fireEvent.click(screen.getByTestId('group-row-g-1234'))
    expect(
      screen.getByRole('button', { name: /删除选择 \(2\)/ }),
    ).toBeInTheDocument()
  })

  it('a search that re-points the selected group drops the asset-level checks', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    // g-0 被自动选中 → 勾它的两个素材，浮动列现形
    fireEvent.click(await screen.findByLabelText('选择 素材 g-0-1'))
    fireEvent.click(screen.getByLabelText('选择 素材 g-0-2'))
    expect(
      within(screen.getByRole('toolbar')).getByRole('button', {
        name: /删除 2 个/,
      }),
    ).toBeInTheDocument()

    await typeSearch('1234')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-1234')).toBeInTheDocument(),
    )

    // 搜索结果整批换掉清单，选择的 g-0 不在里面 → store 改指 g-1234。素材层的
    // 勾选若留着，指的是已经看不见的 g-0 的素材，而确认 Modal 的缩图与摘要是
    // 对著新群组的 displayedAssets 解析的：名单空白、只剩「删除 2 个？不可逆」。
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

    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(2\)/ }))
    const dialog = await screen.findByRole('dialog')
    // 服务器模式下 groups 只剩这次搜索的结果，先前勾到的 g-0 已不在里面 ——
    // 只查 groups 解析名称会让名单退化成裸 id（「将删除以下群组：g-0」）。
    // 级联删除（组内素材一并永久删除）前的这份名单是最后一道防线。
    expect(dialog.textContent).toContain('群组 0')
    expect(dialog.textContent).toContain('群组 1234')
    expect(dialog.textContent).not.toContain('g-0')
  })

  it('flipping into server-search mode re-fires a query typed during the initial load', async () => {
    // 全量加载回来之前 groupTotal 还是 0 → serverSearchMode 为 false，这期间
    // 打的字会被呼叫端的 early-return 吞掉。模式翻真时前端过滤也同时关掉，
    // 于是「完整清单配著非空搜索字」停在画面上直到下一键。
    let releaseFullLoad!: () => void
    const gate = new Promise<void>((r) => {
      releaseFullLoad = r
    })
    vi.mocked(listAssetGroups).mockImplementation(async (filter, page) => {
      if (!filter?.name) await gate
      return pagedFetch(filter, page)
    })

    render(<AssetLibraryPage />)
    fireEvent.change(await screen.findByLabelText('搜索群组'), {
      target: { value: '1234' },
    })
    expect(searchedFor('1234')).toBe(false) // 这一键被吞掉了

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

  // ── 搜索显示期间的无限滚动互斥（spec §5「搜索中滚动」）──
  // 以下这组刻意跑「真页面 + 真 sidebar」：滚动门槛、footer 三态与页面的
  // 累積状态机之间的接缝，正是 bug 住的地方，任一边换成替身就测不到。

  it('scrolling while a search is displayed does not append the unfiltered next page', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群组 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )
    const callsAfterSearch = vi.mocked(listAssetGroups).mock.calls.length

    scrollNearBottom()
    await flush()

    // 没有挡的话：搜索结果（1 笔）配著「还有 1399 笔没载」，滚到底就把未过滤
    // 的第 2 页接上去 → 101 列、页尾「已加载 101 / 1500」、搜索框还写著查询字，
    // 而 disableClientFilter 让前端过滤不会把多出来的列藏起来。再滚几次，那笔
    // 搜索结果还会在它真正的页码上重复回传（seen 没收过它）→ 重复 key。
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
    fireEvent.change(screen.getByLabelText('搜索群组'), {
      target: { value: '群组 150' },
    })
    // debounce 还没到期 → 画面上仍是累積清单，这时滚到底就该照常接下一页。
    // 逐键的 onQueryChange 若顺手把「搜索显示中」立起来，用户一边打字一边
    // 滚动就会发现清单不动了（而且要等 debounce 过后才恢复）。
    scrollNearBottom()
    expect(releasePage2).toBeDefined()

    await act(async () => {
      vi.advanceTimersByTime(320) // debounce 到期 → 搜索接管清单
    })
    vi.useRealTimers()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    // 卡住的第 2 页这时才回来。seq 已被搜索 bump 过 —— 它必须整份作废，
    // 否则 100 笔未过滤的群组会接在 1 笔搜索结果后面。
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
    // 累積清单显示中：进度列如常
    expect(screen.getByText('已加载 100 / 1500')).toBeInTheDocument()

    await typeSearch('群组 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    // 「已加载 1 / 1500」是把搜索命中数当成累積进度来报 —— 累積其实还停在
    // 100 笔，而用户读到的是「1500 个群组只载到 1 个」。
    expect(screen.queryByText(/^已加载/)).toBeNull()
    expect(sidebar().querySelector('.spinner')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '加载更多失败，点击重试' }),
    ).toBeNull()
  })

  it('a pre-search load-more failure does not leave its retry row under the results', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('page 2 exploded'))
    scrollNearBottom()
    expect(
      await screen.findByRole('button', { name: '加载更多失败，点击重试' }),
    ).toBeInTheDocument()

    await typeSearch('群组 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )
    // 那条错误讲的是一份已经被搜索结果换掉的清单。留着的话重试列会挂在搜索
    // 结果底下，点下去就是把未过滤的第 2 页接上来。
    expect(
      screen.queryByRole('button', { name: '加载更多失败，点击重试' }),
    ).toBeNull()
  })

  it('scrolling appends the next page and counts the footer up', async () => {
    // 端到端的正常路径（真页面 + 真 sidebar）：滚动 → 第 2 页 → 进度前进。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())
    expect(screen.getByText('已加载 100 / 1500')).toBeInTheDocument()

    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    expect(screen.getByText('已加载 200 / 1500')).toBeInTheDocument()
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument() // append 不是 replace
  })

  it('clearing the query reloads page 1 and restarts the accumulation', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    scrollNearBottom() // 累積到 200 笔，下一页是第 3 页
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )

    await typeSearch('群组 150')
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
    // 累積真的重来：画面回到第 1 页，进度列跟著回到 100
    expect(screen.queryByTestId('group-row-g-199')).toBeNull()
    expect(screen.getByText('已加载 100 / 1500')).toBeInTheDocument()

    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )
    // nextPageNumber 也回到 2 —— 没重置的话这一发会去抓第 3 页，g-100..199
    // 整页被跳过（而 hasMore 仍为 true，用户再也滚不回那一段）。
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
    // seen 是「重建」而非「并入」：重载后那一页的每个 id 都要能重新进来
    //（并入的话 g-100..199 全被当成看过的而滤掉），而搜索期间现身过的
    // g-150 也只该有一列（搜索路径从没喂过 seen）。
    expect(screen.getAllByTestId('group-row-g-150')).toHaveLength(1)
    expect(screen.getAllByTestId('group-row-g-100')).toHaveLength(1)
  })

  // ── 批删收尾（spec §4.2 / 前作 §8 债 #1）──

  it('a batch delete finished during a search re-runs that query', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群组 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    await batchDeleteRow('group-row-g-150')

    expect(vi.mocked(deleteAssetGroup)).toHaveBeenCalledWith('g-150')
    // 收尾若走重载第 1 页，刚在搜索结果里删完的用户会被丢回清单开头，
    // 同一轮还没删完的项目要重打一次搜索字才找得回来。
    expect(vi.mocked(listAssetGroups).mock.calls.at(-1)?.[0]).toEqual({
      name: '群组 150',
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

  // ── activeGroupQuery 的非同步安全性（code review 发现的竞态）──

  it('a failed search leaves the accumulated list scrollable — the flag restores instead of sticking', async () => {
    // 搜索失败时 groups 没被换掉（还是累積清单），旗标若停在刚刚乐观写入的
    // 查询字，footer 会无声消失、滚动被凍结，直到用户再动一次搜索框 ——
    // 而搜索最容易失败的正是流控账户，这时用户连原本能用的累積清单都动不了。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())
    expect(screen.getByText('已加载 100 / 1500')).toBeInTheDocument()

    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('flow limit'))
    const callsBeforeSearch = vi.mocked(listAssetGroups).mock.calls.length
    await typeSearch('群组 777')
    await waitFor(() =>
      expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(
        callsBeforeSearch + 1,
      ),
    )
    // 清单没被换掉：还是累積的第 1 页，搜索框仍显示查询字。
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument()
    expect(screen.getByLabelText('搜索群组')).toHaveValue('群组 777')
    // footer 回来了（旗标已还原成 null），滚动照常可用 —— 不是卡死在
    // 「画面是累積清单，旗标卻说是搜索结果」。
    expect(screen.getByText('已加载 100 / 1500')).toBeInTheDocument()

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
    // 钉住「旗标只在 refreshGroups 成功分支才清」这个放置位置：清空搜索后的
    // 重载若失败，groups 仍是搜索结果（这里 1 笔 g-150）。旗标这时如果被
    // 清成 null（例如挪到函数开头），接下来的滚动就会把未过滤的下一页接到
    // 这一笔搜索结果后面 —— 跟 C1 是同一个洞，只是换一个进入点。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群组 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    vi.mocked(listAssetGroups).mockRejectedValueOnce(new Error('reload exploded'))
    const callsBeforeClear = vi.mocked(listAssetGroups).mock.calls.length
    await typeSearch('') // → refreshGroups()，失败
    await waitFor(() =>
      expect(screen.getByText('reload exploded')).toBeInTheDocument(),
    )
    const callsAfterFailedReload = vi.mocked(listAssetGroups).mock.calls.length
    expect(callsAfterFailedReload).toBe(callsBeforeClear + 1) // 只有那次失败的重载

    scrollNearBottom()
    await flush()

    // 没有多打一个未过滤的下一页请求，搜索结果那一列还在，累積清单的列
    // （例如 g-100）没有混进来。
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(
      callsAfterFailedReload,
    )
    expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-g-100')).toBeNull()
  })

  it('a batch delete finished after the search changed mid-run requeries what is on screen at finish, not at start', async () => {
    // runGroupBatchDelete 是一般函数，呼叫当下就把那个 render 的 closure
    // 定住了；批删跑好几秒（QPS 4），期间读 state 只会拿到「批删开始那一刻」
    // 的搜索字。这里中途换一次搜索字，收尾若读 state 就会重跑旧查询
    // （群组 150），搜索框卻已经写著新查询字（群组 42）—— 画面对不上。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    await typeSearch('群组 150')
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-150')).toBeInTheDocument(),
    )

    // deleteAssetGroup 卡住，撐出批删「还在跑」的窗口。
    let releaseDelete!: () => void
    vi.mocked(deleteAssetGroup).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          releaseDelete = r
        }),
    )

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-150'))
    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(1\)/ }))
    fireEvent.change(await screen.findByPlaceholderText('输入「删除」以确认'), {
      target: { value: '删除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    await waitFor(() => expect(releaseDelete).toBeDefined())

    // 删除卡在半路 —— 中途换一次搜索字，这次很快就回来。
    await typeSearch('群组 42')
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

    // 收尾读到的是「现在显示的查询」（群组 42），不是批删开始那一刻的
    // 「群组 150」——搜索框与清单必须一致。
    expect(vi.mocked(listAssetGroups).mock.calls.at(-1)?.[0]).toEqual({
      name: '群组 42',
    })
    expect(screen.getByLabelText('搜索群组')).toHaveValue('群组 42')
    expect(screen.getByTestId('group-row-g-42')).toBeInTheDocument()
  })

  // ── 整份清单重载（refreshGroups/runGroupSearch）与 load-more 的搶跑 ──
  // （final branch review 发现：两者共用 refreshSeq，但 seq 只能侦测「已经
  // bump 过的」过期请求，挡不住「重载才刚起跑、都还没 bump 完，load-more 就
  // 在同一轮搶跑」这个窗口——这时两者持有同一个 seq，各自的 seq 检查都会
  // 通过。守门是 `listReloadDepth`，跟 seq 是两件事，这里单独测。）

  it('a full reload still in flight blocks load-more from starting (no silently-skipped page)', async () => {
    // 刻意不用搜索触发重载：清空搜索触发的 refreshGroups() 在途时
    // activeGroupQuery 仍非 null（要等它成功才会清），sidebar 收到的 hasMore
    // 早就被那道既有防线挡成 false，滚动连 onLoadMore 都不会发，测不到这里
    // 要测的东西。创建群组（handleCreateGroup → refreshGroups()）从头到尾
    // 不碰 activeGroupQuery，才能单独隔离出 `listReloadDepth` 这道新防线。
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())

    // 累積到 200 笔，下一页是第 3 页。
    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )

    // 创建群组触发的 refreshGroups() 卡住不回来。
    let releaseFullLoad: (() => void) | undefined
    vi.mocked(listAssetGroups).mockImplementation(async (filter, page) => {
      if (!filter?.name && page?.pageNumber === 1) {
        await new Promise<void>((r) => {
          releaseFullLoad = r
        })
      }
      return pagedFetch(filter, page)
    })

    fireEvent.click(screen.getByRole('button', { name: '创建新群组' }))
    fireEvent.change(screen.getByPlaceholderText('群组名称'), {
      target: { value: '测试群组' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(vi.mocked(createAssetGroup)).toHaveBeenCalled())
    await waitFor(() => expect(releaseFullLoad).toBeDefined())

    // 重载还在途时滚动：没有防护的话，这里会用「重载前」残留的 nextPageNumber
    // （4）去抓一页，等重载完成、把清单换回第 1 页之后才回来 append —— 于是
    // 第 2、3 页凭空消失，滚动接上一段跟画面上第 1 页不连续的数据。
    const callsBeforeScroll = vi.mocked(listAssetGroups).mock.calls.length
    scrollNearBottom()
    await flush()
    expect(vi.mocked(listAssetGroups).mock.calls.length).toBe(callsBeforeScroll) // 没有多打一个请求

    await act(async () => {
      releaseFullLoad?.()
      await new Promise((r) => setTimeout(r, 0))
    })
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('group-row-g-199')).toBeNull() // 重载真的重置了累積

    // 重载结束后才滚动：现在应该正常接上第 2 页（不是被卡住时残留的第 4 页）。
    scrollNearBottom()
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-199')).toBeInTheDocument(),
    )
    expect(vi.mocked(listAssetGroups)).toHaveBeenLastCalledWith(
      {},
      { pageNumber: 2, pageSize: 100 },
      { sortBy: 'CreateTime', sortOrder: 'Desc' },
    )
  }, 10000)
})
