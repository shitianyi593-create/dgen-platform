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
        <p>请先在侧栏面板「② 私有素材库凭证」区块填入并验证后使用。</p>
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
  // Sidebar 的「删除选择」与它的确认 Modal 之间的橋樑：resolve 一路带回
  // sidebar，让它知道该清勾选（成功）、留失败项、还是原样保留（取消）。
  const [pendingGroupBatch, setPendingGroupBatch] = useState<{
    ids: string[]
    resolve: (r: { failedIds: string[] } | null) => void
  } | null>(null)
  // ── 群组清单的分页累積状态（spec §3）──
  // 服务器回报的群组总数（不是 groups.length — 那是「目前累積到的」）。
  const [groupTotal, setGroupTotal] = useState(0)
  /** 下一次「载更多」要抓的页码；初载成功后是 2。 */
  const [nextPageNumber, setNextPageNumber] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 载更多失败的消息 —— 刻意不并进全页 `error`（已加载的清单照常可用）。 */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  // 已累積的群组 id。Desc 排序下抓页期间若有群组被创建，视窗整个往下位移，
  // 页尾项目会在下一页重复返回 —— append 前逐项比对，避免 React duplicate
  // key 与管理模式的勾选数错亂。
  const seenGroupIds = useRef<Set<string>>(new Set())
  const hasMoreGroups = groups.length < groupTotal
  // 「已加载 < 总数」同时也是搜索门槛：前端手上的清单不完整时，搜索必须改走
  // 服务器端 Name 过滤，否则搜不到还没滚到的那些群组。刻意写成别名而非重复
  // 一次表达式 —— 两者语意上绑定，不该各自漂移。
  const serverSearchMode = hasMoreGroups
  /**
   * 目前劫持著清单的服务器端查询字（null = 画面上是累積清单）。
   * 不变式：非 null ⟹ `groups` 装的是一次搜索的结果（反向不保证 —— 搜索失败时
   * `groups` 仍是累積清单，此时旗标刻意维持非 null，见下）。
   * 三个消费者：载更多互斥、底部 footer 静音、批删收尾要重跑哪个查询。
   *
   * 刻意不吃 sidebar 每个按键的 `onQueryChange`：那时 debounce 还没到期、清单
   * 也还没被换掉，此刻停掉无限滚动只会让「打字打到一半顺手滚一下」失效。
   * 写入/还原时机见 `runGroupSearch`，清除见 `refreshGroups`。
   *
   * 读哪一份看消费者是谁：footer 静音是 render-time 的 JSX prop 计算，
   * 必须读下面这个 state（ref 改变不会触发 re-render，UI 不会跟著更新）；
   * 载更多互斥（`loadMoreGroups`）与批删收尾（`runGroupBatchDelete`）都是
   * 事件触发的非同步守门，必须读 `activeGroupQueryRef`——state 要等 React
   * commit 完那次 re-render 才追上，这两个消费者的触发时机（用户滚动、
   * batchDelete 的 await 链）都跟 render 周期没有同步关系，留读 state 会
   * 开一个「已经送出新查询、还没 commit」的窗口。
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
   * 主面板标题旁的素材数（spec §4.3）。读 `groupCounts`（服务器端的群组总数）
   * 而非 `assets.length` —— 后者只是「这次载进来的那一页」，上限 100 且会被
   * 状态筛选缩小，大群组的标题会永远停在「100 个素材」，而换一下状态筛选数字
   * 就跳动。列上的逐群组徽章已随 count 扇出删除，选中这一个是唯一还会发
   * `countAssetsInGroup` 的地方。
   *
   * undefined（还没回来、或那一发被吞掉的失败）→ '—'，不退化成 0：空群组与
   * 「还不知道」在画面上必须分得出来，否则用户会以为素材没上传成功。
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

  // 跨清单抽换累積的 id → 名称缓存。
  //
  // 服务器端搜索模式（清单尚未载完）下 `groups` 是「这次搜索的可见清单」而非现存
  // 群组的全集，而该模式下的多选本来就只能靠一次搜索一个累積 —— 只查 `groups`
  // 的话，先前搜索勾到的群组在批删确认 Modal 上会退化成裸 id
  //（「将删除以下群组：g-0」），在 batchDelete 的 failed[].name 上也一样。
  // 级联删除（群组内素材一并永久删除）前的那份名单是最后一道防线，不能只剩 id。
  //
  // 不用清：查得到就是好事，而被删掉的 id 之后不会再被查（removeGroup +
  // refreshGroups 之后它不会再出现在任何勾选里）。上限是 tenant 的群组数。
  const groupNameCache = useRef(new Map<string, string>())
  const groupNameOf = useMemo(() => {
    // merge-on-change（而非每次 render 都扫）：只在 groups 换身分时付出成本。
    // 对同一份 cache 的写入是幂等的，StrictMode 的雙次 render 也安全。
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
      counts.Image && `${counts.Image} 图`,
      counts.Video && `${counts.Video} 影`,
      counts.Audio && `${counts.Audio} 音`,
    ]
      .filter(Boolean)
      .join(' · ')
  }, [pendingBatchDelete, displayedAssets])

  // ── Fetchers ──
  // 重入序号：StrictMode 的 mount effect 雙触发、或连点删除，会让两次加载
  // 并发。交错时晚到的 setGroups 会覆盖新状态（甚至复活刚删掉的群组），所以
  // 只有最后一次启动的 refresh 才准写入。
  const refreshSeq = useRef(0)
  // 「目前有几轮整份清单重载（refreshGroups 或 runGroupSearch）在途」的计数器
  // ——不是布林，因为 StrictMode 雙挂载、或重载与搜索前后腳起跑，都可能让两轮
  // 同时在途，用计数器才能在「先完成的那轮」不会误把旗标关掉。
  //
  // loadMoreGroups 起跑时会检查这个计数器。单靠 seq 不够：seq 只能侦测「已经
  // bump 过的」，挡不住「重载才刚起跑、都还没 bump 完，load-more 就在同一轮
  // 搶跑」这个窗口——这时两者持有同一个 seq，各自的 seq 检查都会通过，
  // load-more 会用重载前残留的 nextPageNumber 抓一页，等重载把清单换掉之后才
  // append 上去，结果就是漏掉一整页、或把不连续的两段拼在一起。
  const listReloadDepth = useRef(0)

  /**
   * 群组清单的第 1 页（无限滚动的起点）。旧的全量走訪（10 页 burst）在此删除：
   * 5,881 群组的账户会在第 6 页撞上 AccountFlowLimitExceeded，而后面的页码
   * 用户八成永远不会滚到。第 2 页起改由 `loadMoreGroups` 按需接上。
   *
   * 排序显式送 CreateTime Desc：走訪删除后这是唯一保证分页全序的地方，
   * 不能依赖服务器未明载的默认（否则第 2 页与第 1 页会重叠或漏项）。
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
      if (seq !== refreshSeq.current) return // 过期：更新的一轮已接手
      // 重建（而非并入）：这是一轮全新的累積，旧的 id 不该挡掉重新返回的项目。
      seenGroupIds.current = new Set(items.map((g) => g.id))
      setGroups(items)
      setGroupTotal(page.totalCount)
      setNextPageNumber(2)
      // 上一轮的载更多错误讲的是一份刚被换掉的清单，留着就是对著不存在的
      // 滚动位置报错。
      setLoadMoreError(null)
      // 累積清单重新接管画面 → 搜索结果不再显示中。刻意放在成功分支（而非
      // 开头）：第 1 页失败时 `groups` 原封不动 —— 那时画面上仍是搜索结果，
      // 清掉旗标等于重新开放无限滚动去接未过滤的下一页，正是要挡的那件事。
      setActiveGroupQuery(null)
    } catch (e) {
      if (seq === refreshSeq.current) {
        setError(e instanceof Error ? e.message : 'Failed to load groups')
      }
    } finally {
      if (seq === refreshSeq.current) setLoadingGroups(false)
      // 无条件递減（不绑 seq）：这一轮不管是不是过期、成功还是失败，它的
      // 「在途」状态都结束了。绑 seq 的话，一轮过期的重载会少扣一次，计数器
      // 卡在 >0，load-more 就永久打不开。
      listReloadDepth.current -= 1
    }
  }, [setGroups, setLoadingGroups, setActiveGroupQuery])

  /**
   * 接上下一页（侧栏滚近底部时触发）。失败只写 `loadMoreError` —— 已加载的
   * 清单照常可用，错误以清单底部的行内重试列呈现（UI 是 Task 3），不去动
   * 会让整页翻成诊断画面的 `error`。
   */
  // 在途旗标用 ref 而非 loadingMore state：滚动事件一个 frame 可以连发多次，
  // state 在同一个 tick 内读到的都是旧值，两次呼叫会各自过关、重复抓同一页
  //（第二次 append 因 seen 全中而写回空集，还会把第一次的成果盖掉）。
  // state 留给 UI 渲染，守门靠 ref。
  const loadMoreInFlight = useRef(false)
  const loadMoreGroups = useCallback(async () => {
    if (loadMoreInFlight.current || !hasMoreGroups) return
    // 搜索显示中不接下一页：那时 groups 是搜索结果（≤100 笔），而
    // `hasMoreGroups` 算的是「累積 < 总数」，两者拼起来就是「1 笔结果 + 未过滤
    // 的第 2 页」这種对不上搜索字的清单 —— 而服务器搜索模式下前端过滤是关的
    //（disableClientFilter），没有东西会把多出来的列藏起来。sidebar 那边
    // `hasMore` 也已被呼叫端算成 false，这里是第二道（重试列、未来的呼叫端）。
    //
    // 读 ref 不读 state：runGroupSearch 在送出请求当下就同步写入 ref（见那
    // 里的注解），state 版本要等 React commit 完那次 re-render 才追上。两者
    // 在一般操作下几乎同时到，但 load-more 是由用户鼠标滚动触发、与
    // React 的 render 周期没有同步关系——读 state 版本留了一个「search 已经
    // 送出、ref 已经是新查询字，但这个 render 还没 commit」的窗口，
    // 期间如果刚好有 scroll 事件命中，就会用旧的 activeGroupQuery（null）
    // 通过这道检查，让未过滤的下一页接到搜索结果上。
    if (activeGroupQueryRef.current !== null) return
    // 一轮整份清单重载（refreshGroups/runGroupSearch）在途时完全不准起跑：
    // 见 `listReloadDepth` 宣告处的窗口说明——这不是 seq 能挡的那種过期，
    // 是「重载都还没 bump 完，load-more 就搶跑」那種同一轮误判。
    if (listReloadDepth.current > 0) return
    // 刻意不 bump seq：载更多是「延续当前这一轮累積」而不是新的一轮。只捕捉
    // 当下的序号，重载/搜索一 bump 就让这次在途的 append 作废。
    const seq = refreshSeq.current
    loadMoreInFlight.current = true
    setLoadingMore(true)
    try {
      const { items, page } = await listAssetGroups(
        {},
        { pageNumber: nextPageNumber, pageSize: GROUP_PAGE_SIZE_MAX },
        { sortBy: 'CreateTime', sortOrder: 'Desc' },
      )
      if (seq !== refreshSeq.current) return // 过期：清单已被重载/搜索换掉
      const seen = seenGroupIds.current
      const fresh = items.filter((g) => !seen.has(g.id))
      for (const g of fresh) seen.add(g.id)
      // 读 store 的即时清单而非閉包快照：seq 只挡会 bump 的路径（重载/搜索），
      // 单删与批删走 removeGroup、不 bump —— 在途期间拿旧快照 append 会把
      // 刚删掉的群组复活。批删一跑数秒、退避重试又拉长在途窗口，这不是理论案例。
      setGroups([...useAssetStore.getState().groups, ...fresh])
      setNextPageNumber(nextPageNumber + 1)
      setGroupTotal(page.totalCount) // 抓页期间的增删，顺手校正
      setLoadMoreError(null)
    } catch (e) {
      if (seq === refreshSeq.current) {
        setLoadMoreError(e instanceof Error ? e.message : '加载更多群组失败')
      }
    } finally {
      // 无条件解锁：seq 过期代表这次 append 作废，但「在途」也跟著结束了 ——
      // 绑上 seq 判断的话，一次重载就会让载更多永久卡在 loading。
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

  // refreshGroupCount（含每 groupId 的请求序号保护）现在是 api/asset.ts 的
  // 导出函数，不再是这个组件的 local useCallback —— useAssetUpload.ts 的
  // 上传收尾也要呼叫同一份，序号保护若各自持有一份 ref，两边互相看不到
  // 对方的在途请求，形同没有保护（上传并发 5 个到同一群组时尤其会撞见）。

  /**
   * 跑一次服务器端 Name 搜索，让结果整批接管清单。debounce 后的搜索与批删
   * 收尾的「重跑当前查询」共用这一份 —— 两边都要 bump seq、都要记下
   * `activeGroupQuery`，各写一次迟早会漂移。
   */
  const runGroupSearch = useCallback(
    async (trimmed: string) => {
      // 与 refreshGroups 共用重入序号：搜索同样是一次「群组清单加载」。
      // 先 bump 再送请求，让仍在途的初载/载更多失效 —— 否则稍后完成的
      // 那一页会盖掉（或接在）搜索结果上，用户刚搜到的群组又不见。
      const seq = ++refreshSeq.current
      setLoadingGroups(true)
      // 失败时要还原成搜索前的值，不是硬清成 null：这里的 groups 尚未被换掉
      // （还是旧搜索结果，或还是累積清单），旗标得照实反映画面上是哪一種。
      const prevQuery = activeGroupQueryRef.current
      // 请求一送出就记账，不等结果回来：在途这几百毫秒清单即将被换掉，这时
      // 放行的载更多会拿著「已经作废的累積」去抓下一页，回来正好接在搜索
      // 结果后面（seq 挡得住它写入，但挡不住它多打一个请求）。
      setActiveGroupQuery(trimmed)
      // 清掉前一轮加载留下的横幅（refreshGroups 的开头也是这样做的）：那份
      // 清单正要被搜索结果整批换掉，留着就是对著一份已经不在画面上的清单
      // 报错。更要紧的是 error 非 null 会参与下方的整页接管判断，搜索零笔时
      // 把 sidebar（含搜索框）一起卸载。
      setError(null)
      // 同理的载更多错误：留着就是让「加载更多失败，点击重试」挂在搜索结果
      // 底下，讲的卻是另一份清单的第 N 页。
      setLoadMoreError(null)
      try {
        const { items } = await listAssetGroups(
          { name: trimmed },
          { pageNumber: 1, pageSize: 100 },
        )
        if (seq !== refreshSeq.current) return // 过期：更新的一轮已接手
        // counts 刻意不扇出（列上徽章已整个移除）：搜索只打一次 API 就
        // 出结果。真正要看数量时点进群组即可（Task 5 的标题单发）。
        // 也刻意不动 groupTotal — 这里的 totalCount 是「过滤后」的笔数，
        // 拿去更新会把 serverSearchMode 关掉，下一个按键就搜不动了。
        setGroups(items)
      } catch (e) {
        if (seq === refreshSeq.current) {
          // 还原而非清空：这次搜索没有换掉画面上的 groups（还是 prevQuery
          // 代表的那份 —— null＝累積清单，或前一个搜索字的结果），旗标要
          // 照实反映，不能停在刚刚乐观写入的 trimmed。停在 trimmed 上会让
          // 载更多/批删收尾之后对著累積清单去跑一个用户从没看过结果、
          // 早就失败的查询。
          setActiveGroupQuery(prevQuery)
          toast.error(e instanceof Error ? e.message : '群组搜索失败')
        }
      } finally {
        if (seq === refreshSeq.current) setLoadingGroups(false)
      }
    },
    [setGroups, setLoadingGroups, setActiveGroupQuery],
  )

  // 服务器端搜索（清单还没滚完时的后盾）。debounce 300ms — 每个按键都打
  // ListAssetGroups 会直接吃掉 QPM 配额。非服务器模式直接返回：清单已完整，
  // sidebar 的前端过滤即时且免费。
  const handleGroupQuery = useCallback(
    (q: string) => {
      if (!serverSearchMode) return
      if (groupSearchTimer.current) window.clearTimeout(groupSearchTimer.current)
      groupSearchTimer.current = window.setTimeout(() => {
        void (async () => {
          const trimmed = q.trim()
          // 清空搜索 → 重载第 1 页：seen 重建、nextPage 回到 2、groupTotal
          // 更新、activeGroupQuery 清掉 —— 累積清单与无限滚动一起回来。
          if (!trimmed) await refreshGroups()
          else await runGroupSearch(trimmed)
        })()
      }, 300)
    },
    [serverSearchMode, refreshGroups, runGroupSearch],
  )

  // 卸载时清掉待触发的 debounce（否则会对已卸载的组件 setState）
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

  // 选中群组的素材总数（spec §4.3）。刻意只吃 `selectedGroupId`，不吃
  // `statusFilter` —— 标题的数字是「这个群组里有几个素材」，与正在看哪个状态
  // 无关，跟著筛选重跑只是白白多打 ListAssets。
  //
  // 初载自动选第一个、批删把 selectedGroupId 修复到别的群组，走的都是同一条
  // 「selectedGroupId 变了」的路，所以那些时机不必各自接线。上传/单删/批删
  // 后的既有 refreshGroupCount 呼叫点照旧（那些是「选择没变但内容变了」）。
  //
  // effect body 只负责「把请求发出去」：唯一的状态写入是 refreshGroupCount
  // 里的 setGroupCount，写的是 store 动作而非 useState setter，
  // react-hooks/set-state-in-effect 没有东西可抓（实测：同一个 async 形状换成
  // useState setter 一样会被抓到——规则盯的是「setter 是谁」，不是「有没有
  // await」）。`refreshGroupCount` 现在是 `api/asset.ts` 的导出函数（模块层级
  // 的稳定参照），不需要、也不应该进 deps——它不是这个组件里定义的值。
  //
  // 顺序有意义：必须留在上面的 refreshAssets effect 之后。
  // assetLibraryPage.test.tsx 用的是 FIFO 的 fetch mock 队列，这一发往前挪
  // 会吃掉 ListAssets 的 mock，让一票看似无关的断言（批删、状态切换……）
  // 一起变红，卻完全看不出跟这个 effect 有关系。
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
    toast.success(`群组已创建：${input.name}`)
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
    toast.success('群组已更新')
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
      toast.success('群组已删除')
      await refreshGroups()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setPendingGroupDelete(null)
    }
  }

  // Sidebar 的「删除选择」→ 打开 typed-confirm Modal；返回的 Promise 让
  // sidebar 知道结果（null = 取消保留勾选、failedIds = 失败项留勾）。
  const requestGroupBatchDelete = useCallback(
    (ids: string[]) =>
      new Promise<{ failedIds: string[] } | null>((resolve) => {
        // 纯防御：今天到不了（sidebar 的 in-flight ref 让同一时间只有一个
        // 请求在途）。但若前一个 pending 尚未解决就被这里覆盖，旧的 resolver
        // 会随著 state 一起被丢掉 —— sidebar 那边的 await 永远不 settle，
        // in-flight 旗标卡在 true，删除钮从此按不动。以「取消」语意收敛旧的
        // promise（勾选原样保留）再换上新的。
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
      // DeleteAssetGroup 级联删素材、大群组耗时 — QPS 收敛到 4。
      deleteFn: deleteAssetGroup,
      qps: 4,
      // 走 cache 而非当前 groups：服务器搜索模式下先前搜索勾到的群组不在
      // groups 里，失败清单只印 id 的话用户无从判断该不该重试。
      getName: groupNameOf,
      // store 的 removeGroup 会一并修复 selectedGroupId 与清 counts。
      onRemoved: (id) => {
        removed.add(id)
        removeGroup(id)
      },
      onProgress: (p) => patchDeleteJob(p),
    })
    // 收尾（spec §4.2）：搜索显示中就重跑那个查询，否则重载第 1 页。一律
    // refreshGroups 的话，刚在搜索结果里删掉几个群组的用户会被丢回清单
    // 开头 —— 同一轮还想删的其余项目得重打一次搜索字才找得回来，而服务器
    // 模式下多选本来就只能一次搜索一个慢慢累積。
    //
    // 读 ref 不读 state：`runGroupBatchDelete` 是一般函数，被呼叫当下就把
    // 这个 render 的 closure 定住了。`batchDelete` 跑好几秒（QPS 4 + 个别
    // 重试退避），期间组件会因进度更新而重渲染很多次，但这个 await 撐著
    // 的仍是最初那个 closure —— state 读到的是「批删开始那一刻」的搜索字，
    // ref 读到的才是「现在」。用 state 的话，批删期间用户换了搜索字（或
    // 清空了搜索），收尾会重跑一个搜索框早就不显示的查询字，画面对不上。
    const queryAtFinish = activeGroupQueryRef.current
    if (queryAtFinish !== null) await runGroupSearch(queryAtFinish)
    else await refreshGroups()
    // 回报「还在 ARK 上的」而非 result.failed — 共因错误（403/400）会中止整批，
    // 此时 failed[] 是空的但几乎没删成，用 failed[] 会让 sidebar 误判全成功而
    // 清掉勾选。素材版的 performBatchDelete 同样把 aborted 排除在 clearChecked
    // 之外。done 的情况两者等价（没被移除的就是重试耗盡的那些）。
    return { failedIds: ids.filter((id) => !removed.has(id)) }
  }

  async function confirmGroupBatchDelete() {
    const pending = pendingGroupBatch
    if (!pending) return
    setPendingGroupBatch(null)
    try {
      pending.resolve(await runGroupBatchDelete(pending.ids))
    } catch (e) {
      // 不预期会走到（batchDelete 自行吸收单项错误、refreshGroups 也自带
      // catch）。但 resolver 一旦漏掉，sidebar 的 in-flight guard 会永久
      // 卡住删除钮、进度 toast 也会停在「删除中」— 两者都在这里收敛。
      // 整批留勾供重试（无从得知哪几个真的成功了）。
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
      toast.success('资产已删除')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSingleDeleteAsset(null)
    }
  }

  function requestBatchDelete(ids: string[]) {
    if (ids.length === 0) return
    // 素材批删与群组批删共用同一个 deleteJob slot，而群组批删跑起来之后
    // 确认 Modal 就关了 —— 底部的素材 pill bar 这时是按得到的。若让它起跑，
    // 两个 job 会互相踩：终态记录的是群组批次、kind 卻变成 asset，「重试
    // 失败项」就把群组 id 送进 DeleteAsset（404 被当成幂等成功）→ 用户
    // 看到「已删除」但群组还在。store 的 startDeleteJob 有最后防线，但
    // 静默 no-op 没法解释为什么没反应，所以在这里明讲。
    // （反向不需要挡：群组确认 Modal 开著时，它的遮罩盖住了 pill bar。）
    if (deleteJob?.status === 'running') {
      toast.error('已有删除工作进行中，请等待完成')
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
    toast.success('资产名称已更新')
  }

  async function handleRefreshUrl(a: Asset) {
    const fresh = await getAsset(a.id)
    upsertAsset(fresh)
    toast.success('URL 已重新获取')
  }

  async function handleCopy(uri: string) {
    const ok = await copyToClipboard(uri)
    if (ok) toast.success('已复制到剪贴簿')
    else toast.error('复制失败，请手动选择')
  }

  // Full-page takeover only when there is nothing to show (page-1 failure /
  // bad creds). A load-more failure still leaves the accumulated list on
  // screen, and blanking it would hide groups we did fetch — that case never
  // touches `error` at all (it goes to `loadMoreError`, spec §5).
  //
  // groupTotal === 0 是同一个「服务器上真的一个群组都没有」判准（素材区的
  // 「尚无群组」CTA 也用它）。少了它，服务器搜索模式下的空 groups 会被误读成
  // 「什么都没有」：搜索零笔 → groups 为 [] → 只要手上还有一条错误（例如稍早
  // 的部分加载、或清空搜索后全量重载第 1 页失败），整页就翻成凭证诊断画面、
  // 连同 sidebar 的搜索框一起卸载 —— 用户改搜索字都做不到，只剩刷新。
  if (error && groups.length === 0 && groupTotal === 0) {
    return (
      <div style={{ padding: 32, color: 'var(--error, #dc2626)' }}>
        <h3>无法连接到素材库 API</h3>
        <p>{error}</p>
        <p style={{ color: 'var(--text-muted)' }}>
          请先在侧栏面板「② 私有素材库凭证」区块填入并验证后再使用。
          凭证验证通过后刷新此页面。
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
        // 无限滚动的接线：sidebar 的 onScroll 与底部加载列吃这四个，
        // totalCount 只喂「已加载 N / M」的 M。
        //
        // 搜索显示中三态一起静音（在呼叫端算，sidebar 不必知道有搜索这回事）：
        // 那时 groups 是搜索结果，「已加载 N / M」的 N 会变成命中笔数
        //（「已加载 1 / 1500」读起来像清单只载到 1 笔；零笔时更会和「没有匹配
        // 的群组」叠成自相矛盾的一对）。spinner 同理 —— 搜索前起跑、此刻仍在途
        // 的那一页已被 seq 作废，它的转圈不代表这份清单正在长。
        // 重试列则靠 runGroupSearch 开头就把 loadMoreError 清掉（和
        // refreshGroups 一样）；这里一并挡是为了让「搜索显示中 footer 不出声」
        // 是版面上的结构保证，而不是要读者顺著 seq 推导一遍才敢相信。
        onLoadMore={() => void loadMoreGroups()}
        hasMore={activeGroupQuery === null && hasMoreGroups}
        loadingMore={activeGroupQuery === null && loadingMore}
        loadMoreError={activeGroupQuery === null ? loadMoreError : null}
        totalCount={groupTotal}
        width={sidebarWidth}
      />
      <ResizeHandle
        side="left"
        ariaLabel="拖拽调整群组栏宽度"
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
                {selectedGroupCountLabel} 个素材
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            disabled={!selectedGroupId || !tosReady}
            onClick={() => setShowUpload(true)}
            title={tosReady ? undefined : '请先设置对象存储凭证'}
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
            上传素材
          </button>
        </div>

        {/* toolbar: 类型 chips + status dropdown in a single row (spec §A.2) */}
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
                类型
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
              请从左侧选择一个群组
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
          {/* 条件是「服务器上一个群组都没有」而非「清单目前是空的」：
              服务器端搜索模式下零笔匹配会把 groups 设成 []，那时要留在一般
              版面（sidebar 显示「没有匹配的群组」），不能误导成空 tenant 而叫
              用户去创建第一个群组。 */}
          {groups.length === 0 && groupTotal === 0 ? (
            <div style={{ padding: 64, textAlign: 'center' }}>
              <div style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
                尚无群组
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setPendingFirstGroup(true)}
              >
                创建第一个群组
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
          ariaLabel="拖拽调整详细数据宽度"
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
        title="删除资产？"
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
        confirmLabel="删除"
        variant="danger"
        onConfirm={() => void confirmSingleDelete()}
        onCancel={() => setSingleDeleteAsset(null)}
      />

      <ConfirmModal
        open={showFailDetails && (deleteJob?.failed.length ?? 0) > 0}
        title="删除失败"
        subtitle={`${deleteJob?.failed.length ?? 0} 个项目删除失败`}
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
        confirmLabel="重试失败项"
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
        title={`删除 ${pendingBatchDelete?.length ?? 0} 个 asset？`}
        subtitle={
          batchDeleteSummary
            ? `${batchDeleteSummary} · 此操作不可逆`
            : '此操作不可逆'
        }
        thumbs={batchDeleteThumbs}
        meta="将以 8 QPS 并行删除"
        confirmLabel={`删除 ${pendingBatchDelete?.length ?? 0} 个`}
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
        title="删除群组？"
        subtitle={
          pendingGroupDelete
            ? `「${pendingGroupDelete.name}」会级联删除组内所有资产，且不可恢复。`
            : ''
        }
        typedConfirmation={
          pendingGroupDelete
            ? {
                requiredText: pendingGroupDelete.name,
                placeholder: '输入群组名称以确认',
              }
            : undefined
        }
        confirmLabel="删除群组"
        variant="danger"
        onConfirm={() => void confirmGroupDelete()}
        onCancel={() => setPendingGroupDelete(null)}
      />

      <ConfirmModal
        open={pendingGroupBatch !== null}
        title={`删除 ${pendingGroupBatch?.ids.length ?? 0} 个群组？`}
        subtitle="群组内所有素材将一并永久删除，无法恢复。"
        body={
          // 勾选刻意在搜索过滤下保留（spec §4），所以用户不一定看得到全部
          // 被勾的列 — 这份名单而非单一数字，才是误删前的最后一道防线。
          // 名称查 groupNameOf（跨搜索累積的 cache）而非当前 groups：服务器
          // 搜索模式下前一次搜索勾到的群组已不在 groups 里。
          <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 12 }}>
            <div
              style={{
                padding: '0 0 4px',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}
            >
              将删除以下群组：
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
                …等共 {pendingGroupBatch?.ids.length} 个群组
              </div>
            )}
          </div>
        }
        typedConfirmation={{
          requiredText: '删除',
          placeholder: '输入「删除」以确认',
        }}
        confirmLabel="永久删除"
        variant="danger"
        onConfirm={() => void confirmGroupBatchDelete()}
        onCancel={() => {
          pendingGroupBatch?.resolve(null)
          setPendingGroupBatch(null)
        }}
      />

      <ConfirmModal
        open={pendingFirstGroup}
        title="创建第一个群组"
        subtitle="例如：my-assets"
        body={
          <input
            value={firstGroupName}
            onChange={(e) => setFirstGroupName(e.target.value)}
            placeholder="群组名称"
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
        confirmLabel="创建"
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
            已选{' '}
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
            label: '全选本页',
            onClick: () => checkPageRange(displayedAssets.map((a) => a.id)),
          },
          { label: '清除', onClick: clearChecked },
          {
            label: `删除 ${checkedIds.size} 个`,
            onClick: () => requestBatchDelete([...checkedIds]),
            variant: 'danger',
          },
        ]}
      />
    </div>
  )
}
