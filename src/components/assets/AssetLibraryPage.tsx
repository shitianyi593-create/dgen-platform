import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  createAssetGroup,
  deleteAsset,
  deleteAssetGroup,
  getAsset,
  GROUP_PAGE_SIZE_MAX,
  listAssetGroups,
  listAssets,
  updateAsset,
  updateAssetGroup,
} from '../../api/asset'
import { refreshGroupCount } from '../../api/groupCount'
import { useAssetStore } from '../../stores/assetStore'
import { useAuthStore } from '../../stores/authStore'
import { startManyAssetUploads } from '../../hooks/useAssetUpload'
import { copyToClipboard } from '../../utils/clipboard'
import { useResizableWidth } from '../../hooks/useResizableWidth'
import { useAssetStatusPoller } from '../../hooks/useAssetStatusPoller'
import { toUiAssetType, type Asset, type AssetGroup } from '../../types/asset'
import AssetGroupSidebar, {
  ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH,
} from './AssetGroupSidebar'
import AssetGrid from './AssetGrid'
import AssetUploadDialog from './AssetUploadDialog'
import AssetPreviewDrawer, {
  ASSET_PREVIEW_DRAWER_DEFAULT_WIDTH,
} from './AssetPreviewDrawer'
import AssetTypeFilterChips, {
  type TypeFilter,
} from './AssetTypeFilterChips'
import AssetStatusFilterChips, {
  type StatusFilter,
} from './AssetStatusFilterChips'
import { batchDelete } from '../../api/batchDelete'
import ResizeHandle from '../common/ResizeHandle'
import ConfirmModal from '../common/ConfirmModal'
import ActionPillBar from '../common/ActionPillBar'
import { Icon } from '../common/icons'
import { useAssetJobToasts } from '../../hooks/useAssetJobToasts'

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 480
const DRAWER_MIN = 360
const DRAWER_MAX = 720

export default function AssetLibraryPage() {
  const assetCreds = useAuthStore((s) => s.assetCreds)
  const credsReady = Boolean(
    assetCreds.accessKeyId && assetCreds.accessKeySecret && assetCreds.projectName,
  )
  if (!credsReady) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--text-muted)', fontSize: 14 }}>
        <p>請先在側邊面板「② 私有素材庫憑證」區塊填入並驗證後使用。</p>
      </div>
    )
  }
  return <AssetLibraryPageInner />
}

