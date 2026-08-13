import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import toast from 'react-hot-toast'
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

function fakeGroup(i: number): AssetGroup {
  return {
    id: `g-${i}`, name: `群組 ${i}`, groupType: 'AIGC',
    projectName: 'default', createTime: '', updateTime: '',
  }
}

const deletedIds: string[] = []
/** 這些 id 上的 DeleteAssetGroup 會以非暫時性錯誤（400）持續失敗。 */
const failGroupIds = new Set<string>()
/** 非 null 時每次 DeleteAssetGroup 先等這個 gate — 把批次釘在 running。 */
let deleteGate: Promise<void> | null = null

/** 刪除後 refreshGroups 會再被呼叫 — 只回傳「尚存」群組。 */
async function listPage(
  _filter?: unknown,
  page: { pageNumber: number; pageSize: number } = {
    pageNumber: 1,
    pageSize: 100,
  },
): Promise<{ items: AssetGroup[]; page: PageInfo }> {
  const items = [0, 1, 2]
    .filter((i) => !deletedIds.includes(`g-${i}`))
    .map(fakeGroup)
  return { items, page: { ...page, totalCount: items.length } }
}

vi.mock('../api/asset', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/asset')>()
  // Deferred call into listPage: the factory runs before this module's
  // top-level bindings are initialised.
  const listAssetGroups = vi.fn(
    (...args: Parameters<typeof listPage>) => listPage(...args),
  )
  return {
    ...orig,
    listAssetGroups,
    listAssets: vi.fn(async () => ({
      items: [], page: { pageNumber: 1, pageSize: 100, totalCount: 0 },
    })),
    countAssetsInGroup: vi.fn(async () => 0),
    deleteAssetGroup: vi.fn(async (id: string) => {
      if (deleteGate) await deleteGate
      if (failGroupIds.has(id)) {
        throw new orig.HttpError(400, 'InvalidParameter', 'InvalidParameter')
      }
      deletedIds.push(id)
    }),
  }
})
import { deleteAssetGroup, listAssetGroups, HttpError } from '../api/asset'

/**
 * 等整條批刪管線收尾。batchDelete 以 4 QPS 派送（每筆間隔 250ms），所以
 * 「job 狀態變了」遠早於「runGroupBatchDelete 回傳、resolver 回到 sidebar」——
 * 收尾的訊號是批次結束後的那次 refreshGroups（listAssetGroups 再被呼叫），
 * 之後只剩 microtask，一個 macrotask 邊界就沖得乾淨。
 */
