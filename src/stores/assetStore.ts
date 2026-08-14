import { create } from 'zustand'
import type {
  Asset,
  AssetFilter,
  AssetGroup,
  AssetSortBy,
  PageInfo,
  SortOrder,
} from '../types/asset'

/**
 * Re-fetch when cached lists are older than 11 hours. Asset URLs from ARK
 * are valid 12 hours; the 11h margin keeps us safely fresh.
 */
export const REFETCH_AFTER_MS = 11 * 60 * 60 * 1000

export interface UploadInProgress {
  /** Stable client-side id (uuid). Survives stage transitions. */
  clientId: string
  filename: string
  /**
   * 'tos'      — uploading the local file to TOS
   * 'sign-get' — re-signing a 12h GET URL
   * 'create'   — calling CreateAsset
   * 'polling'  — waiting for ARK to flip to Active or Failed
   * 'done'     — terminal success
   * 'error'    — terminal failure (any stage)
   */
  stage: 'tos' | 'sign-get' | 'create' | 'polling' | 'done' | 'error'
  groupId: string
  assetType: 'Image' | 'Video' | 'Audio'
  /** Populated once CreateAsset returns. */
  assetId?: string
  error?: string
}

export interface DeleteJob {
  total: number
  succeeded: number
  failed: { id: string; name: string; reason: string }[]
  status: 'running' | 'done' | 'aborted'
  abortReason?: string
  /** 'asset'（默认，素材批删）| 'group'（群组批删）— 重试失败项时分流用。 */
  kind: 'asset' | 'group'
}

interface AssetState {
  groups: AssetGroup[]
  /** Per-group asset counts; populated lazily via countAssetsInGroup. */
  groupCounts: Record<string, number>
  selectedGroupId: string | null
  assets: Asset[]
  filters: AssetFilter
  sort: { sortBy: AssetSortBy; sortOrder: SortOrder }
  page: PageInfo
  groupsFetchedAt: number | null
  assetsFetchedAt: number | null
  loadingGroups: boolean
  loadingAssets: boolean
  uploads: UploadInProgress[]
  /** Batch-delete selection. In-memory, survives pagination/filter/sort
   *  (cross-page accumulation); cleared on group switch. */
  checkedIds: Set<string>
  /** Active / last batch-delete job; null when none has run. */
  deleteJob: DeleteJob | null

  // ── Sync setters ──
  setGroups(g: AssetGroup[]): void
  selectGroup(id: string | null): void
  upsertGroup(g: AssetGroup): void
  removeGroup(id: string): void
  setGroupCount(id: string, n: number): void

  setAssets(a: Asset[]): void
  upsertAsset(a: Asset): void
  removeAsset(id: string): void
  toggleChecked(id: string): void
  checkPageRange(ids: string[]): void
  clearChecked(): void
  startDeleteJob(total: number, kind?: 'asset' | 'group'): void
  patchDeleteJob(patch: Partial<DeleteJob>): void
  clearDeleteJob(): void

  setLoadingGroups(b: boolean): void
  setLoadingAssets(b: boolean): void

  setFilters(f: Partial<AssetFilter>): void
  setSort(s: { sortBy: AssetSortBy; sortOrder: SortOrder }): void
  setPage(p: { pageNumber: number; pageSize: number }): void

  // ── Upload tracker ──
  startUpload(u: UploadInProgress): void
  patchUpload(clientId: string, patch: Partial<UploadInProgress>): void
  finishUpload(clientId: string): void

  // ── Cache freshness ──
  shouldRefetchGroups(): boolean
  shouldRefetchAssets(): boolean
}

type AssetStoreInitial = Pick<
  AssetState,
  | 'groups'
  | 'groupCounts'
  | 'selectedGroupId'
  | 'assets'
  | 'filters'
  | 'sort'
  | 'page'
  | 'groupsFetchedAt'
  | 'assetsFetchedAt'
  | 'loadingGroups'
  | 'loadingAssets'
  | 'uploads'
  | 'checkedIds'
  | 'deleteJob'
>

