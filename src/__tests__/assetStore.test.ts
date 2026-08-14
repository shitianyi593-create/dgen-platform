import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAssetStore, REFETCH_AFTER_MS } from '../stores/assetStore'
import type { Asset, AssetGroup } from '../types/asset'

const group1: AssetGroup = {
  id: 'g1',
  name: 'my-assets',
  groupType: 'AIGC',
  projectName: 'my-project',
  createTime: '2026-05-06T00:00:00Z',
  updateTime: '2026-05-06T00:00:00Z',
}
const asset1: Asset = {
  id: 'asset-1',
  name: 'cat',
  url: 'https://u',
  groupId: 'g1',
  assetType: 'Image',
  status: 'Active',
  projectName: 'my-project',
  createTime: '2026-05-06T00:00:00Z',
  updateTime: '2026-05-06T00:00:00Z',
}

beforeEach(() => {
  useAssetStore.setState(useAssetStore.getInitialState())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('assetStore — bootstrap + groups', () => {
  it('starts with empty state', () => {
    const s = useAssetStore.getState()
    expect(s.groups).toEqual([])
    expect(s.assets).toEqual([])
    expect(s.selectedGroupId).toBeNull()
  })

  it('setGroups updates groups + fetchedAt', () => {
    const before = Date.now()
    useAssetStore.getState().setGroups([group1])
    const s = useAssetStore.getState()
    expect(s.groups).toEqual([group1])
    expect(s.groupsFetchedAt).toBeGreaterThanOrEqual(before)
  })

  it('setGroups auto-selects first group when nothing selected', () => {
    useAssetStore.getState().setGroups([group1])
    expect(useAssetStore.getState().selectedGroupId).toBe('g1')
  })

  it('setGroups preserves valid existing selection', () => {
    useAssetStore.setState({ selectedGroupId: 'g1' })
    useAssetStore
      .getState()
      .setGroups([group1, { ...group1, id: 'g2', name: 'g2' }])
    expect(useAssetStore.getState().selectedGroupId).toBe('g1')
  })

  it('setGroups falls back to first when current is removed', () => {
    useAssetStore.setState({ selectedGroupId: 'gone' })
    useAssetStore.getState().setGroups([group1])
    expect(useAssetStore.getState().selectedGroupId).toBe('g1')
  })

  it('setGroups clears the asset checks when it re-points the selection', () => {
    // checkedIds 装的是「目前这个群组里被勾的素材」。selectGroup 换组时清掉，
    // 但 setGroups 也会偷偷改指选择（服务器端搜索整批换清单、或选中的群组被
    // 别人删掉）—— 没清的话浮动列还亮著「删除 2 个」，而确认 Modal 的缩图与
    // 摘要是对著新群组的素材解析的：名单空白、只剩「删除 2 个？不可逆」。
    useAssetStore.setState({
      selectedGroupId: 'gone',
      checkedIds: new Set(['asset-1', 'asset-2']),
    })
    useAssetStore.getState().setGroups([group1])
    expect(useAssetStore.getState().selectedGroupId).toBe('g1')
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
  })

  it('setGroups keeps the asset checks when the selection survives', () => {
    // 只在「选择真的被改指」时清。单纯的 refresh（含背景 refreshGroups 刚好在
    // 勾到一半时完成）不得动用户进行中的勾选。
    useAssetStore.setState({
      selectedGroupId: 'g1',
      checkedIds: new Set(['asset-1']),
    })
    useAssetStore
      .getState()
      .setGroups([group1, { ...group1, id: 'g2', name: 'g2' }])
    expect(useAssetStore.getState().selectedGroupId).toBe('g1')
    expect([...useAssetStore.getState().checkedIds]).toEqual(['asset-1'])
  })
})

describe('assetStore — assets', () => {
  it('setAssets replaces and stamps fetchedAt', () => {
    useAssetStore.getState().setAssets([asset1])
    const s = useAssetStore.getState()
    expect(s.assets).toEqual([asset1])
    expect(s.assetsFetchedAt).not.toBeNull()
  })

  it('upsertAsset replaces by id', () => {
    useAssetStore.getState().setAssets([asset1])
    useAssetStore.getState().upsertAsset({ ...asset1, name: 'new' })
    expect(useAssetStore.getState().assets[0].name).toBe('new')
  })

  it('upsertAsset prepends new ids', () => {
    useAssetStore.getState().setAssets([asset1])
    const a2 = { ...asset1, id: 'asset-2', name: '2' }
    useAssetStore.getState().upsertAsset(a2)
    expect(useAssetStore.getState().assets.map((x) => x.id)).toEqual([
      'asset-2',
      'asset-1',
    ])
  })

  it('removeAsset deletes by id', () => {
    useAssetStore.getState().setAssets([asset1])
    useAssetStore.getState().removeAsset('asset-1')
    expect(useAssetStore.getState().assets).toEqual([])
  })

  it('removeGroup deletes group + cascades cleared selection + assets', () => {
    useAssetStore.getState().setGroups([group1])
    useAssetStore.getState().setAssets([asset1])
    useAssetStore.getState().removeGroup('g1')
    const s = useAssetStore.getState()
    expect(s.groups).toEqual([])
    expect(s.selectedGroupId).toBeNull()
    expect(s.assets).toEqual([])
  })

  it('setGroupCount writes into groupCounts', () => {
    useAssetStore.getState().setGroupCount('g1', 42)
    expect(useAssetStore.getState().groupCounts).toEqual({ g1: 42 })
  })

  it('setGroupCount overwrites existing entry without disturbing siblings', () => {
    useAssetStore.getState().setGroupCount('g1', 10)
    useAssetStore.getState().setGroupCount('g2', 20)
    useAssetStore.getState().setGroupCount('g1', 99)
    expect(useAssetStore.getState().groupCounts).toEqual({ g1: 99, g2: 20 })
  })

  it('removeGroup also clears the matching groupCounts entry', () => {
    useAssetStore.getState().setGroups([group1])
    useAssetStore.getState().setGroupCount('g1', 42)
    useAssetStore.getState().removeGroup('g1')
    expect(useAssetStore.getState().groupCounts).toEqual({})
  })

  it('removeGroup clears the asset checks when it re-points the selection', () => {
    // 与 setGroups 同一条不变式：checkedIds 装的是「目前这个群组里被勾的素材」，
    // 选择一被改指就全是死 id。批删自己选中的群组会走到这里 —— 没清的话浮动列
    // 还亮著「删除 2 个」，确认 Modal 对新群组的素材解析成空白名单，按下去
    // DeleteAsset 全数 404（batchDelete 视为幂等成功）→「已删除 2 个」的假成功。
    const group2 = { ...group1, id: 'g2', name: 'g2' }
    useAssetStore.getState().setGroups([group1, group2])
    expect(useAssetStore.getState().selectedGroupId).toBe('g1') // 前提：选择在 g1
    useAssetStore.getState().checkPageRange(['asset-1', 'asset-2'])
    useAssetStore.getState().removeGroup('g1')
    expect(useAssetStore.getState().selectedGroupId).toBe('g2')
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
  })

  it('removeGroup keeps the asset checks when the selection is untouched', () => {
    // 删的是别的群组（单列删除、批删没选中的那些）→ 用户在当前群组里进行中
    // 的勾选不得被动到。
    const group2 = { ...group1, id: 'g2', name: 'g2' }
    useAssetStore.getState().setGroups([group1, group2])
    expect(useAssetStore.getState().selectedGroupId).toBe('g1')
    useAssetStore.getState().checkPageRange(['asset-1'])
    useAssetStore.getState().removeGroup('g2')
    expect(useAssetStore.getState().selectedGroupId).toBe('g1')
    expect([...useAssetStore.getState().checkedIds]).toEqual(['asset-1'])
  })
})

describe('assetStore — refetch freshness', () => {
  it('shouldRefetchGroups is true on a fresh store', () => {
    expect(useAssetStore.getState().shouldRefetchGroups()).toBe(true)
  })

  it('shouldRefetchGroups becomes false right after setGroups', () => {
    useAssetStore.getState().setGroups([group1])
    expect(useAssetStore.getState().shouldRefetchGroups()).toBe(false)
  })

  it('shouldRefetchGroups returns true once older than REFETCH_AFTER_MS', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-06T00:00:00Z'))
    useAssetStore.getState().setGroups([group1])
    vi.setSystemTime(new Date(Date.now() + REFETCH_AFTER_MS + 1000))
    expect(useAssetStore.getState().shouldRefetchGroups()).toBe(true)
  })
})

describe('assetStore — filters / sort / page', () => {
  it('setFilters merges and resets page to 1', () => {
    useAssetStore.setState({
      page: { pageNumber: 5, pageSize: 24, totalCount: 0 },
    })
    useAssetStore.getState().setFilters({ name: 'foo' })
    const s = useAssetStore.getState()
    expect(s.filters.name).toBe('foo')
    expect(s.page.pageNumber).toBe(1)
  })

  it('setSort resets page to 1', () => {
    useAssetStore.setState({
      page: { pageNumber: 7, pageSize: 24, totalCount: 0 },
    })
    useAssetStore.getState().setSort({ sortBy: 'UpdateTime', sortOrder: 'Asc' })
    expect(useAssetStore.getState().page.pageNumber).toBe(1)
    expect(useAssetStore.getState().sort.sortBy).toBe('UpdateTime')
  })
})

describe('assetStore — uploads tracker', () => {
  it('startUpload appends, patchUpload merges, finishUpload removes', () => {
    useAssetStore
      .getState()
      .startUpload({
        clientId: 'c1',
        filename: 'a.jpg',
        stage: 'tos',
        groupId: 'g1',
        assetType: 'Image',
      })
    expect(useAssetStore.getState().uploads).toHaveLength(1)
    useAssetStore.getState().patchUpload('c1', { stage: 'create' })
    expect(useAssetStore.getState().uploads[0].stage).toBe('create')
    useAssetStore.getState().finishUpload('c1')
    expect(useAssetStore.getState().uploads).toEqual([])
  })
})

describe('assetStore — checkedIds (batch-delete selection)', () => {
  it('starts empty', () => {
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
  })

  it('toggleChecked adds then removes an id', () => {
    useAssetStore.getState().toggleChecked('asset-1')
    expect([...useAssetStore.getState().checkedIds]).toEqual(['asset-1'])
    useAssetStore.getState().toggleChecked('asset-1')
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
  })

  it('checkPageRange unions ids with existing selection', () => {
    useAssetStore.getState().toggleChecked('asset-1')
    useAssetStore.getState().checkPageRange(['asset-2', 'asset-3'])
    expect(new Set(useAssetStore.getState().checkedIds)).toEqual(
      new Set(['asset-1', 'asset-2', 'asset-3']),
    )
  })

  it('clearChecked empties the set', () => {
    useAssetStore.getState().checkPageRange(['a', 'b'])
    useAssetStore.getState().clearChecked()
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
  })

  it('selectGroup clears the selection (cross-group selection is meaningless)', () => {
    useAssetStore.getState().toggleChecked('asset-1')
    useAssetStore.getState().selectGroup('g2')
    expect(useAssetStore.getState().checkedIds.size).toBe(0)
  })

  it('setFilters / setSort / setPage do NOT clear the selection (cross-page accumulation)', () => {
    useAssetStore.getState().toggleChecked('asset-1')
    useAssetStore.getState().setFilters({ name: 'x' })
    useAssetStore.getState().setSort({ sortBy: 'CreateTime', sortOrder: 'Asc' })
    useAssetStore.getState().setPage({ pageNumber: 2, pageSize: 24 })
    expect([...useAssetStore.getState().checkedIds]).toEqual(['asset-1'])
  })
})

describe('assetStore — deleteJob', () => {
  it('starts null', () => {
    expect(useAssetStore.getState().deleteJob).toBeNull()
  })

  it('startDeleteJob initialises a running job (asset kind by default)', () => {
    useAssetStore.getState().startDeleteJob(3)
    expect(useAssetStore.getState().deleteJob).toEqual({
      total: 3,
      succeeded: 0,
      failed: [],
      status: 'running',
      kind: 'asset',
    })
  })

  it('startDeleteJob records an explicit group kind', () => {
    // 重试失败项时要靠 kind 分流到 DeleteAssetGroup，不能误走 DeleteAsset。
    useAssetStore.getState().startDeleteJob(2, 'group')
    expect(useAssetStore.getState().deleteJob?.kind).toBe('group')
  })

  it('patchDeleteJob preserves the kind', () => {
    useAssetStore.getState().startDeleteJob(2, 'group')
    useAssetStore.getState().patchDeleteJob({ succeeded: 1 })
    expect(useAssetStore.getState().deleteJob?.kind).toBe('group')
  })

  it('startDeleteJob refuses to overwrite a running job (shared slot invariant)', () => {
    // 素材／群组两条管线共用这一个 slot。覆盖不会让旧批次停下来 —— 它会继续
    // patch 同一格，于是进度描述甲批次、kind 卻是乙批次的，「重试失败项」照
    // kind 分流就会把群组 id 送进 DeleteAsset（404 当成功）→ 假成功 toast。
    useAssetStore.getState().startDeleteJob(2, 'group')
    useAssetStore.getState().startDeleteJob(5)
    expect(useAssetStore.getState().deleteJob).toMatchObject({
      total: 2,
      kind: 'group',
      status: 'running',
    })
  })

  it('startDeleteJob starts a fresh job once the previous one settled', () => {
    // 不变式只挡 running —— done／aborted 之后的「重试失败项」必须起得来。
    useAssetStore.getState().startDeleteJob(2, 'group')
    useAssetStore.getState().patchDeleteJob({ status: 'done', succeeded: 2 })
    useAssetStore.getState().startDeleteJob(1)
    expect(useAssetStore.getState().deleteJob).toMatchObject({
      total: 1,
      kind: 'asset',
      status: 'running',
    })
  })

  it('patchDeleteJob merges into the running job', () => {
    useAssetStore.getState().startDeleteJob(3)
    useAssetStore.getState().patchDeleteJob({ succeeded: 2 })
    expect(useAssetStore.getState().deleteJob?.succeeded).toBe(2)
    expect(useAssetStore.getState().deleteJob?.status).toBe('running')
  })

  it('patchDeleteJob is a no-op when no job is running', () => {
    useAssetStore.getState().patchDeleteJob({ succeeded: 9 })
    expect(useAssetStore.getState().deleteJob).toBeNull()
  })

  it('clearDeleteJob resets to null', () => {
    useAssetStore.getState().startDeleteJob(1)
    useAssetStore.getState().clearDeleteJob()
    expect(useAssetStore.getState().deleteJob).toBeNull()
  })
})
