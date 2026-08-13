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

/** 三個群組一頁載完 —— 無限捲動與伺服器搜尋在這個檔案裡都不該現身。 */
const GROUPS: AssetGroup[] = [0, 1, 2].map((i) => ({
  id: `g-${i}`,
  name: `群組 ${i}`,
  groupType: 'AIGC',
  projectName: 'default',
  createTime: '',
  updateTime: '',
}))

/**
 * 伺服器端的群組總數。刻意與 `listAssets` 回的筆數（2）不同：標題若讀的是
 * 「載進來的那一頁」（assets.length / chipCounts.all）就會顯示 2，斷言 42
 * 才能釘住它讀的是 `groupCounts`。真實情境裡的差距更大 —— 一頁上限 100，
 * 大群組的標題會永遠停在 100。
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

/** 初載完成 = 側欄第一列畫出來了（此時 g-0 已被自動選中）。 */
async function mountAndSettle() {
  render(<AssetLibraryPage />)
  await waitFor(() =>
    expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
  )
}

/** `countAssetsInGroup` 被呼叫過的 groupId，依序。 */
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
    expect(await screen.findByText('42 個素材')).toBeInTheDocument()
    // 一次選取 = 一發。扇出（每個群組一發）正是 Task 2 刪掉的那個病灶，
    // 這裡守住它沒有從標題這條路溜回來。
    expect(countedIds()).toEqual(['g-0'])
    // 42 而不是 2：標題讀的是伺服器總數，不是這一頁載進來的素材數。
    expect(screen.queryByText('2 個素材')).toBeNull()
  })

  it("shows '—' until the count resolves", async () => {
    let resolveCount!: (n: number) => void
    vi.mocked(countAssetsInGroup).mockImplementationOnce(
      () => new Promise<number>((r) => (resolveCount = r)),
    )

    await mountAndSettle()
    // 群組名已在標題上，count 還在途 —— 不能先假裝 0。
    expect(await screen.findByText('— 個素材')).toBeInTheDocument()

    await act(async () => resolveCount(42))
    expect(await screen.findByText('42 個素材')).toBeInTheDocument()
    expect(screen.queryByText('— 個素材')).toBeNull()
  })

  it('a failed count leaves the placeholder rather than a wrong number', async () => {
    vi.mocked(countAssetsInGroup).mockRejectedValueOnce(new Error('throttled'))
    await mountAndSettle()
    expect(await screen.findByText('— 個素材')).toBeInTheDocument()
    // 全頁 error 不得被污染：count 是 best-effort 的裝飾，不是頁面能否用的條件。
    expect(screen.queryByText('無法連線到 ARK Asset API')).toBeNull()
  })

  it('switching groups fires a new count for the new id and updates the header', async () => {
    await mountAndSettle()
    expect(await screen.findByText('42 個素材')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('group-row-g-1'))
    expect(await screen.findByText('7 個素材')).toBeInTheDocument()
    expect(countedIds()).toEqual(['g-0', 'g-1'])
    expect(screen.queryByText('42 個素材')).toBeNull()
  })

  it('renders a real 0 for an empty group (not the loading placeholder)', async () => {
    await mountAndSettle()
    fireEvent.click(screen.getByTestId('group-row-g-2'))
    expect(await screen.findByText('0 個素材')).toBeInTheDocument()
    expect(screen.queryByText('— 個素材')).toBeNull()
  })

  it('an older in-flight count for a re-selected group cannot overwrite the fresher one', async () => {
    // A→B→A：g-0 被選中兩次，兩個 request 都在途。較舊那次（第一次選取時
    // 發出的）如果在較新那次之後才回來，不能把新結果蓋掉 —— retryOnRateLimit
    // 的退避（0.5/1/2s）就足以拉出這種窗口，而流控帳戶正是這個分支存在的
    // 理由，撞見的機率不低。
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

    await mountAndSettle() // g-0 自動選中 → 第一發（held）
    await waitFor(() => expect(resolveFirst).toBeDefined())

    fireEvent.click(screen.getByTestId('group-row-g-1'))
    expect(await screen.findByText('7 個素材')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('group-row-g-0')) // 再次選中 g-0 → 第二發
    await waitFor(() => expect(resolveSecond).toBeDefined())

    // 較新那次先回來。
    await act(async () => resolveSecond(99))
    expect(await screen.findByText('99 個素材')).toBeInTheDocument()

    // 較舊那次這時才回來 —— 不得蓋掉剛寫入的 99。
    await act(async () => resolveFirst(1))
    expect(screen.getByText('99 個素材')).toBeInTheDocument()
    expect(screen.queryByText('1 個素材')).toBeNull()
  })

  it('does not re-count when only the status filter changes', async () => {
    await mountAndSettle()
    expect(await screen.findByText('42 個素材')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '狀態篩選' }), {
      target: { value: 'Failed' },
    })
    await waitFor(() =>
      expect(vi.mocked(listAssets).mock.calls.length).toBeGreaterThan(1),
    )
    // 標題的數字是「群組裡有幾個素材」，與正在看哪個狀態無關 —— 篩選換來換去
    // 不該各發一次 ListAssets。
    expect(countedIds()).toEqual(['g-0'])
    expect(screen.getByText('42 個素材')).toBeInTheDocument()
  })
})
