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
    id: `g-${i}`, name: `群组 ${i}`, groupType: 'AIGC',
    projectName: 'default', createTime: '', updateTime: '',
  }
}

const deletedIds: string[] = []
/** 这些 id 上的 DeleteAssetGroup 会以非暂时性错误（400）持续失败。 */
const failGroupIds = new Set<string>()
/** 非 null 时每次 DeleteAssetGroup 先等这个 gate — 把批次钉在 running。 */
let deleteGate: Promise<void> | null = null

/** 删除后 refreshGroups 会再被呼叫 — 只回传「尚存」群组。 */
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
 * 等整条批删管线收尾。batchDelete 以 4 QPS 派送（每笔间隔 250ms），所以
 * 「job 状态变了」遠早于「runGroupBatchDelete 回传、resolver 回到 sidebar」——
 * 收尾的讯号是批次结束后的那次 refreshGroups（listAssetGroups 再被呼叫），
 * 之后只剩 microtask，一个 macrotask 边界就沖得乾淨。
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
    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(2\)/ }))
  }

  it('typed confirmation gates the deletion', async () => {
    await enterManageAndCheckTwo()
    // Modal 打开，确认钮在未输入「删除」前 disabled
    const confirm = await screen.findByRole('button', { name: '永久删除' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    expect(vi.mocked(deleteAssetGroup)).not.toHaveBeenCalled()
  })

  it('lists the checked group names so a filtered-away check is still visible', async () => {
    await enterManageAndCheckTwo()
    const dialog = await screen.findByRole('dialog')
    // 勾选刻意在搜索过滤下保留 — 名单（而非只有数字）才是防误删的关键，
    // 标题行则让这串名字不会被读成「还剩下这些」之类的相反意思。
    expect(dialog.textContent).toContain('将删除以下群组：')
    expect(dialog.textContent).toContain('群组 0')
    expect(dialog.textContent).toContain('群组 1')
    expect(dialog.textContent).not.toContain('群组 2')
  })

  it('typing 删除 enables confirm; both groups deleted via deleteAssetGroup; job kind is group', async () => {
    await enterManageAndCheckTwo()
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    const modalInput = await screen.findByPlaceholderText('输入「删除」以确认')
    fireEvent.change(modalInput, { target: { value: '删除' } })
    const confirm = screen.getByRole('button', { name: '永久删除' })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(vi.mocked(deleteAssetGroup)).toHaveBeenCalledTimes(2)
    })
    expect(deletedIds.sort()).toEqual(['g-0', 'g-1'])
    expect(useAssetStore.getState().deleteJob?.kind).toBe('group')
    await settleBatch(listCalls)
    // store 的 removeGroup 已把两个群组移除；refreshGroups 回传剩余 1 个
    expect(useAssetStore.getState().groups.map((g) => g.id)).toEqual(['g-2'])
    // resolver 回到 sidebar：全数成功 → 清勾选并退出管理模式
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('an aborted batch keeps every still-undeleted group checked', async () => {
    // 403 这类共因错误会让 batchDelete 中止整批：failed[] 是空的，但一个群组
    // 都没删掉 —「空 failed」不可被当成全部成功而清掉勾选、退出管理模式
    //（素材版同样把 aborted 排除在 clearChecked 之外）。
    vi.mocked(deleteAssetGroup).mockRejectedValueOnce(
      new HttpError(403, 'AccessDenied', 'AccessDenied'),
    )
    await enterManageAndCheckTwo()
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('输入「删除」以确认'), {
      target: { value: '删除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    await settleBatch(listCalls)
    expect(useAssetStore.getState().deleteJob?.status).toBe('aborted')
    expect(deletedIds).toEqual([])
    expect(
      screen.getByRole('button', { name: /删除选择 \(2\)/ }),
    ).toBeInTheDocument()
  })

  it('refuses an asset batch delete while a group batch is running', async () => {
    // 两条删除管线共用同一个 deleteJob slot，而群组批次一跑起来确认 Modal
    // 就关了 — 底部的素材 pill bar 这时完全按得到。若让它起跑：新 job 覆盖
    // slot、旧的群组批次继续 patch 同一格 → 终态描述群组批次卻标成
    // kind:'asset'，「重试失败项」于是把群组 id 送进 DeleteAsset（全数 404，
    // 而 404 被当成幂等成功）→ toast 报「已删除」但群组还在。
    let release!: () => void
    deleteGate = new Promise<void>((r) => {
      release = r
    })
    await enterManageAndCheckTwo()
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('输入「删除」以确认'), {
      target: { value: '删除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    // gate 让批次停在第一笔之前 —— job 确实还在跑。
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
        name: /删除 1 个/,
      }),
    )
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      '已有删除工作进行中，请等待完成',
    )
    // 素材确认 Modal 没开（此刻画面上不该有任何 dialog）
    expect(screen.queryByRole('dialog')).toBeNull()
    // group job 没被覆盖 — kind 错了就是上面那条假成功路径的起点
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
    // 3 个群组，最后派送的那个以 400（非暂时性）持续失败 → 整批在它身上
    // 中止，但前两个已经删掉了。sidebar 的留勾名单来自
    // `ids.filter((id) => !removed.has(id))`：不能用 job.failed[]（中止时是
    // 空的 → 会被误判成全数成功而清掉勾选、退出管理模式），也不能整批留勾
    //（已删成的两个会复活成待重试项）。先前只测了全成功／全中止两个极端。
    failGroupIds.add('g-2')
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))
    fireEvent.click(screen.getByTestId('group-row-g-1'))
    fireEvent.click(screen.getByTestId('group-row-g-2'))
    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(3\)/ }))
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('输入「删除」以确认'), {
      target: { value: '删除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    await settleBatch(listCalls)

    expect(deletedIds.sort()).toEqual(['g-0', 'g-1'])
    expect(useAssetStore.getState().deleteJob).toMatchObject({
      status: 'aborted',
      succeeded: 2,
    })
    // 中止批次的 failed[] 是空的 —— 留勾的判准不能是它。
    expect(useAssetStore.getState().deleteJob?.failed).toEqual([])
    // 停在管理模式，只剩失败的那一个被勾著
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()
    expect(
      (screen.getByLabelText('选择 群组 2') as HTMLInputElement).checked,
    ).toBe(true)
    expect(screen.queryByTestId('group-row-g-0')).toBeNull()
  })

  it('batch-deleting the group you were standing in drops the asset-level checks', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    // g-0 是自动选中的群组；用户在它里面勾了 2 个素材（listAssets 在这个文件
    // 回空清单，所以直接種进 store —— 要钉的是勾选的生命周期，不是卡片渲染）。
    act(() => {
      useAssetStore.setState({ checkedIds: new Set(['g-0-a1', 'g-0-a2']) })
    })
    expect(
      within(screen.getByRole('toolbar')).getByRole('button', {
        name: /删除 2 个/,
      }),
    ).toBeInTheDocument()

    // 然后在管理模式里把 g-0 自己批删掉
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-g-0'))
    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(1\)/ }))
    const listCalls = vi.mocked(listAssetGroups).mock.calls.length
    fireEvent.change(await screen.findByPlaceholderText('输入「删除」以确认'), {
      target: { value: '删除' },
    })
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    await settleBatch(listCalls)

    expect(deletedIds).toEqual(['g-0'])
    // removeGroup 把选择改指 g-1。素材层的勾选若留着，那 2 个 id 指的是已经
    // 连同群组一起被级联删掉的素材：浮动列照亮「删除 2 个」、确认 Modal 对
    // g-1 的素材解析成空白名单与泛型缩图，按下去 DeleteAsset 全数 404 —— 而
    // 404 在 batchDelete 里算幂等成功，toast 于是报「已删除 2 个」。假成功。
    expect(useAssetStore.getState().selectedGroupId).toBe('g-1')
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('retrying a failed group job routes to deleteAssetGroup (not the asset path)', async () => {
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByTestId('group-row-g-0')).toBeInTheDocument(),
    )
    // 直接種一个「已结束但有失败项」的 group job：让失败真的发生要 5 次指数
    // 退避重试（>7s），而这里要钉的是重试的分流，不是重试机制本身。
    act(() => {
      useAssetStore.setState({
        deleteJob: {
          total: 2,
          succeeded: 1,
          status: 'done',
          kind: 'group',
          failed: [{ id: 'g-1', name: '群组 1', reason: 'HTTP 500' }],
        },
      })
    })
    // 进度 toast 被 mock 掉了，手动渲染它的内容才按得到「查看详情」。
    const renderToast = vi.mocked(toast.custom).mock.calls.at(-1)?.[0] as
      | (() => ReactNode)
      | undefined
    render(<>{renderToast?.()}</>)
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试失败项' }))
    // 群组 id 打 DeleteAsset 只会全数 404 — 而 404 被当成功，失败会被静静吞掉。
    await waitFor(() =>
      expect(vi.mocked(deleteAssetGroup)).toHaveBeenCalledWith('g-1'),
    )
    expect(deletedIds).toEqual(['g-1'])
  })

  it('cancelling the modal deletes nothing and keeps the checks', async () => {
    await enterManageAndCheckTwo()
    await screen.findByRole('button', { name: '永久删除' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(vi.mocked(deleteAssetGroup)).not.toHaveBeenCalled()
    // 勾选保留（删除钮仍显示 2）
    expect(screen.getByRole('button', { name: /删除选择 \(2\)/ })).toBeInTheDocument()
  })
})
