import { useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AssetGroup } from '../../types/asset'
import { computePanelScale, scaledFs } from '../../utils/panelScale'
import { Icon } from '../common/icons'
import OverflowMenu from '../common/OverflowMenu'
import { overflowMenuItemStyle } from '../common/overflowMenuStyles'

/** Default width when no parent overrides — used as the scale=1 baseline. */
export const ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH = 260

/**
 * 距底多少 px 开始抓下一页。200 ≈ 五列的高度：够早，滑顺滚动时下一页通常在
 * 用户滚到底前就接上；又不会早到一进画面就把后面几页全拉下来。
 */
const LOAD_MORE_THRESHOLD_PX = 200

interface Props {
  groups: AssetGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (input: { name: string; description?: string }) => Promise<void>
  onRename: (
    group: AssetGroup,
    name: string,
    description?: string,
  ) => Promise<void>
  onDelete: (group: AssetGroup) => void
  /** 批量删除。返回 null = 用户取消。 */
  onBatchDelete: (ids: string[]) => Promise<{ failedIds: string[] } | null>
  /** 删除 job 进行中 — 禁用删除钮防重复触发。 */
  deleteBusy?: boolean
  /**
   * 群组清单加载部分失败时的横幅文字（null = 不显示）。
   * 横幅讲的是「这一栏的清单不完整」，所以挂在这里而不是素材区。
   */
  loadError?: string | null
  /** 搜索字符串变更回报（服务器端搜索模式使用）。 */
  onQueryChange?: (q: string) => void
  /** true = 清单已由呼叫端过滤（服务器端搜索），前端不再过滤。 */
  disableClientFilter?: boolean
  // ── 无限滚动 ──
  /**
   * 滚近底部（或按下底部重试列）时请求下一页。
   * 「搜索显示中不该载更多」的抑制在呼叫端（页面知道目前的查询字），
   * 这里不重复判断。
   */
  onLoadMore: () => void
  /** 还有未加载的群组（`已加载 < TotalCount`）。 */
  hasMore: boolean
  /** 下一页请求在途。 */
  loadingMore: boolean
  /** 载更多失败的消息（null = 没有）—— 走清单底部的行内重试列，不是全页 error。 */
  loadMoreError: string | null
  /** 服务器上的群组总数，供底部「已加载 N / M」的 M；N 直接用 `groups.length`。 */
  totalCount: number
  /** Optional override; falls back to ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH. */
  width?: number
}

