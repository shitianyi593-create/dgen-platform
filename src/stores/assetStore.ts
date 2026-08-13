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
  /** 'asset'（預設，素材批刪）| 'group'（群組批刪）— 重試失敗項時分流用。 */
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
   * 換上一份群組清單。選取的群組若不在新清單裡就改指 groups[0]（或 null）。
   *
   * **選取真的被改指時，素材層的 checkedIds 一併清空。** checkedIds 裝的是
   * 「目前這個群組裡被勾的素材 id」（selectGroup 也是這樣清的），選取一被改
   * 指，那些 id 指的就是一個已經看不見的群組的素材 —— 浮動操作列還亮著
   * 「刪除 N 個」，而確認 Modal 的縮圖與摘要是對著新群組的素材解析的，於是
   * 名單空白、只剩「刪除 N 個？不可逆」。使用者按下去，刪掉的是別的群組裡
   * 他已經看不到的東西。
   *
   * 走到這條路徑的方式：伺服器端群組搜尋（清單尚未捲完，已載入 < 總數時）
   * 用 setGroups(搜尋結果) 整批抽換可見清單，選取的群組通常不在結果裡；
   * 另外還有「選中的群組被別人
   * 刪掉，下一次 refresh 才發現」這條罕見路徑。
   *
   * 只在「改指」時清：單純的 refresh（選取仍在新清單內）不得動使用者進行中
   * 的勾選 —— 背景 refreshGroups 剛好在勾到一半時完成是常態。
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
   * 移除一個群組：清掉它的素材與 count，選取若正指著它就改指剩下的第一個。
   *
   * **選取真的被改指時，素材層的 checkedIds 一併清空** —— 與 `setGroups` 上方
   * 那段是同一條不變式（checkedIds 裝的是「目前這個群組裡被勾的素材 id」，選取
   * 一改指就全變成死 id）。兩個入口都要守，否則批刪自己選中的群組就會踩到：
   * 在 A 群組勾了 2 個素材 → 管理模式批刪 A → 這裡把選取改指 B，但 checkedIds
   * 還留著 A 的素材 id → 浮動列照亮「刪除 2 個」，確認 Modal 的名單與摘要對著
   * B 的 displayedAssets 解析成空白 → 確認後 DeleteAsset 全數 404，而 404 在
   * batchDelete 裡算冪等成功 → toast 報「已刪除 2 個」。什麼都沒刪的假成功。
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
   * 起一個新的批刪 job。**進行中的 job 不可被覆蓋** —— 覆蓋會靜默失敗
   * （no-op），不 throw。
   *
   * 素材批刪與群組批刪共用這一個 slot，而覆蓋並不會讓舊的批次停下來：它的
   * onProgress 會繼續 patch 同一個 slot，於是終態的 total/failed 描述的是甲
   * 批次、kind 卻是乙批次的 —— 「重試失敗項」照 kind 分流，就會把群組 id 送
   * 進 DeleteAsset（全數 404，而 404 被視為冪等成功）→ toast 報「已刪除」但
   * 群組還在。毀滅性操作上的假成功，所以不變式住在 store 這一層，將來多一種
   * kind 也不會重開這個洞。
   *
   * 呼叫端本來就該先擋（AssetLibraryPage.requestBatchDelete 的 running 檢查、
   * sidebar 的 deleteBusy），並負責告訴使用者；這裡是最後防線，因此只靜默
   * 忽略。註記：真正保證兩條管線不並行的是呼叫端；本層只保證 slot 的身分
   * （kind/total）屬於先起跑的那個 job。
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
