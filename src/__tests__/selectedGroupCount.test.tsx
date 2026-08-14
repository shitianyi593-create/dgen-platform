import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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

/** 三个群组一页载完 —— 无限滚动与服务器搜索在这个文件里都不该现身。 */
const GROUPS: AssetGroup[] = [0, 1, 2].map((i) => ({
  id: `g-${i}`,
  name: `群组 ${i}`,
  groupType: 'AIGC',
  projectName: 'default',
  createTime: '',
  updateTime: '',
}))

/**
 * 服务器端的群组总数。刻意与 `listAssets` 回的笔数（2）不同：标题若读的是
 * 「载进来的那一页」（assets.length / chipCounts.all）就会显示 2，断言 42
 * 才能钉住它读的是 `groupCounts`。真实情境里的差距更大 —— 一页上限 100，
 * 大群组的标题会永远停在 100。
 */
const COUNTS: Record<string, number> = { 'g-0': 42, 'g-1': 7, 'g-2': 0 }

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

async function listGroupsImpl(
  _filter?: unknown,
  page: { pageNumber: number; pageSize: number } = { pageNumber: 1, pageSize: 100 },
): Promise<{ items: AssetGroup[]; page: PageInfo }> {
  return { items: GROUPS, page: { ...page, totalCount: GROUPS.length } }
}

async function listAssetsImpl(filter?: { groupId?: string }) {
  const items = filter?.groupId ? fakeAssets(filter.groupId) : []
  return {
    items,
    page: { pageNumber: 1, pageSize: 100, totalCount: items.length },
  }
}

async function countImpl(groupId: string): Promise<number> {
  return COUNTS[groupId] ?? 0
}

vi.mock('../api/asset', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/asset')>()
  return {
    ...orig,
    // Deferred calls into the impls: the factory runs before this module's
    // top-level bindings are initialised.
    listAssetGroups: vi.fn((...args: Parameters<typeof listGroupsImpl>) =>
      listGroupsImpl(...args),
    ),
    listAssets: vi.fn((...args: Parameters<typeof listAssetsImpl>) =>
      listAssetsImpl(...args),
    ),
    countAssetsInGroup: vi.fn((...args: Parameters<typeof countImpl>) =>
      countImpl(...args),
    ),
  }
})
import { countAssetsInGroup, listAssetGroups, listAssets } from '../api/asset'

/** 初载完成 = 侧栏第一列畫出来了（此时 g-0 已被自动选中）。 */
async function mountAndSettle() {
  render(<AssetLibraryPage />)
  await waitFor(() =>
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
  )
}

/** `countAssetsInGroup` 被呼叫过的 groupId，依序。 */
function countedIds(): string[] {
  return vi.mocked(countAssetsInGroup).mock.calls.map(([id]) => id)
}