export default function AssetGroupSidebar({
  groups,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onBatchDelete,
  deleteBusy,
  loadError,
  onQueryChange,
  disableClientFilter,
  onLoadMore,
  hasMore,
  loadingMore,
  loadMoreError,
  totalCount,
  width = ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [query, setQuery] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  /** 批删请求在途（含等待确认 Modal）— 防同一视窗内的连点重入。 */
  const batchDeleteInFlight = useRef(false)
  const toggleCheckedId = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // groups 换清单时修剪勾选：群组被别的路径删掉（单笔删除、其他分页的
  // 刷新、批删成功项）后，残留的 id 会让「删除选择 (N)」虚胖，而那些列
  // 已不在画面上、用户无从个别取消。采 render 期间比对前次 props 的官方
  // 写法（react.dev「You Might Not Need an Effect」），不用 useEffect —
  // 无多余 commit，也不触发 set-state-in-effect lint。
  // 注意：这里刻意只吃 props.groups 的变动；搜索过滤走的是下方的
  // visibleGroups，不影响 groups，所以「过滤不清勾选」的行为维持不变。
  //
  // disableClientFilter（服务器端搜索显示中，或清单尚未滚完）下整段跳过：
  // 这时 props.groups 可能是「整批抽换的搜索结果」（只有符合的那几个，照修
  // 等于一搜索就清空勾选，跟 client 模式的行为相反），也可能是「还没抓完的
  // 累積前缀」（拿一份不完整的清单去判定「消失」，会误删还没滚到、其实还在
  // 的勾选）——两種情况都不该修剪。该模式下多选本来就只能靠一次搜索 / 一次
  // 累積慢慢跟上。
  // 那服务器模式下「群组真的被删」谁来修剪？主要靠批删自己：onBatchDelete 的
  // 结果直接把 checkedIds 设成「失败项」（全成功则清空并退出管理模式），比对
  // 清单更精准。单列选单的删除入口在管理模式下不渲染，离开管理模式又会清掉
  // 勾选。
  //
  // 已知的残留来源（服务器模式）：页面上「删除失败」Modal 的「重试失败项」
  // 直接呼叫 runGroupBatchDelete，结果被丢弃、没有 resolver 通道回到这里 ——
  // 重试成功的群组会留着勾。自癒路径：下一次批删带上这些 id 会拿到 404，而
  // 404 在 batchDelete 里算幂等成功（onRemoved 照样触发），该轮结束后勾选就被
  // 清掉了。
  // 代价（abort 语意）：残留 id 若回的不是 404 而是 400/403 这类非暂时性错误，
  // batchDelete 会判定共因失败而中止整批 —— 同批其余群组一个都没删，勾选全数
  // 保留。可以再按一次重来（状态没坏），但要知道「一个残留 id 挡得下整批」。
  //
  // 无限滚动的 append 也会触发这个 effect（新阵列参考），但只有「这一页刚好
  // 补满、hasMoreGroups 翻假」那次会真的跑到上面的修剪——那个 render 里
  // disableClientFilter 已经跟著翻 false。这时已加载的 id 一个都没少，修剪
  // 跑完等于没动，行为正确；成本是多建一个 Set（N 至多数千，可接受）。中途
  // 的 append（disableClientFilter 仍 true）不会跑到修剪，理由同上一段。
  const [syncedGroups, setSyncedGroups] = useState(groups)
  if (syncedGroups !== groups) {
    setSyncedGroups(groups)
    if (!disableClientFilter) {
      setCheckedIds((prev) => {
        if (prev.size === 0) return prev
        const live = new Set(groups.map((grp) => grp.id))
        const next = new Set([...prev].filter((id) => live.has(id)))
        return next.size === prev.size ? prev : next
      })
    }
  }

  // 模式翻转时补发查询。disableClientFilter 由呼叫端的 groupTotal 决定，而
  // groupTotal 要等第一次全量加载回来才有值 —— 在那之前它是 false，用户提早
  // 打的字会被呼叫端的「非服务器模式直接返回」吞掉。等加载完成翻成 true，下方
  // 的前端过滤同时被关掉：画面上会是「完整清单配著一个非空的搜索字」，看起来
  // 像搜索坏了，而且要等用户再敲一键才会恢复。翻转当下补发一次，把这个窗口
  // 补起来。
  // 反向（true → false）不补发：那代表清单已完整，下方的前端过滤立刻生效。
  // 同样采 render 期间比对前次 props（上方 syncedGroups 的写法），不用 useEffect。
  // onQueryChange 在呼叫端是 debounce 的（只排一个 timer、不同步 setState），
  // 所以这里呼叫它不会在 render 期间更新别的组件。
  const [syncedFilterMode, setSyncedFilterMode] = useState(disableClientFilter)
  if (syncedFilterMode !== disableClientFilter) {
    setSyncedFilterMode(disableClientFilter)
    if (disableClientFilter && query.trim() !== '') onQueryChange?.(query)
  }

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || disableClientFilter) return groups
    return groups.filter((grp) => grp.name.toLowerCase().includes(q))
  }, [groups, query, disableClientFilter])

  async function submitCreate() {
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      await onCreate({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      })
      setCreating(false)
      setNewName('')
      setNewDesc('')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitRename(g: AssetGroup) {
    setSubmitting(true)
    try {
      await onRename(
        g,
        editName.trim() || g.name,
        editDesc.trim() || g.description,
      )
      setEditingId(null)
    } finally {
      setSubmitting(false)
    }
  }

  const panelScale = computePanelScale(width, ASSET_GROUP_SIDEBAR_DEFAULT_WIDTH)
  const asideStyle: CSSProperties = {
    width,
    flexShrink: 0,
    borderRight: '1px solid var(--border)',
    overflowY: 'auto',
    padding: '16px 12px',
    background: 'var(--bg-secondary)',
    ['--panel-scale' as unknown as keyof CSSProperties]: panelScale,
  } as CSSProperties

  return (
    <aside
      className="resizable-panel"
      style={asideStyle}
      // 无限滚动的触发点。滚动中这个 handler 每帧都会跑，所以三个旗标先挡：
      // 已载完 / 已有请求在途 / 上一次失败（失败后停在底部不该无限重打同一个
      // 坏请求 —— 重试改由底部那列的点击发动）。呼叫端另有 ref guard 让重覆
      // 呼叫无害，但那是保险，不是这里可以亂叫的理由。
      onScroll={(e) => {
        if (!hasMore || loadingMore || loadMoreError) return
        const el = e.currentTarget
        if (
          el.scrollHeight - el.scrollTop - el.clientHeight <
          LOAD_MORE_THRESHOLD_PX
        ) {
          onLoadMore()
        }
      }}
    >
      {/* 部分加载横幅 — 讲的是下方这份清单不完整，所以贴在清单头上而不是
          素材区。非阻断：已抓到的群组照常可用。不 sticky（会永久吃掉窄栏的
          垂直空间），滚动时随清单滚走。 */}
      {loadError && (
        <div
          role="alert"
          style={{
            margin: '0 0 10px',
            padding: '7px 9px',
            borderRadius: 6,
            border: '1px solid var(--danger-bd)',
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            fontSize: scaledFs(11),
            lineHeight: 1.45,
            overflowWrap: 'anywhere', // 窄栏 + 服务器错误消息可能是长字符串
          }}
        >
          {loadError}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: scaledFs(13),
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          素材群组
        </span>
        <span
          style={{
            fontSize: scaledFs(10),
            fontWeight: 600,
            letterSpacing: 0.8,
            color: 'var(--text-muted)',
          }}
        >
          DGEN
        </span>
        <button
          type="button"
          onClick={() => {
            setManageMode((v) => !v)
            // 离开管理模式时清掉勾选，避免下次进入沿用旧选择。
            if (manageMode) setCheckedIds(new Set())
            // 进入时关掉编辑中的表单 — 那一列不渲染 checkbox，
            // 但「全选」仍会收进它的 id，看不见卻选得到最危险。
            else setEditingId(null)
          }}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: scaledFs(12),
            fontWeight: 500,
            padding: 0,
          }}
        >
          {manageMode ? '完成' : '管理'}
        </button>
      </div>

      {/* sticky：清单无限滚动、群组数无上限，滚清单时搜索框不该被滚走。
          外层包一层不透明 div 而非直接把 background 加在 input 上 —
          input 有自己的 --bg-input 底色，且下方 10px 间距要能挡住
          滚过去的列。offset 用 -16：sticky 的停靠边是滚动容器的
          content box（会被 aside 的 16px padding 内缩），用 0 会在
          搜索框上方留一条 16px 的缝让列滚过去（headless Chrome 实测：
          -16 齐边零裁切、0 漏 16px 带）。 */}
      <div
        style={{
          position: 'sticky',
          top: -16,
          zIndex: 1,
          background: 'var(--bg-secondary)',
          paddingBottom: 10,
        }}
      >
        <input
          className="input-field"
          type="search"
          aria-label="搜索群组"
          placeholder="搜索群组…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onQueryChange?.(e.target.value)
          }}
        />
      </div>

      {/* 条件用「有输入搜索字」而非「groups 非空」：服务器端搜索模式
          （清单尚未载完）零笔匹配时 groups 会被设成 []，此时仍该显示
          「没有匹配的群组」而不是让页面误入「尚无群组」CTA。 */}
      {visibleGroups.length === 0 && query.trim() !== '' && (
        <div
          // 过滤把清单清空时，读屏用户也要知道
          role="status"
          style={{
            padding: '16px 8px',
            textAlign: 'center',
            fontSize: scaledFs(12),
            color: 'var(--text-muted)',
          }}
        >
          没有匹配的群组
        </div>
      )}

      {visibleGroups.map((g) => {
        const selected = g.id === selectedId
        if (editingId === g.id) {
          return (
            <div
              key={g.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginBottom: 8,
              }}
            >
              <input
                className="input-field"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <input
                className="input-field"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => submitRename(g)}
                  disabled={submitting}
                  style={{
                    ...accentBtnStyle,
                    flex: 1,
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  存储
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  style={{ ...ghostBtnStyle, flex: 1 }}
                >
                  取消
                </button>
              </div>
            </div>
          )
        }
        return (
          <div
            key={g.id}
            data-testid={`group-row-${g.id}`}
            aria-selected={selected}
            onClick={() => (manageMode ? toggleCheckedId(g.id) : onSelect(g.id))}
            onMouseEnter={() => setHoveredId(g.id)}
            onMouseLeave={() => setHoveredId((cur) => (cur === g.id ? null : cur))}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              marginBottom: 2,
              borderRadius: 6,
              cursor: 'pointer',
              background: selected
                ? 'var(--accent-bg)'
                : hoveredId === g.id
                  ? 'rgba(255,255,255,0.04)'
                  : 'transparent',
              color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {manageMode && (
              <input
                type="checkbox"
                aria-label={`选择 ${g.name}`}
                checked={checkedIds.has(g.id)}
                onChange={() => toggleCheckedId(g.id)}
                // 列本身已处理 toggle，不让事件冒泡造成雙重切换
                onClick={(e) => e.stopPropagation()}
                style={{ flexShrink: 0, cursor: 'pointer' }}
              />
            )}
            <Icon
              name="folder"
              size={16}
              stroke={selected ? 'var(--border-focus)' : 'currentColor'}
              style={{ flexShrink: 0, opacity: selected ? 1 : 0.7 }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: scaledFs(13),
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {g.name}
            </span>
            {/* 逐群组的素材数徽章已移除：它要靠「每个群组一发 ListAssets」的
                扇出喂，群组上千时那就是打爆 QPM 的一半。改成只在主面板标题
                显示「选中群组」的数字（spec §4.3）。 */}
            {/* 管理模式下隐藏单列选单 — 改名/单笔删除入口与多选互斥 */}
            {!manageMode && (
              <OverflowMenu
                testId={`group-overflow-${g.id}`}
                ariaLabel="群组选项"
                triggerSize={24}
                // 键盘用户：focus 也要现形（鼠标靠 row hover 显示）
                onTriggerFocus={() => setHoveredId(g.id)}
                triggerStyle={{
                  opacity: hoveredId === g.id ? 1 : 0,
                  transition: 'opacity 0.15s',
                }}
                menuStyle={{ minWidth: 120 }}
              >
                {(close) => (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(g.id)
                        setEditName(g.name)
                        setEditDesc(g.description ?? '')
                        close()
                      }}
                      style={overflowMenuItemStyle}
                    >
                      重新命名
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(g)
                        close()
                      }}
                      style={{
                        ...overflowMenuItemStyle,
                        color: 'var(--danger)',
                      }}
                    >
                      删除
                    </button>
                  </>
                )}
              </OverflowMenu>
            )}
          </div>
        )
      })}

      {/* 清单底部的加载状态 — 紧贴最后一列（新列就长在这里），非 sticky，
          两種模式都显示，位置在 sticky 操作列之上。三态互斥：
          加载中 → 转圈；刚失败 → 重试列；还有更多 → 进度小字；
          全部载完 → 什么都不畫（清单结束本身就是消息）。 */}
      {loadingMore ? (
        <div role="status" style={loadMoreRowStyle}>
          <span className="spinner" style={{ width: 12, height: 12 }} />
          加载中…
        </div>
      ) : loadMoreError ? (
        <button
          type="button"
          // 包一层而非直接传 onLoadMore：后者会把 click event 当第一个引数
          // 送进一个宣告为无参数的 callback。
          onClick={() => onLoadMore()}
          style={{
            ...loadMoreRowStyle,
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: 'var(--danger)',
            cursor: 'pointer',
          }}
        >
          加载更多失败，点击重试
        </button>
      ) : hasMore ? (
        // 单一字符串（而非 `已加载 {n} / {m}`）—— 拆成多个 text node 的话
        // 读屏会逐段念，测试也抓不到整句。
        // role="status" 与上方的加载中列同级：滚动接上新一页时，看不见列数
        // 变多的用户也要聽得到进度前进。
        <div role="status" style={loadMoreRowStyle}>{`已加载 ${groups.length} / ${totalCount}`}</div>
      ) : null}

      {/* 管理模式下隐藏创建入口 — 底部操作列取而代之 */}
      {!manageMode && (creating ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginTop: 12,
          }}
        >
          <input
            className="input-field"
            placeholder="群组名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="input-field"
            placeholder="描述（选填）"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={submitCreate}
              disabled={submitting}
              className="btn-primary"
              style={{ flex: 1 }}
            >
              创建
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              style={{ ...ghostBtnStyle, flex: 1 }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            marginTop: 10,
            padding: 9,
            border: '1px dashed var(--border)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: scaledFs(13),
            transition: 'border-color 0.15s, color 0.15s',
          }}
        >
          <Icon name="plus" size={14} />
          创建新群组
        </button>
      ))}

      {/* 底部操作列 — sticky 贴齐 aside 底部（负横向 margin 让列满版；
          offset 用 -16 抵銷 aside 的 padding，理由同上方搜索框——用 0
          会在列下方漏一条 16px 的缝）。 */}
      {manageMode && (
        <div
          style={{
            position: 'sticky',
            bottom: -16,
            margin: '10px -12px -16px',
            padding: '10px 12px',
            background: 'var(--bg-secondary)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 6,
          }}
        >
          <button
            type="button"
            // 全选 = 把「目前可见」的群组并入勾选（搜索过滤时不动已勾的隐藏项）
            onClick={() =>
              setCheckedIds((prev) => {
                const next = new Set(prev)
                for (const grp of visibleGroups) next.add(grp.id)
                return next
              })
            }
            style={{ ...ghostBtnStyle, flex: 1 }}
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => setCheckedIds(new Set())}
            style={{ ...ghostBtnStyle, flex: 1 }}
          >
            清除
          </button>
          <button
            type="button"
            disabled={checkedIds.size === 0 || deleteBusy}
            onClick={async () => {
              // deleteBusy 由父层的 job 状态驱动，而 job 要等用户在确认
              // Modal 上按下确认才会起跑 — 中间这段视窗内连点会开出第二个
              // Modal / 送出第二次请求。本地 in-flight 旗标补上这个缺口。
              if (batchDeleteInFlight.current) return
              batchDeleteInFlight.current = true
              try {
                const ids = [...checkedIds]
                const result = await onBatchDelete(ids)
                if (!result) return // 用户取消 — 勾选原样保留
                if (result.failedIds.length === 0) {
                  setCheckedIds(new Set())
                  setManageMode(false)
                } else {
                  setCheckedIds(new Set(result.failedIds)) // 留失败项供重试
                }
              } finally {
                batchDeleteInFlight.current = false
              }
            }}
            style={{
              ...accentBtnStyle,
              flex: 2,
              background: 'var(--danger)',
              opacity: checkedIds.size === 0 || deleteBusy ? 0.5 : 1,
              cursor:
                checkedIds.size === 0 || deleteBusy ? 'not-allowed' : 'pointer',
            }}
          >
            删除选择 ({checkedIds.size})
          </button>
        </div>
      )}
    </aside>
  )
}

const accentBtnStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: scaledFs(13),
  fontWeight: 500,
}

/** 清单底部三态共用的一列（spinner / 重试 / 进度）。 */
const loadMoreRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '10px 8px',
  fontSize: scaledFs(11),
  color: 'var(--text-muted)',
}

const ghostBtnStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-input)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: scaledFs(13),
}