async function settleBatch(listCallsBefore: number) {
  await waitFor(
    () =>
      expect(vi.mocked(listAssetGroups).mock.calls.length).toBeGreaterThan(
        listCallsBefore,
      ),
    { timeout: 3000 },
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('batch group delete wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deletedIds.length = 0
    failGroupIds.clear()
    deleteGate = null
    useAssetStore.setState(useAssetStore.getInitialState())
    useAuthStore.setState({
      assetCreds: { accessKeyId: 'ak', accessKeySecret: 'sk', projectName: 'default' },
    })
  })

  async function enterManageAndCheckTwo() {
    render(<AssetLibraryPage />)
    await waitFor(() => expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))
    fireEvent.click(screen.getByTestId('group-row-g-1'))
    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(2\)/ }))
  }

  it('typed confirmation gates the deletion', async () => {
    await enterManageAndCheckTwo()
    // Modal 開啟，確認鈕在未輸入「刪除」前 disabled
    const confirm = await screen.findByRole('button', { name: '永久刪除' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    expect(vi.mocked(deleteAssetGroup)).not.toHaveBeenCalled()
  })

  it('lists the checked group names so a filtered-away check is still visible', async () => {
    await enterManageAndCheckTwo()
    const dialog = await screen.findByRole('dialog')
    // 勾選刻意在搜尋過濾下保留 — 名單（而非只有數字）才是防誤刪的關鍵，
    // 標題行則讓這串名字不會被讀成「還剩下這些」之類的相反意思。
    expect(dialog.textContent).toContain('將刪除以下群組：')
    expect(dialog.textContent).toContain('群組 0')
    expect(dialog.textContent).toContain('群組 1')
    expect(dialog.textContent).not.toContain('群組 2')
  })

  it('typing 刪除 enables confirm; both groups deleted via deleteAssetGroup; job kind is group', async () => {
    await enterManageAndCheckTwo()
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    const modalInput = await screen.findByPlaceholderText('輸入「刪除」以確認')
    fireEvent.change(modalInput, { target: { value: '刪除' } })
    const confirm = screen.getByRole('button', { name: '永久刪除' })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(vi.mocked(deleteAssetGroup)).toHaveBeenCalledTimes(2)
    })
    expect(deletedIds.sort()).toEqual(['g-0', 'g-1'])
    expect(useAssetStore.getState().deleteJob?.kind).toBe('group')
    await settleBatch(listCalls)
    // store 的 removeGroup 已把兩個群組移除；refreshGroups 回傳剩餘 1 個
    expect(useAssetStore.getState().groups.map((g) => g.id)).toEqual(['g-2'])
    // resolver 回到 sidebar：全數成功 → 清勾選並退出管理模式
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('an aborted batch keeps every still-undeleted group checked', async () => {
    // 403 這類共因錯誤會讓 batchDelete 中止整批：failed[] 是空的，但一個群組
    // 都沒刪掉 —「空 failed」不可被當成全部成功而清掉勾選、退出管理模式
    //（素材版同樣把 aborted 排除在 clearChecked 之外）。
    vi.mocked(deleteAssetGroup).mockRejectedValueOnce(
      new HttpError(403, 'AccessDenied', 'AccessDenied'),
    )
    await enterManageAndCheckTwo()
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('輸入「刪除」以確認'), {
      target: { value: '刪除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    await settleBatch(listCalls)
    expect(useAssetStore.getState().deleteJob?.status).toBe('aborted')
    expect(deletedIds).toEqual([])
    expect(
      screen.getByRole('button', { name: /刪除選取 \(2\)/ }),
    ).toBeInTheDocument()
  })

  it('refuses an asset batch delete while a group batch is running', async () => {
    // 兩條刪除管線共用同一個 deleteJob slot，而群組批次一跑起來確認 Modal
    // 就關了 — 底部的素材 pill bar 這時完全按得到。若讓它起跑：新 job 覆蓋
    // slot、舊的群組批次繼續 patch 同一格 → 終態描述群組批次卻標成
    // kind:'asset'，「重試失敗項」於是把群組 id 送進 DeleteAsset（全數 404，
    // 而 404 被當成冪等成功）→ toast 報「已刪除」但群組還在。
    let release!: () => void
    deleteGate = new Promise<void>((r) => {
      release = r
    })
    await enterManageAndCheckTwo()
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('輸入「刪除」以確認'), {
      target: { value: '刪除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    // gate 讓批次停在第一筆之前 —— job 確實還在跑。
    expect(useAssetStore.getState().deleteJob).toMatchObject({
      status: 'running',
      kind: 'group',
      total: 2,
    })

    act(() => {
      useAssetStore.setState({ checkedIds: new Set(['a-1']) })
    })
    fireEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', {
        name: /刪除 1 個/,
      }),
    )
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      '已有刪除工作進行中，請等待完成',
    )
    // 素材確認 Modal 沒開（此刻畫面上不該有任何 dialog）
    expect(screen.queryByRole('dialog')).toBeNull()
    // group job 沒被覆蓋 — kind 錯了就是上面那條假成功路徑的起點
    expect(useAssetStore.getState().deleteJob).toMatchObject({
      status: 'running',
      kind: 'group',
      total: 2,
    })

    await act(async () => {
      release()
    })
    await settleBatch(listCalls)
    expect(deletedIds.sort()).toEqual(['g-0', 'g-1'])
  })

  it('a mixed batch leaves exactly the still-undeleted group checked', async () => {
    // 3 個群組，最後派送的那個以 400（非暫時性）持續失敗 → 整批在它身上
    // 中止，但前兩個已經刪掉了。sidebar 的留勾名單來自
    // `ids.filter((id) => !removed.has(id))`：不能用 job.failed[]（中止時是
    // 空的 → 會被誤判成全數成功而清掉勾選、退出管理模式），也不能整批留勾
    //（已刪成的兩個會復活成待重試項）。先前只測了全成功／全中止兩個極端。
    failGroupIds.add('g-2')
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))
    fireEvent.click(screen.getByTestId('group-row-g-1'))
    fireEvent.click(screen.getByTestId('group-row-g-2'))
    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(3\)/ }))
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('輸入「刪除」以確認'), {
      target: { value: '刪除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    await settleBatch(listCalls)

    expect(deletedIds.sort()).toEqual(['g-0', 'g-1'])
    expect(useAssetStore.getState().deleteJob).toMatchObject({
      status: 'aborted',
      succeeded: 2,
    })
    // 中止批次的 failed[] 是空的 —— 留勾的判準不能是它。
    expect(useAssetStore.getState().deleteJob?.failed).toEqual([])
    // 停在管理模式，只剩失敗的那一個被勾著
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()
    expect(
      (screen.getByLabelText('選取 群組 2') as HTMLInputElement).checked,
    ).toBe(true)
    expect(screen.queryByTestId('group-row-g-0')).toBeNull()
  })

  it('batch-deleting the group you were standing in drops the asset-level checks', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    // g-0 是自動選中的群組；使用者在它裡面勾了 2 個素材（listAssets 在這個檔案
    // 回空清單，所以直接種進 store —— 要釘的是勾選的生命週期，不是卡片渲染）。
    act(() => {
      useAssetStore.setState({ checkedIds: new Set(['g-0-a1', 'g-0-a2']) })
    })
    expect(
      within(screen.getByRole('toolbar')).getByRole('button', {
        name: /刪除 2 個/,
      }),
    ).toBeInTheDocument()

    // 然後在管理模式裡把 g-0 自己批刪掉
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))
    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(1\)/ }))
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('輸入「刪除」以確認'), {
      target: { value: '刪除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    await settleBatch(listCalls)

    expect(deletedIds).toEqual(['g-0'])
    // removeGroup 把選取改指 g-1。素材層的勾選若留著，那 2 個 id 指的是已經
    // 連同群組一起被級聯刪掉的素材：浮動列照亮「刪除 2 個」、確認 Modal 對
    // g-1 的素材解析成空白名單與泛型縮圖，按下去 DeleteAsset 全數 404 —— 而
    // 404 在 batchDelete 裡算冪等成功，toast 於是報「已刪除 2 個」。假成功。
    expect(useAssetStore.getState().selectedGroupId).toBe('g-1')
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('retrying a failed group job routes to deleteAssetGroup (not the asset path)', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    // 直接種一個「已結束但有失敗項」的 group job：讓失敗真的發生要 5 次指數
    // 退避重試（>7s），而這裡要釘的是重試的分流，不是重試機制本身。
    act(() => {
      useAssetStore.setState({
        deleteJob: {
          total: 2,
          succeeded: 1,
          status: 'done',
          kind: 'group',
          failed: [{ id: 'g-1', name: '群組 1', reason: 'HTTP 500' }],
        },
      })
    })
    // 進度 toast 被 mock 掉了，手動渲染它的內容才按得到「查看詳情」。
    const renderToast = vi.mocked(toast.custom).mock.calls.at(-1)?.[0] as
      | (() => ReactNode)
      | undefined
    render(<>{renderToast?.()}</>)
    fireEvent.click(screen.getByRole('button', { name: '查看詳情' }))
    fireEvent.click(await screen.findByRole('button', { name: '重試失敗項' }))
    // 群組 id 打 DeleteAsset 只會全數 404 — 而 404 被當成功，失敗會被靜靜吞掉。
    await waitFor(() =>
      expect(vi.mocked(deleteAssetGroup)).toHaveBeenCalledWith('g-1'),
    )
    expect(deletedIds).toEqual(['g-1'])
  })

  it('cancelling the modal deletes nothing and keeps the checks', async () => {
    await enterManageAndCheckTwo()
    await screen.findByRole('button', { name: '永久刪除' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(vi.mocked(deleteAssetGroup)).not.toHaveBeenCalled()
    // 勾選保留（刪除鈕仍顯示 2）
    expect(screen.getByRole('button', { name: /刪除選取 \(2\)/ })).toBeInTheDocument()
  })
})