describe('selected-group asset count in the header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps implementations, but re-arm them anyway so a
    // mockImplementationOnce-per-test can't leak into its neighbours.
    vi.mocked(listAssetGroups).mockImplementation(
      (...args: Parameters<typeof listGroupsImpl>) => listGroupsImpl(...args),
    )
    vi.mocked(listAssets).mockImplementation(
      (...args: Parameters<typeof listAssetsImpl>) => listAssetsImpl(...args),
    )
    vi.mocked(countAssetsInGroup).mockImplementation(
      (...args: Parameters<typeof countImpl>) => countImpl(...args),
    )
    useAssetStore.setState(useAssetStore.getInitialState())
    useAuthStore.setState({
      assetCreds: { accessKeyId: 'ak', accessKeySecret: 'sk', projectName: 'default' },
    })
  })

  it('fires exactly one count for the auto-selected group and shows it in the header', async () => {
    await mountAndSettle()
    expect(await screen.findByText('42 个素材')).toBeInTheDocument()
    // 一次选择 = 一发。扇出（每个群组一发）正是 Task 2 删掉的那个病灶，
    // 这里守住它没有从标题这条路溜回来。
    expect(countedIds()).toEqual(['g-0'])
    // 42 而不是 2：标题读的是服务器总数，不是这一页载进来的素材数。
    expect(screen.queryByText('2 个素材')).toBeNull()
  })

  it("shows '—' until the count resolves", async () => {
    let resolveCount!: (n: number) => void
    vi.mocked(countAssetsInGroup).mockImplementationOnce(
      () => new Promise<number>((r) => (resolveCount = r)),
    )

    await mountAndSettle()
    // 群组名已在标题上，count 还在途 —— 不能先假装 0。
    expect(await screen.findByText('— 个素材')).toBeInTheDocument()

    await act(async () => resolveCount(42))
    expect(await screen.findByText('42 个素材')).toBeInTheDocument()
    expect(screen.queryByText('— 个素材')).toBeNull()
  })

  it('a failed count leaves the placeholder rather than a wrong number', async () => {
    vi.mocked(countAssetsInGroup).mockRejectedValueOnce(new Error('throttled'))
    await mountAndSettle()
    expect(await screen.findByText('— 个素材')).toBeInTheDocument()
    // 全页 error 不得被污染：count 是 best-effort 的装飾，不是页面能否用的条件。
    expect(screen.queryByText('无法连接到素材库 API')).toBeNull()
  })

  it('switching groups fires a new count for the new id and updates the header', async () => {
    await mountAndSettle()
    expect(await screen.findByText('42 个素材')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('group-row-g-1'))
    expect(await screen.findByText('7 个素材')).toBeInTheDocument()
    expect(countedIds()).toEqual(['g-0', 'g-1'])
    expect(screen.queryByText('42 个素材')).toBeNull()
  })

  it('renders a real 0 for an empty group (not the loading placeholder)', async () => {
    await mountAndSettle()
    fireEvent.click(screen.getByTestId('group-row-g-2'))
    expect(await screen.findByText('0 个素材')).toBeInTheDocument()
    expect(screen.queryByText('— 个素材')).toBeNull()
  })

  it('an older in-flight count for a re-selected group cannot overwrite the fresher one', async () => {
    // A→B→A：g-0 被选中两次，两个 request 都在途。较旧那次（第一次选择时
    // 发出的）如果在较新那次之后才回来，不能把新结果盖掉 —— retryOnRateLimit
    // 的退避（0.5/1/2s）就足以拉出这種窗口，而流控账户正是这个分支存在的
    // 理由，撞见的概率不低。
    let resolveFirst!: (n: number) => void
    let resolveSecond!: (n: number) => void
    let g0Calls = 0
    vi.mocked(countAssetsInGroup).mockImplementation((id: string) => {
      if (id !== 'g-0') return countImpl(id)
      g0Calls += 1
      return g0Calls === 1
        ? new Promise<number>((r) => (resolveFirst = r))
        : new Promise<number>((r) => (resolveSecond = r))
    })

    await mountAndSettle() // g-0 自动选中 → 第一发（held）
    await waitFor(() => expect(resolveFirst).toBeDefined())

    fireEvent.click(screen.getByTestId('group-row-g-1'))
    expect(await screen.findByText('7 个素材')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('group-row-g-0')) // 再次选中 g-0 → 第二发
    await waitFor(() => expect(resolveSecond).toBeDefined())

    // 较新那次先回来。
    await act(async () => resolveSecond(99))
    expect(await screen.findByText('99 个素材')).toBeInTheDocument()

    // 较旧那次这时才回来 —— 不得盖掉刚写入的 99。
    await act(async () => resolveFirst(1))
    expect(screen.getByText('99 个素材')).toBeInTheDocument()
    expect(screen.queryByText('1 个素材')).toBeNull()
  })

  it('does not re-count when only the status filter changes', async () => {
    await mountAndSettle()
    expect(await screen.findByText('42 个素材')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '状态筛选' }), {
      target: { value: 'Failed' },
    })
    await waitFor(() =>
      expect(vi.mocked(listAssets).mock.calls.length).toBeGreaterThan(1),
    )
    // 标题的数字是「群组里有几个素材」，与正在看哪个状态无关 —— 筛选换来换去
    // 不该各发一次 ListAssets。
    expect(countedIds()).toEqual(['g-0'])
    expect(screen.getByText('42 个素材')).toBeInTheDocument()
  })
})