function AssetLibraryPageInner() {
  // ── Store selectors ──
  const tosReady = useAuthStore((s) =>
    Boolean(s.tosCreds.accessKeyId && s.tosCreds.accessKeySecret && s.tosCreds.bucket),
  )
  const groups = useAssetStore((s) => s.groups)
  const assets = useAssetStore((s) => s.assets)
  const groupCounts = useAssetStore((s) => s.groupCounts)
  const selectedGroupId = useAssetStore((s) => s.selectedGroupId)
  const loadingAssets = useAssetStore((s) => s.loadingAssets)
  const setLoadingGroups = useAssetStore((s) => s.setLoadingGroups)
  const setLoadingAssets = useAssetStore((s) => s.setLoadingAssets)
  const setGroups = useAssetStore((s) => s.setGroups)
  const setAssets = useAssetStore((s) => s.setAssets)
  const selectGroup = useAssetStore((s) => s.selectGroup)
  const removeGroup = useAssetStore((s) => s.removeGroup)
  const removeAsset = useAssetStore((s) => s.removeAsset)
  const upsertAsset = useAssetStore((s) => s.upsertAsset)
  const checkedIds = useAssetStore((s) => s.checkedIds)
  const toggleChecked = useAssetStore((s) => s.toggleChecked)
  const checkPageRange = useAssetStore((s) => s.checkPageRange)
  const clearChecked = useAssetStore((s) => s.clearChecked)
  const startDeleteJob = useAssetStore((s) => s.startDeleteJob)
  const patchDeleteJob = useAssetStore((s) => s.patchDeleteJob)
  const deleteJob = useAssetStore((s) => s.deleteJob)

  // ── Local UI state ──
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [singleDeleteAsset, setSingleDeleteAsset] = useState<Asset | null>(null)
  const [pendingBatchDelete, setPendingBatchDelete] = useState<string[] | null>(
    null,
  )
  const [pendingGroupDelete, setPendingGroupDelete] =
    useState<AssetGroup | null>(null)
  // Sidebar 的「刪除選取」與它的確認 Modal 之間的橋樑：resolve 一路帶回
  // sidebar，讓它知道該清勾選（成功）、留失敗項、還是原樣保留（取消）。
  const [pendingGroupBatch, setPendingGroupBatch] = useState<{
    ids: string[]
    resolve: (r: { failedIds: string[] } | null) => void
  } | null>(null)
  // ── 群組清單的分頁累積狀態（spec §3）──
  // 伺服器回報的群組總數（不是 groups.length — 那是「目前累積到的」）。
  const [groupTotal, setGroupTotal] = useState(0)
  /** 下一次「載更多」要抓的頁碼；初載成功後是 2。 */
  const [nextPageNumber, setNextPageNumber] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 載更多失敗的訊息 —— 刻意不併進全頁 `error`（已載入的清單照常可用）。 */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  // 已累積的群組 id。Desc 排序下抓頁期間若有群組被建立，視窗整個往下位移，
  // 頁尾項目會在下一頁重複回傳 —— append 前逐項比對，避免 React duplicate
  // key 與管理模式的勾選數錯亂。
  const seenGroupIds = useRef<Set<string>>(new Set())
  const hasMoreGroups = groups.length < groupTotal
  // 「已載入 < 總數」同時也是搜尋門檻：前端手上的清單不完整時，搜尋必須改走
  // 伺服器端 Name 過濾，否則搜不到還沒捲到的那些群組。刻意寫成別名而非重複
  // 一次表達式 —— 兩者語意上綁定，不該各自漂移。
  const serverSearchMode = hasMoreGroups
  /**
   * 目前劫持著清單的伺服器端查詢字（null = 畫面上是累積清單）。
   * 不變式：非 null ⟹ `groups` 裝的是一次搜尋的結果（反向不保證 —— 搜尋失敗時
   * `groups` 仍是累積清單，此時旗標刻意維持非 null，見下）。
   * 三個消費者：載更多互斥、底部 footer 靜音、批刪收尾要重跑哪個查詢。
   *
   * 刻意不吃 sidebar 每個按鍵的 `onQueryChange`：那時 debounce 還沒到期、清單
   * 也還沒被換掉，此刻停掉無限捲動只會讓「打字打到一半順手捲一下」失效。
   * 寫入/還原時機見 `runGroupSearch`，清除見 `refreshGroups`。
   *
   * 讀哪一份看消費者是誰：footer 靜音是 render-time 的 JSX prop 計算，
   * 必須讀下面這個 state（ref 改變不會觸發 re-render，UI 不會跟著更新）；
   * 載更多互斥（`loadMoreGroups`）與批刪收尾（`runGroupBatchDelete`）都是
   * 事件觸發的非同步守門，必須讀 `activeGroupQueryRef`——state 要等 React
   * commit 完那次 re-render 才追上，這兩個消費者的觸發時機（使用者捲動、
   * batchDelete 的 await 鏈）都跟 render 週期沒有同步關係，留讀 state 會
   * 開一個「已經送出新查詢、還沒 commit」的窗口。
   */
  const [activeGroupQuery, setActiveGroupQueryState] = useState<string | null>(
    null,
  )
  const activeGroupQueryRef = useRef<string | null>(null)
  const setActiveGroupQuery = useCallback((q: string | null) => {
    activeGroupQueryRef.current = q
    setActiveGroupQueryState(q)
  }, [])
  const groupSearchTimer = useRef<number | null>(null)
  const [pendingFirstGroup, setPendingFirstGroup] = useState(false)
  const [firstGroupName, setFirstGroupName] = useState('')
  const [showFailDetails, setShowFailDetails] = useState(false)

  // Drive store-backed progress toasts (delete + uploads) via a single hook.
  // Replaces the legacy in-page progress strips (spec §4.3).
  // Failure details modal is owned here.
  // Stable callback ref so the hook's effect doesn't re-run on every host render.
  const handleShowFailDetails = useCallback(() => setShowFailDetails(true), [])
  useAssetJobToasts(handleShowFailDetails)

  // ── Resizable column widths (persisted in localStorage) ──
  const [sidebarWidth, setSidebarWidth] = useResizableWidth({
    storageKey: 'assetLibraryPage.sidebarWidth',
    defaultWidth: ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
  })
  const [drawerWidth, setDrawerWidth] = useResizableWidth({
    storageKey: 'assetLibraryPage.drawerWidth',
    defaultWidth: ASSET_PREVIEW_DRAWER_DEFAULT_WIDTH,
    min: DRAWER_MIN,
    max: DRAWER_MAX,
  })

  // ── Derived ──
  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  )
  /**
   * 主面板標題旁的素材數（spec §4.3）。讀 `groupCounts`（伺服器端的群組總數）
   * 而非 `assets.length` —— 後者只是「這次載進來的那一頁」，上限 100 且會被
   * 狀態篩選縮小，大群組的標題會永遠停在「100 個素材」，而換一下狀態篩選數字
   * 就跳動。列上的逐群組徽章已隨 count 扇出刪除，選中這一個是唯一還會發
   * `countAssetsInGroup` 的地方。
   *
   * undefined（還沒回來、或那一發被吞掉的失敗）→ '—'，不退化成 0：空群組與
   * 「還不知道」在畫面上必須分得出來，否則使用者會以為素材沒上傳成功。
   */
  const selectedGroupCountLabel =
    selectedGroupId !== null && groupCounts[selectedGroupId] !== undefined
      ? String(groupCounts[selectedGroupId])
      : '—'
  const previewAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  )
  const previewGroupName = useMemo(
    () => groups.find((g) => g.id === previewAsset?.groupId)?.name,
    [groups, previewAsset],
  )

  // 跨清單抽換累積的 id → 名稱快取。
  //
  // 伺服器端搜尋模式（清單尚未載完）下 `groups` 是「這次搜尋的可見清單」而非現存
  // 群組的全集，而該模式下的多選本來就只能靠一次搜尋一個累積 —— 只查 `groups`
  // 的話，先前搜尋勾到的群組在批刪確認 Modal 上會退化成裸 id
  //（「將刪除以下群組：g-0」），在 batchDelete 的 failed[].name 上也一樣。
  // 級聯刪除（群組內素材一併永久刪除）前的那份名單是最後一道防線，不能只剩 id。
  //
  // 不用清：查得到就是好事，而被刪掉的 id 之後不會再被查（removeGroup +
  // refreshGroups 之後它不會再出現在任何勾選裡）。上限是 tenant 的群組數。
  const groupNameCache = useRef(new Map<string, string>())
  const groupNameOf = useMemo(() => {
    // merge-on-change（而非每次 render 都掃）：只在 groups 換身分時付出成本。
    // 對同一份 cache 的寫入是冪等的，StrictMode 的雙次 render 也安全。
    const cache = groupNameCache.current
    for (const g of groups) if (g.name) cache.set(g.id, g.name)
    return (id: string) => cache.get(id) ?? id
  }, [groups])

  const chipCounts = useMemo(
    () => ({
      all: assets.length,
      Image: assets.filter((a) => a.assetType === 'Image').length,
      Video: assets.filter((a) => a.assetType === 'Video').length,
      Audio: assets.filter((a) => a.assetType === 'Audio').length,
    }),
    [assets],
  )

  const displayedAssets = useMemo(() => {
    if (typeFilter === 'all') return assets
    return assets.filter((a) => a.assetType === typeFilter)
  }, [assets, typeFilter])

  // Up to 12 thumbs shown in the batch-delete confirmation modal.
  const batchDeleteThumbs = useMemo(() => {
    if (!pendingBatchDelete) return []
    return pendingBatchDelete.slice(0, 12).map((id) => {
      const a = displayedAssets.find((x) => x.id === id)
      const apiType = a?.assetType ?? 'Image'
      return {
        label: apiType.toUpperCase(),
        kind: toUiAssetType(apiType),
      }
    })
  }, [pendingBatchDelete, displayedAssets])

  const batchDeleteSummary = useMemo(() => {
    if (!pendingBatchDelete) return ''
    const counts = { Image: 0, Video: 0, Audio: 0 }
    for (const id of pendingBatchDelete) {
      const a = displayedAssets.find((x) => x.id === id)
      if (a) counts[a.assetType]++
    }
    return [
      counts.Image && `${counts.Image} 圖`,
      counts.Video && `${counts.Video} 影`,
      counts.Audio && `${counts.Audio} 音`,
    ]
      .filter(Boolean)
      .join(' · ')
  }, [pendingBatchDelete, displayedAssets])

  // ── Fetchers ──
  // 重入序號：StrictMode 的 mount effect 雙觸發、或連點刪除，會讓兩次載入
  // 並發。交錯時晚到的 setGroups 會覆蓋新狀態（甚至復活剛刪掉的群組），所以
  // 只有最後一次啟動的 refresh 才准寫入。
  const refreshSeq = useRef(0)
  // 「目前有幾輪整份清單重載（refreshGroups 或 runGroupSearch）在途」的計數器
  // ——不是布林，因為 StrictMode 雙掛載、或重載與搜尋前後腳起跑，都可能讓兩輪
  // 同時在途，用計數器才能在「先完成的那輪」不會誤把旗標關掉。
  //
  // loadMoreGroups 起跑時會檢查這個計數器。單靠 seq 不夠：seq 只能偵測「已經
  // bump 過的」，擋不住「重載才剛起跑、都還沒 bump 完，load-more 就在同一輪
  // 搶跑」這個窗口——這時兩者持有同一個 seq，各自的 seq 檢查都會通過，
  // load-more 會用重載前殘留的 nextPageNumber 抓一頁，等重載把清單換掉之後才
  // append 上去，結果就是漏掉一整頁、或把不連續的兩段拼在一起。
  const listReloadDepth = useRef(0)

  /**
   * 群組清單的第 1 頁（無限捲動的起點）。舊的全量走訪（10 頁 burst）在此刪除：
   * 5,881 群組的帳戶會在第 6 頁撞上 AccountFlowLimitExceeded，而後面的頁碼
   * 使用者八成永遠不會捲到。第 2 頁起改由 `loadMoreGroups` 按需接上。
   *
   * 排序顯式送 CreateTime Desc：走訪刪除後這是唯一保證分頁全序的地方，
   * 不能仰賴伺服器未明載的預設（否則第 2 頁與第 1 頁會重疊或漏項）。
   */
  const refreshGroups = useCallback(async () => {
    const seq = ++refreshSeq.current
    listReloadDepth.current += 1
    setLoadingGroups(true)
    setError(null)
    try {
      const { items, page } = await listAssetGroups(
        {},
        { pageNumber: 1, pageSize: GROUP_PAGE_SIZE_MAX },
        { sortBy: 'CreateTime', sortOrder: 'Desc' },
      )
      if (seq !== refreshSeq.current) return // 過期：更新的一輪已接手
      // 重建（而非併入）：這是一輪全新的累積，舊的 id 不該擋掉重新回傳的項目。
      seenGroupIds.current = new Set(items.map((g) => g.id))
      setGroups(items)
      setGroupTotal(page.totalCount)
      setNextPageNumber(2)
      // 上一輪的載更多錯誤講的是一份剛被換掉的清單，留著就是對著不存在的
      // 捲動位置報錯。
      setLoadMoreError(null)
      // 累積清單重新接管畫面 → 搜尋結果不再顯示中。刻意放在成功分支（而非
      // 開頭）：第 1 頁失敗時 `groups` 原封不動 —— 那時畫面上仍是搜尋結果，
      // 清掉旗標等於重新開放無限捲動去接未過濾的下一頁，正是要擋的那件事。
      setActiveGroupQuery(null)
    } catch (e) {
      if (seq === refreshSeq.current) {
        setError(e instanceof Error ? e.message : 'Failed to load groups')
      }
    } finally {
      if (seq === refreshSeq.current) setLoadingGroups(false)
      // 無條件遞減（不綁 seq）：這一輪不管是不是過期、成功還是失敗，它的
      // 「在途」狀態都結束了。綁 seq 的話，一輪過期的重載會少扣一次，計數器
      // 卡在 >0，load-more 就永久打不開。
      listReloadDepth.current -= 1
    }
  }, [setGroups, setLoadingGroups, setActiveGroupQuery])

  /**
   * 接上下一頁（側欄捲近底部時觸發）。失敗只寫 `loadMoreError` —— 已載入的
   * 清單照常可用，錯誤以清單底部的行內重試列呈現（UI 是 Task 3），不去動
   * 會讓整頁翻成診斷畫面的 `error`。
   */
  // 在途旗標用 ref 而非 loadingMore state：捲動事件一個 frame 可以連發多次，
  // state 在同一個 tick 內讀到的都是舊值，兩次呼叫會各自過關、重複抓同一頁
  //（第二次 append 因 seen 全中而寫回空集，還會把第一次的成果蓋掉）。
  // state 留給 UI 渲染，守門靠 ref。
  const loadMoreInFlight = useRef(false)
  const loadMoreGroups = useCallback(async () => {
    if (loadMoreInFlight.current || !hasMoreGroups) return
    // 搜尋顯示中不接下一頁：那時 groups 是搜尋結果（≤100 筆），而
    // `hasMoreGroups` 算的是「累積 < 總數」，兩者拼起來就是「1 筆結果 + 未過濾
    // 的第 2 頁」這種對不上搜尋字的清單 —— 而伺服器搜尋模式下前端過濾是關的
    //（disableClientFilter），沒有東西會把多出來的列藏起來。sidebar 那邊
    // `hasMore` 也已被呼叫端算成 false，這裡是第二道（重試列、未來的呼叫端）。
    //
    // 讀 ref 不讀 state：runGroupSearch 在送出請求當下就同步寫入 ref（見那
    // 裡的註解），state 版本要等 React commit 完那次 re-render 才追上。兩者
    // 在一般操作下幾乎同時到，但 load-more 是由使用者滑鼠捲動觸發、與
    // React 的 render 週期沒有同步關係——讀 state 版本留了一個「search 已經
    // 送出、ref 已經是新查詢字，但這個 render 還沒 commit」的窗口，
    // 期間如果剛好有 scroll 事件命中，就會用舊的 activeGroupQuery（null）
    // 通過這道檢查，讓未過濾的下一頁接到搜尋結果上。
    if (activeGroupQueryRef.current !== null) return
    // 一輪整份清單重載（refreshGroups/runGroupSearch）在途時完全不准起跑：
    // 見 `listReloadDepth` 宣告處的窗口說明——這不是 seq 能擋的那種過期，
    // 是「重載都還沒 bump 完，load-more 就搶跑」那種同一輪誤判。
    if (listReloadDepth.current > 0) return
    // 刻意不 bump seq：載更多是「延續當前這一輪累積」而不是新的一輪。只捕捉
    // 當下的序號，重載/搜尋一 bump 就讓這次在途的 append 作廢。
    const seq = refreshSeq.current
    loadMoreInFlight.current = true
    setLoadingMore(true)
    try {
      const { items, page } = await listAssetGroups(
        {},
        { pageNumber: nextPageNumber, pageSize: GROUP_PAGE_SIZE_MAX },
        { sortBy: 'CreateTime', sortOrder: 'Desc' },
      )
      if (seq !== refreshSeq.current) return // 過期：清單已被重載/搜尋換掉
      const seen = seenGroupIds.current
      const fresh = items.filter((g) => !seen.has(g.id))
      for (const g of fresh) seen.add(g.id)
      // 讀 store 的即時清單而非閉包快照：seq 只擋會 bump 的路徑（重載/搜尋），
      // 單刪與批刪走 removeGroup、不 bump —— 在途期間拿舊快照 append 會把
      // 剛刪掉的群組復活。批刪一跑數秒、退避重試又拉長在途窗口，這不是理論案例。
      setGroups([...useAssetStore.getState().groups, ...fresh])
      setNextPageNumber(nextPageNumber + 1)
      setGroupTotal(page.totalCount) // 抓頁期間的增刪，順手校正
      setLoadMoreError(null)
    } catch (e) {
      if (seq === refreshSeq.current) {
        setLoadMoreError(e instanceof Error ? e.message : '載入更多群組失敗')
      }
    } finally {
      // 無條件解鎖：seq 過期代表這次 append 作廢，但「在途」也跟著結束了 ——
      // 綁上 seq 判斷的話，一次重載就會讓載更多永久卡在 loading。
      loadMoreInFlight.current = false
      setLoadingMore(false)
    }
  }, [hasMoreGroups, nextPageNumber, setGroups])

  const refreshAssets = useCallback(
    async (groupId: string | null, status: StatusFilter) => {
      if (!groupId) {
        setAssets([])
        return
      }
      setLoadingAssets(true)
      try {
        const { items } = await listAssets(
          {
            groupId,
            ...(status !== 'all' ? { statuses: [status] } : {}),
          },
          { pageNumber: 1, pageSize: 100 },
          { sortBy: 'CreateTime', sortOrder: 'Desc' },
        )
        setAssets(items)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load assets')
      } finally {
        setLoadingAssets(false)
      }
    },
    [setAssets, setLoadingAssets],
  )

  // refreshGroupCount（含每 groupId 的請求序號保護）現在是 api/asset.ts 的
  // 匯出函式，不再是這個元件的 local useCallback —— useAssetUpload.ts 的
  // 上傳收尾也要呼叫同一份，序號保護若各自持有一份 ref，兩邊互相看不到
  // 對方的在途請求，形同沒有保護（上傳併發 5 個到同一群組時尤其會撞見）。

  /**
   * 跑一次伺服器端 Name 搜尋，讓結果整批接管清單。debounce 後的搜尋與批刪
   * 收尾的「重跑當前查詢」共用這一份 —— 兩邊都要 bump seq、都要記下
   * `activeGroupQuery`，各寫一次遲早會漂移。
   */
  const runGroupSearch = useCallback(
    async (trimmed: string) => {
      // 與 refreshGroups 共用重入序號：搜尋同樣是一次「群組清單載入」。
      // 先 bump 再送請求，讓仍在途的初載/載更多失效 —— 否則稍後完成的
      // 那一頁會蓋掉（或接在）搜尋結果上，使用者剛搜到的群組又不見。
      const seq = ++refreshSeq.current
      setLoadingGroups(true)
      // 失敗時要還原成搜尋前的值，不是硬清成 null：這裡的 groups 尚未被換掉
      // （還是舊搜尋結果，或還是累積清單），旗標得照實反映畫面上是哪一種。
      const prevQuery = activeGroupQueryRef.current
      // 請求一送出就記帳，不等結果回來：在途這幾百毫秒清單即將被換掉，這時
      // 放行的載更多會拿著「已經作廢的累積」去抓下一頁，回來正好接在搜尋
      // 結果後面（seq 擋得住它寫入，但擋不住它多打一個請求）。
      setActiveGroupQuery(trimmed)
      // 清掉前一輪載入留下的橫幅（refreshGroups 的開頭也是這樣做的）：那份
      // 清單正要被搜尋結果整批換掉，留著就是對著一份已經不在畫面上的清單
      // 報錯。更要緊的是 error 非 null 會參與下方的整頁接管判斷，搜尋零筆時
      // 把 sidebar（含搜尋框）一起卸載。
      setError(null)
      // 同理的載更多錯誤：留著就是讓「載入更多失敗，點擊重試」掛在搜尋結果
      // 底下，講的卻是另一份清單的第 N 頁。
      setLoadMoreError(null)
      try {
        const { items } = await listAssetGroups(
          { name: trimmed },
          { pageNumber: 1, pageSize: 100 },
        )
        if (seq !== refreshSeq.current) return // 過期：更新的一輪已接手
        // counts 刻意不扇出（列上徽章已整個移除）：搜尋只打一次 API 就
        // 出結果。真正要看數量時點進群組即可（Task 5 的標題單發）。
        // 也刻意不動 groupTotal — 這裡的 totalCount 是「過濾後」的筆數，
        // 拿去更新會把 serverSearchMode 關掉，下一個按鍵就搜不動了。
        setGroups(items)
      } catch (e) {
        if (seq === refreshSeq.current) {
          // 還原而非清空：這次搜尋沒有換掉畫面上的 groups（還是 prevQuery
          // 代表的那份 —— null＝累積清單，或前一個搜尋字的結果），旗標要
          // 照實反映，不能停在剛剛樂觀寫入的 trimmed。停在 trimmed 上會讓
          // 載更多/批刪收尾之後對著累積清單去跑一個使用者從沒看過結果、
          // 早就失敗的查詢。
          setActiveGroupQuery(prevQuery)
          toast.error(e instanceof Error ? e.message : '群組搜尋失敗')
        }
      } finally {
        if (seq === refreshSeq.current) setLoadingGroups(false)
      }
    },
    [setGroups, setLoadingGroups, setActiveGroupQuery],
  )

  // 伺服器端搜尋（清單還沒捲完時的後盾）。debounce 300ms — 每個按鍵都打
  // ListAssetGroups 會直接吃掉 QPM 配額。非伺服器模式直接返回：清單已完整，
  // sidebar 的前端過濾即時且免費。
  const handleGroupQuery = useCallback(
    (q: string) => {
      if (!serverSearchMode) return
      if (groupSearchTimer.current) window.clearTimeout(groupSearchTimer.current)
      groupSearchTimer.current = window.setTimeout(() => {
        void (async () => {
          const trimmed = q.trim()
          // 清空搜尋 → 重載第 1 頁：seen 重建、nextPage 回到 2、groupTotal
          // 更新、activeGroupQuery 清掉 —— 累積清單與無限捲動一起回來。
          if (!trimmed) await refreshGroups()
          else await runGroupSearch(trimmed)
        })()
      }, 300)
    },
    [serverSearchMode, refreshGroups, runGroupSearch],
  )

  // 卸載時清掉待觸發的 debounce（否則會對已卸載的元件 setState）
  useEffect(
    () => () => {
      if (groupSearchTimer.current) window.clearTimeout(groupSearchTimer.current)
    },
    [],
  )

  useEffect(() => {
    refreshGroups()
  }, [refreshGroups])

  useEffect(() => {
    refreshAssets(selectedGroupId, statusFilter)
    setSelectedAssetId(null)
    setTypeFilter('all')
  }, [selectedGroupId, statusFilter, refreshAssets])

  // 選中群組的素材總數（spec §4.3）。刻意只吃 `selectedGroupId`，不吃
  // `statusFilter` —— 標題的數字是「這個群組裡有幾個素材」，與正在看哪個狀態
  // 無關，跟著篩選重跑只是白白多打 ListAssets。
  //
  // 初載自動選第一個、批刪把 selectedGroupId 修復到別的群組，走的都是同一條
  // 「selectedGroupId 變了」的路，所以那些時機不必各自接線。上傳/單刪/批刪
  // 後的既有 refreshGroupCount 呼叫點照舊（那些是「選取沒變但內容變了」）。
  //
  // effect body 只負責「把請求發出去」：唯一的狀態寫入是 refreshGroupCount
  // 裡的 setGroupCount，寫的是 store 動作而非 useState setter，
  // react-hooks/set-state-in-effect 沒有東西可抓（實測：同一個 async 形狀換成
  // useState setter 一樣會被抓到——規則盯的是「setter 是誰」，不是「有沒有
  // await」）。`refreshGroupCount` 現在是 `api/asset.ts` 的匯出函式（模組層級
  // 的穩定參照），不需要、也不應該進 deps——它不是這個元件裡定義的值。
  //
  // 順序有意義：必須留在上面的 refreshAssets effect 之後。
  // assetLibraryPage.test.tsx 用的是 FIFO 的 fetch mock 佇列，這一發往前挪
  // 會吃掉 ListAssets 的 mock，讓一票看似無關的斷言（批刪、狀態切換……）
  // 一起變紅，卻完全看不出跟這個 effect 有關係。
  useEffect(() => {
    if (!selectedGroupId) return
    void refreshGroupCount(selectedGroupId)
  }, [selectedGroupId])

  // Background poller — flips Processing → Active/Failed without a manual refresh.
  useAssetStatusPoller(assets)

  // ── Handlers ──
  async function handleCreateGroup(input: {
    name: string
    description?: string
  }) {
    const out = await createAssetGroup(input)
    toast.success(`群組已建立：${input.name}`)
    await refreshGroups()
    selectGroup(out.id)
    return { id: out.id, name: input.name }
  }

  async function handleRenameGroup(
    g: AssetGroup,
    name: string,
    description?: string,
  ) {
    await updateAssetGroup(g.id, { name, description })
    toast.success('群組已更新')
    await refreshGroups()
  }

  function handleDeleteGroup(g: AssetGroup) {
    setPendingGroupDelete(g)
  }

  async function confirmGroupDelete() {
    const g = pendingGroupDelete
    if (!g) return
    try {
      await deleteAssetGroup(g.id)
      removeGroup(g.id)
      toast.success('群組已刪除')
      await refreshGroups()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setPendingGroupDelete(null)
    }
  }

  // Sidebar 的「刪除選取」→ 開啟 typed-confirm Modal；回傳的 Promise 讓
  // sidebar 知道結果（null = 取消保留勾選、failedIds = 失敗項留勾）。
  const requestGroupBatchDelete = useCallback(
    (ids: string[]) =>
      new Promise<{ failedIds: string[] } | null>((resolve) => {
        // 純防禦：今天到不了（sidebar 的 in-flight ref 讓同一時間只有一個
        // 請求在途）。但若前一個 pending 尚未解決就被這裡覆蓋，舊的 resolver
        // 會隨著 state 一起被丟掉 —— sidebar 那邊的 await 永遠不 settle，
        // in-flight 旗標卡在 true，刪除鈕從此按不動。以「取消」語意收斂舊的
        // promise（勾選原樣保留）再換上新的。
        pendingGroupBatch?.resolve(null)
        setPendingGroupBatch({ ids, resolve })
      }),
    [pendingGroupBatch],
  )

  async function runGroupBatchDelete(
    ids: string[],
  ): Promise<{ failedIds: string[] }> {
    const removed = new Set<string>()
    startDeleteJob(ids.length, 'group')
    await batchDelete(ids, {
      // DeleteAssetGroup 級聯刪素材、大群組耗時 — QPS 收斂到 4。
      deleteFn: deleteAssetGroup,
      qps: 4,
      // 走 cache 而非當前 groups：伺服器搜尋模式下先前搜尋勾到的群組不在
      // groups 裡，失敗清單只印 id 的話使用者無從判斷該不該重試。
      getName: groupNameOf,
      // store 的 removeGroup 會一併修復 selectedGroupId 與清 counts。
      onRemoved: (id) => {
        removed.add(id)
        removeGroup(id)
      },
      onProgress: (p) => patchDeleteJob(p),
    })
    // 收尾（spec §4.2）：搜尋顯示中就重跑那個查詢，否則重載第 1 頁。一律
    // refreshGroups 的話，剛在搜尋結果裡刪掉幾個群組的使用者會被丟回清單
    // 開頭 —— 同一輪還想刪的其餘項目得重打一次搜尋字才找得回來，而伺服器
    // 模式下多選本來就只能一次搜尋一個慢慢累積。
    //
    // 讀 ref 不讀 state：`runGroupBatchDelete` 是一般函式，被呼叫當下就把
    // 這個 render 的 closure 定住了。`batchDelete` 跑好幾秒（QPS 4 + 個別
    // 重試退避），期間元件會因進度更新而重渲染很多次，但這個 await 撐著
    // 的仍是最初那個 closure —— state 讀到的是「批刪開始那一刻」的搜尋字，
    // ref 讀到的才是「現在」。用 state 的話，批刪期間使用者換了搜尋字（或
    // 清空了搜尋），收尾會重跑一個搜尋框早就不顯示的查詢字，畫面對不上。
    const queryAtFinish = activeGroupQueryRef.current
    if (queryAtFinish !== null) await runGroupSearch(queryAtFinish)
    else await refreshGroups()
    // 回報「還在 ARK 上的」而非 result.failed — 共因錯誤（403/400）會中止整批，
    // 此時 failed[] 是空的但幾乎沒刪成，用 failed[] 會讓 sidebar 誤判全成功而
    // 清掉勾選。素材版的 performBatchDelete 同樣把 aborted 排除在 clearChecked
    // 之外。done 的情況兩者等價（沒被移除的就是重試耗盡的那些）。
    return { failedIds: ids.filter((id) => !removed.has(id)) }
  }

  async function confirmGroupBatchDelete() {
    const pending = pendingGroupBatch
    if (!pending) return
    setPendingGroupBatch(null)
    try {
      pending.resolve(await runGroupBatchDelete(pending.ids))
    } catch (e) {
      // 不預期會走到（batchDelete 自行吸收單項錯誤、refreshGroups 也自帶
      // catch）。但 resolver 一旦漏掉，sidebar 的 in-flight guard 會永久
      // 卡住刪除鈕、進度 toast 也會停在「刪除中」— 兩者都在這裡收斂。
      // 整批留勾供重試（無從得知哪幾個真的成功了）。
      patchDeleteJob({
        status: 'aborted',
        abortReason: e instanceof Error ? e.message : String(e),
      })
      pending.resolve({ failedIds: pending.ids })
    }
  }

  function handleDeleteAsset(a: Asset) {
    setSingleDeleteAsset(a)
  }

  async function confirmSingleDelete() {
    const a = singleDeleteAsset
    if (!a) return
    try {
      await deleteAsset(a.id)
      removeAsset(a.id)
      setSelectedAssetId((cur) => (cur === a.id ? null : cur))
      void refreshGroupCount(a.groupId)
      toast.success('資產已刪除')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSingleDeleteAsset(null)
    }
  }

  function requestBatchDelete(ids: string[]) {
    if (ids.length === 0) return
    // 素材批刪與群組批刪共用同一個 deleteJob slot，而群組批刪跑起來之後
    // 確認 Modal 就關了 —— 底部的素材 pill bar 這時是按得到的。若讓它起跑，
    // 兩個 job 會互相踩：終態記錄的是群組批次、kind 卻變成 asset，「重試
    // 失敗項」就把群組 id 送進 DeleteAsset（404 被當成冪等成功）→ 使用者
    // 看到「已刪除」但群組還在。store 的 startDeleteJob 有最後防線，但
    // 靜默 no-op 沒法解釋為什麼沒反應，所以在這裡明講。
    // （反向不需要擋：群組確認 Modal 開著時，它的遮罩蓋住了 pill bar。）
    if (deleteJob?.status === 'running') {
      toast.error('已有刪除工作進行中，請等待完成')
      return
    }
    setPendingBatchDelete(ids)
  }

  async function performBatchDelete(ids: string[]) {
    const nameOf = new Map(displayedAssets.map((a) => [a.id, a.name || a.id]))
    const affectedGroups = new Set(
      displayedAssets.filter((a) => ids.includes(a.id)).map((a) => a.groupId),
    )
    // Retry-failed path: ids may already be gone from displayedAssets, so
    // fall back to the active group to keep its sidebar count fresh.
    if (affectedGroups.size === 0 && selectedGroupId) {
      affectedGroups.add(selectedGroupId)
    }
    startDeleteJob(ids.length)
    const result = await batchDelete(ids, {
      getName: (id) => nameOf.get(id) ?? id,
      onRemoved: (id) => {
        removeAsset(id)
        setSelectedAssetId((cur) => (cur === id ? null : cur))
      },
      onProgress: (p) => patchDeleteJob(p),
    })
    for (const gid of affectedGroups) void refreshGroupCount(gid)
    // ToastProgress (driven by useAssetJobToasts) is now the single source of
    // progress truth; we no longer fire a separate toast.success/error here.
    // Selection is preserved on aborted/partial-fail so the user can retry.
    if (result.status !== 'aborted' && result.failed.length === 0) {
      clearChecked()
    }
  }

  async function handleRenameAsset(a: Asset, name: string) {
    await updateAsset(a.id, { name })
    const fresh = await getAsset(a.id)
    upsertAsset(fresh)
    toast.success('資產名稱已更新')
  }

  async function handleRefreshUrl(a: Asset) {
    const fresh = await getAsset(a.id)
    upsertAsset(fresh)
    toast.success('URL 已重新取得')
  }

  async function handleCopy(uri: string) {
    const ok = await copyToClipboard(uri)
    if (ok) toast.success('已複製到剪貼簿')
    else toast.error('複製失敗，請手動選取')
  }

  // Full-page takeover only when there is nothing to show (page-1 failure /
  // bad creds). A load-more failure still leaves the accumulated list on
  // screen, and blanking it would hide groups we did fetch — that case never
  // touches `error` at all (it goes to `loadMoreError`, spec §5).
  //
  // groupTotal === 0 是同一個「伺服器上真的一個群組都沒有」判準（素材區的
  // 「尚無群組」CTA 也用它）。少了它，伺服器搜尋模式下的空 groups 會被誤讀成
  // 「什麼都沒有」：搜尋零筆 → groups 為 [] → 只要手上還有一條錯誤（例如稍早
  // 的部分載入、或清空搜尋後全量重載第 1 頁失敗），整頁就翻成憑證診斷畫面、
  // 連同 sidebar 的搜尋框一起卸載 —— 使用者改搜尋字都做不到，只剩重新整理。
  if (error && groups.length === 0 && groupTotal === 0) {
    return (
      <div style={{ padding: 32, color: 'var(--error, #dc2626)' }}>
        <h3>無法連線到 ARK Asset API</h3>
        <p>{error}</p>
        <p style={{ color: 'var(--text-muted)' }}>
          請先在側邊面板「② 私有素材庫憑證」區塊填入並驗證後再使用。
          憑證驗證通過後重新整理此頁面。
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <AssetGroupSidebar
        groups={groups}
        selectedId={selectedGroupId}
        onSelect={selectGroup}
        onCreate={async (input) => {
          await handleCreateGroup(input)
        }}
        onRename={handleRenameGroup}
        onDelete={handleDeleteGroup}
        onBatchDelete={requestGroupBatchDelete}
        deleteBusy={deleteJob?.status === 'running'}
        // Group-list load error. It describes the *sidebar's* list, so the
        // sidebar renders it; non-blocking — the list below it stays usable.
        loadError={error}
        onQueryChange={handleGroupQuery}
        disableClientFilter={serverSearchMode}
        // 無限捲動的接線：sidebar 的 onScroll 與底部載入列吃這四個，
        // totalCount 只餵「已載入 N / M」的 M。
        //
        // 搜尋顯示中三態一起靜音（在呼叫端算，sidebar 不必知道有搜尋這回事）：
        // 那時 groups 是搜尋結果，「已載入 N / M」的 N 會變成命中筆數
        //（「已載入 1 / 1500」讀起來像清單只載到 1 筆；零筆時更會和「無符合
        // 群組」疊成自相矛盾的一對）。spinner 同理 —— 搜尋前起跑、此刻仍在途
        // 的那一頁已被 seq 作廢，它的轉圈不代表這份清單正在長。
        // 重試列則靠 runGroupSearch 開頭就把 loadMoreError 清掉（和
        // refreshGroups 一樣）；這裡一併擋是為了讓「搜尋顯示中 footer 不出聲」
        // 是版面上的結構保證，而不是要讀者順著 seq 推導一遍才敢相信。
        onLoadMore={() => void loadMoreGroups()}
        hasMore={activeGroupQuery === null && hasMoreGroups}
        loadingMore={activeGroupQuery === null && loadingMore}
        loadMoreError={activeGroupQuery === null ? loadMoreError : null}
        totalCount={groupTotal}
        width={sidebarWidth}
      />
      <ResizeHandle
        side="left"
        ariaLabel="拖曳調整群組欄寬度"
        getCurrentWidth={() => sidebarWidth}
        onResize={setSidebarWidth}
        resetWidth={ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH}
      />

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* page header — the group name is the page title (spec §A.1) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {selectedGroup && (
            <>
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {selectedGroup.name}
              </h2>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedGroupCountLabel} 個素材
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            disabled={!selectedGroupId || !tosReady}
            onClick={() => setShowUpload(true)}
            title={tosReady ? undefined : '請先設定物件儲存憑證'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              background: 'var(--accent)',
              color: '#fff',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              opacity: selectedGroupId && tosReady ? 1 : 0.5,
            }}
          >
            <Icon name="upload" size={14} />
            上傳素材
          </button>
        </div>

        {/* toolbar: 類型 chips + status dropdown in a single row (spec §A.2) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 20px',
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap',
            rowGap: 8,
          }}
        >
          {selectedGroupId ? (
            <>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                類型
              </span>
              <AssetTypeFilterChips
                counts={chipCounts}
                value={typeFilter}
                onChange={setTypeFilter}
              />
              <span
                aria-hidden
                style={{
                  width: 1,
                  height: 18,
                  background: 'var(--border)',
                }}
              />
              <AssetStatusFilterChips
                value={statusFilter}
                onChange={setStatusFilter}
              />
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              請從左側選擇一個群組
            </span>
          )}
        </div>

        {/* The partial-load banner used to sit here, but it describes the
            sidebar's group list, not this column — it now renders at the top
            of AssetGroupSidebar (`loadError` prop). */}

        {/* Batch-delete progress + upload progress render as
            react-hot-toast toasts driven by `useAssetJobToasts` above
            (spec §4.3). The fail-details modal lives further down. */}

        {/* grid */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* 條件是「伺服器上一個群組都沒有」而非「清單目前是空的」：
              伺服器端搜尋模式下零筆符合會把 groups 設成 []，那時要留在一般
              版面（sidebar 顯示「無符合群組」），不能誤導成空 tenant 而叫
              使用者去建立第一個群組。 */}
          {groups.length === 0 && groupTotal === 0 ? (
            <div style={{ padding: 64, textAlign: 'center' }}>
              <div style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
                尚無群組
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setPendingFirstGroup(true)}
              >
                建立第一個群組
              </button>
            </div>
          ) : (
            <AssetGrid
              assets={displayedAssets}
              loading={loadingAssets}
              selectedId={selectedAssetId}
              checkedIds={checkedIds}
              onToggleCheck={toggleChecked}
              onCopyUri={handleCopy}
              onSelect={(a) => setSelectedAssetId(a.id)}
            />
          )}
        </div>
      </main>

      {/* Mount the dialog only while open so first-mount state init
          replaces what used to be a reset-on-close effect (the
          react-hooks linter forbids setState-in-effect cleanup). */}
      {showUpload && (
        <AssetUploadDialog
          groups={groups}
          defaultGroupId={selectedGroupId}
          onClose={() => setShowUpload(false)}
          onUpload={async (inputs) => {
            // Fire-and-forget at the page level too —
            // startManyAssetUploads uses a global semaphore (max 5) and
            // each upload refreshes the affected group's count when it
            // settles, so we don't need to refetch lists on close.
            void startManyAssetUploads(inputs)
          }}
        />
      )}

      {/* Right resize handle is only rendered when the drawer is open
          (drawer itself short-circuits to null when no asset is selected). */}
      {previewAsset && (
        <ResizeHandle
          side="right"
          ariaLabel="拖曳調整詳細資料寬度"
          getCurrentWidth={() => drawerWidth}
          onResize={setDrawerWidth}
          resetWidth={ASSET_PREVIEW_DRAWER_DEFAULT_WIDTH}
        />
      )}
      <AssetPreviewDrawer
        asset={previewAsset}
        groupName={previewGroupName}
        onClose={() => setSelectedAssetId(null)}
        onRename={handleRenameAsset}
        onRefreshUrl={handleRefreshUrl}
        onCopyUri={handleCopy}
        onDelete={handleDeleteAsset}
        width={drawerWidth}
      />

      <ConfirmModal
        open={singleDeleteAsset !== null}
        title="刪除資產？"
        subtitle={singleDeleteAsset?.name || singleDeleteAsset?.id}
        thumbs={
          singleDeleteAsset
            ? [
                {
                  label: singleDeleteAsset.assetType.toUpperCase(),
                  kind: toUiAssetType(singleDeleteAsset.assetType),
                },
              ]
            : []
        }
        confirmLabel="刪除"
        variant="danger"
        onConfirm={() => void confirmSingleDelete()}
        onCancel={() => setSingleDeleteAsset(null)}
      />

      <ConfirmModal
        open={showFailDetails && (deleteJob?.failed.length ?? 0) > 0}
        title="刪除失敗"
        subtitle={`${deleteJob?.failed.length ?? 0} 個項目刪除失敗`}
        body={
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {deleteJob?.failed.map((f) => (
              <div
                key={f.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                }}
              >
                <span
                  title={f.id}
                  style={{
                    flex: 1,
                    fontFamily: 'ui-monospace, monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {f.name}
                </span>
                <span style={{ color: 'var(--danger)' }}>{f.reason}</span>
              </div>
            ))}
          </div>
        }
        confirmLabel="重試失敗項"
        variant="danger"
        onConfirm={() => {
          const ids = deleteJob?.failed.map((f) => f.id) ?? []
          setShowFailDetails(false)
          if (ids.length === 0) return
          // Retry path: user already confirmed once on the original batch
          // modal, so skip the batch-delete ConfirmModal and run directly.
          // Route by job kind — group ids must go through DeleteAssetGroup,
          // and DeleteAsset would just 404 on every one of them.
          if (deleteJob?.kind === 'group') void runGroupBatchDelete(ids)
          else void performBatchDelete(ids)
        }}
        onCancel={() => setShowFailDetails(false)}
      />

      <ConfirmModal
        open={pendingBatchDelete !== null}
        title={`刪除 ${pendingBatchDelete?.length ?? 0} 個 asset？`}
        subtitle={
          batchDeleteSummary
            ? `${batchDeleteSummary} · 此操作不可逆`
            : '此操作不可逆'
        }
        thumbs={batchDeleteThumbs}
        meta="將以 8 QPS 並行刪除"
        confirmLabel={`刪除 ${pendingBatchDelete?.length ?? 0} 個`}
        variant="danger"
        onConfirm={() => {
          const ids = pendingBatchDelete
          setPendingBatchDelete(null)
          if (ids) void performBatchDelete(ids)
        }}
        onCancel={() => setPendingBatchDelete(null)}
      />

      <ConfirmModal
        open={pendingGroupDelete !== null}
        title="刪除群組？"
        subtitle={
          pendingGroupDelete
            ? `「${pendingGroupDelete.name}」會級聯刪除組內所有資產，且不可復原。`
            : ''
        }
        typedConfirmation={
          pendingGroupDelete
            ? {
                requiredText: pendingGroupDelete.name,
                placeholder: '輸入群組名稱以確認',
              }
            : undefined
        }
        confirmLabel="刪除群組"
        variant="danger"
        onConfirm={() => void confirmGroupDelete()}
        onCancel={() => setPendingGroupDelete(null)}
      />

      <ConfirmModal
        open={pendingGroupBatch !== null}
        title={`刪除 ${pendingGroupBatch?.ids.length ?? 0} 個群組？`}
        subtitle="群組內所有素材將一併永久刪除，無法復原。"
        body={
          // 勾選刻意在搜尋過濾下保留（spec §4），所以使用者不一定看得到全部
          // 被勾的列 — 這份名單而非單一數字，才是誤刪前的最後一道防線。
          // 名稱查 groupNameOf（跨搜尋累積的 cache）而非當前 groups：伺服器
          // 搜尋模式下前一次搜尋勾到的群組已不在 groups 裡。
          <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 12 }}>
            <div
              style={{
                padding: '0 0 4px',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}
            >
              將刪除以下群組：
            </div>
            {(pendingGroupBatch?.ids ?? []).slice(0, 12).map((id) => (
              <div
                key={id}
                style={{ padding: '3px 0', color: 'var(--text-secondary)' }}
              >
                {groupNameOf(id)}
              </div>
            ))}
            {(pendingGroupBatch?.ids.length ?? 0) > 12 && (
              <div style={{ padding: '3px 0', color: 'var(--text-muted)' }}>
                …等共 {pendingGroupBatch?.ids.length} 個群組
              </div>
            )}
          </div>
        }
        typedConfirmation={{
          requiredText: '刪除',
          placeholder: '輸入「刪除」以確認',
        }}
        confirmLabel="永久刪除"
        variant="danger"
        onConfirm={() => void confirmGroupBatchDelete()}
        onCancel={() => {
          pendingGroupBatch?.resolve(null)
          setPendingGroupBatch(null)
        }}
      />

      <ConfirmModal
        open={pendingFirstGroup}
        title="建立第一個群組"
        subtitle="例如：my-assets"
        body={
          <input
            value={firstGroupName}
            onChange={(e) => setFirstGroupName(e.target.value)}
            placeholder="群組名稱"
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          />
        }
        confirmLabel="建立"
        variant="accent"
        onConfirm={async () => {
          const name = firstGroupName.trim()
          if (!name) return
          await handleCreateGroup({ name })
          setFirstGroupName('')
          setPendingFirstGroup(false)
        }}
        onCancel={() => {
          setFirstGroupName('')
          setPendingFirstGroup(false)
        }}
      />

      {/* Bottom-anchored floating selection bar — replaces inline strip
          per spec §4.3. Mounts at page level so it floats over the grid
          rather than competing with vertical space. */}
      <ActionPillBar
        show={checkedIds.size > 0}
        badge={
          <>
            已選{' '}
            <strong
              style={{
                color: '#fff',
                background: 'var(--accent)',
                padding: '0 6px',
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              {checkedIds.size}
            </strong>
          </>
        }
        actions={[
          {
            label: '全選本頁',
            onClick: () => checkPageRange(displayedAssets.map((a) => a.id)),
          },
          { label: '清除', onClick: clearChecked },
          {
            label: `刪除 ${checkedIds.size} 個`,
            onClick: () => requestBatchDelete([...checkedIds]),
            variant: 'danger',
          },
        ]}
      />
    </div>
  )
}