const initial = (): AssetStoreInitial => ({
  groups: [],
  groupCounts: {},
  selectedGroupId: null,
  assets: [],
  filters: {},
  sort: { sortBy: 'CreateTime', sortOrder: 'Desc' },
  page: { pageNumber: 1, pageSize: 24, totalCount: 0 },
  groupsFetchedAt: null,
  assetsFetchedAt: null,
  loadingGroups: false,
  loadingAssets: false,
  uploads: [],
  checkedIds: new Set<string>(),
  deleteJob: null,
})

export const useAssetStore = create<AssetState>((set, get) => ({
  ...initial(),

  /**
   * 换上一份群组清单。选择的群组若不在新清单里就改指 groups[0]（或 null）。
   *
   * **选择真的被改指时，素材层的 checkedIds 一并清空。** checkedIds 装的是
   * 「目前这个群组里被勾的素材 id」（selectGroup 也是这样清的），选择一被改
   * 指，那些 id 指的就是一个已经看不见的群组的素材 —— 浮动操作列还亮著
   * 「删除 N 个」，而确认 Modal 的缩图与摘要是对著新群组的素材解析的，于是
   * 名单空白、只剩「删除 N 个？不可逆」。用户按下去，删掉的是别的群组里
   * 他已经看不到的东西。
   *
   * 走到这条路径的方式：服务器端群组搜索（清单尚未滚完，已加载 < 总数时）
   * 用 setGroups(搜索结果) 整批抽换可见清单，选择的群组通常不在结果里；
   * 另外还有「选中的群组被别人
   * 删掉，下一次 refresh 才发现」这条罕见路径。
   *
   * 只在「改指」时清：单纯的 refresh（选择仍在新清单内）不得动用户进行中
   * 的勾选 —— 背景 refreshGroups 刚好在勾到一半时完成是常态。
   */
  setGroups: (groups) =>
    set((s) => {
      const has = (id: string | null) =>
        id != null && groups.some((g) => g.id === id)
      const selectedGroupId = has(s.selectedGroupId)
        ? s.selectedGroupId
        : groups[0]?.id ?? null
      const reselected = selectedGroupId !== s.selectedGroupId
      return {
        groups,
        selectedGroupId,
        groupsFetchedAt: Date.now(),
        ...(reselected ? { checkedIds: new Set<string>() } : {}),
      }
    }),

  selectGroup: (id) => set({ selectedGroupId: id, checkedIds: new Set<string>() }),

  upsertGroup: (g) =>
    set((s) => {
      const idx = s.groups.findIndex((x) => x.id === g.id)
      const groups =
        idx >= 0
          ? s.groups.map((x, i) => (i === idx ? g : x))
          : [g, ...s.groups]
      return { groups }
    }),

  /**
   * 移除一个群组：清掉它的素材与 count，选择若正指著它就改指剩下的第一个。
   *
   * **选择真的被改指时，素材层的 checkedIds 一并清空** —— 与 `setGroups` 上方
   * 那段是同一条不变式（checkedIds 装的是「目前这个群组里被勾的素材 id」，选择
   * 一改指就全变成死 id）。两个入口都要守，否则批删自己选中的群组就会踩到：
   * 在 A 群组勾了 2 个素材 → 管理模式批删 A → 这里把选择改指 B，但 checkedIds
   * 还留着 A 的素材 id → 浮动列照亮「删除 2 个」，确认 Modal 的名单与摘要对著
   * B 的 displayedAssets 解析成空白 → 确认后 DeleteAsset 全数 404，而 404 在
   * batchDelete 里算幂等成功 → toast 报「已删除 2 个」。什么都没删的假成功。
   */
  removeGroup: (id) =>
    set((s) => {
      const groups = s.groups.filter((g) => g.id !== id)
      const selectedGroupId =
        s.selectedGroupId === id ? groups[0]?.id ?? null : s.selectedGroupId
      const reselected = selectedGroupId !== s.selectedGroupId
      const assets = s.assets.filter((a) => a.groupId !== id)
      // drop the count entry for the deleted group
      const groupCounts = { ...s.groupCounts }
      delete groupCounts[id]
      return {
        groups,
        selectedGroupId,
        assets,
        groupCounts,
        ...(reselected ? { checkedIds: new Set<string>() } : {}),
      }
    }),

  setGroupCount: (id, n) =>
    set((s) => ({ groupCounts: { ...s.groupCounts, [id]: n } })),

  setAssets: (assets) => set({ assets, assetsFetchedAt: Date.now() }),

  upsertAsset: (a) =>
    set((s) => {
      const idx = s.assets.findIndex((x) => x.id === a.id)
      const assets =
        idx >= 0
          ? s.assets.map((x, i) => (i === idx ? a : x))
          : [a, ...s.assets]
      return { assets }
    }),

  removeAsset: (id) =>
    set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

  toggleChecked: (id) =>
    set((s) => {
      const checkedIds = new Set(s.checkedIds)
      if (checkedIds.has(id)) checkedIds.delete(id)
      else checkedIds.add(id)
      return { checkedIds }
    }),

  checkPageRange: (ids) =>
    set((s) => {
      const checkedIds = new Set(s.checkedIds)
      for (const id of ids) checkedIds.add(id)
      return { checkedIds }
    }),

  clearChecked: () => set({ checkedIds: new Set<string>() }),

  /**
   * 起一个新的批删 job。**进行中的 job 不可被覆盖** —— 覆盖会静默失败
   * （no-op），不 throw。
   *
   * 素材批删与群组批删共用这一个 slot，而覆盖并不会让旧的批次停下来：它的
   * onProgress 会继续 patch 同一个 slot，于是终态的 total/failed 描述的是甲
   * 批次、kind 卻是乙批次的 —— 「重试失败项」照 kind 分流，就会把群组 id 送
   * 进 DeleteAsset（全数 404，而 404 被视为幂等成功）→ toast 报「已删除」但
   * 群组还在。毀滅性操作上的假成功，所以不变式住在 store 这一层，将来多一種
   * kind 也不会重开这个洞。
   *
   * 呼叫端本来就该先挡（AssetLibraryPage.requestBatchDelete 的 running 检查、
   * sidebar 的 deleteBusy），并负责告诉用户；这里是最后防线，因此只静默
   * 忽略。注记：真正保证两条管线不并行的是呼叫端；本层只保证 slot 的身分
   * （kind/total）属于先起跑的那个 job。
   */
  startDeleteJob: (total, kind = 'asset') =>
    set((s) =>
      s.deleteJob?.status === 'running'
        ? {}
        : {
            deleteJob: {
              total,
              succeeded: 0,
              failed: [],
              status: 'running',
              kind,
            },
          },
    ),

  patchDeleteJob: (patch) =>
    set((s) => (s.deleteJob ? { deleteJob: { ...s.deleteJob, ...patch } } : {})),

  clearDeleteJob: () => set({ deleteJob: null }),

  setLoadingGroups: (loadingGroups) => set({ loadingGroups }),
  setLoadingAssets: (loadingAssets) => set({ loadingAssets }),

  setFilters: (patch) =>
    set((s) => ({
      filters: { ...s.filters, ...patch },
      page: { ...s.page, pageNumber: 1 },
    })),
  setSort: (sort) => set({ sort, page: { ...get().page, pageNumber: 1 } }),
  setPage: (p) => set((s) => ({ page: { ...s.page, ...p } })),

  startUpload: (u) => set((s) => ({ uploads: [...s.uploads, u] })),
  patchUpload: (clientId, patch) =>
    set((s) => ({
      uploads: s.uploads.map((u) =>
        u.clientId === clientId ? { ...u, ...patch } : u,
      ),
    })),
  finishUpload: (clientId) =>
    set((s) => ({ uploads: s.uploads.filter((u) => u.clientId !== clientId) })),

  shouldRefetchGroups: () => {
    const t = get().groupsFetchedAt
    return t == null || Date.now() - t > REFETCH_AFTER_MS
  },
  shouldRefetchAssets: () => {
    const t = get().assetsFetchedAt
    return t == null || Date.now() - t > REFETCH_AFTER_MS
  },
}))

// Expose a stable initial-state function for tests. The Zustand 5 API used
// elsewhere in this repo (videoStore) doesn't rely on `getInitialState`, so
// we ship our own thin wrapper here.
;(useAssetStore as unknown as { getInitialState: () => AssetStoreInitial }).getInitialState =
  initial
