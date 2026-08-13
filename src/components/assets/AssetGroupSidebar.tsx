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
 * 距底多少 px 開始抓下一頁。200 ≈ 五列的高度：夠早，滑順捲動時下一頁通常在
 * 使用者捲到底前就接上；又不會早到一進畫面就把後面幾頁全拉下來。
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
  /** 批次刪除。回傳 null = 使用者取消。 */
  onBatchDelete: (ids: string[]) => Promise<{ failedIds: string[] } | null>
  /** 刪除 job 進行中 — 禁用刪除鈕防重複觸發。 */
  deleteBusy?: boolean
  /**
   * 群組清單載入部分失敗時的橫幅文字（null = 不顯示）。
   * 橫幅講的是「這一欄的清單不完整」，所以掛在這裡而不是素材區。
   */
  loadError?: string | null
  /** 搜尋字串變更回報（伺服器端搜尋模式使用）。 */
  onQueryChange?: (q: string) => void
  /** true = 清單已由呼叫端過濾（伺服器端搜尋），前端不再過濾。 */
  disableClientFilter?: boolean
  // ── 無限捲動 ──
  /**
   * 捲近底部（或按下底部重試列）時請求下一頁。
   * 「搜尋顯示中不該載更多」的抑制在呼叫端（頁面知道目前的查詢字），
   * 這裡不重複判斷。
   */
  onLoadMore: () => void
  /** 還有未載入的群組（`已載入 < TotalCount`）。 */
  hasMore: boolean
  /** 下一頁請求在途。 */
  loadingMore: boolean
  /** 載更多失敗的訊息（null = 沒有）—— 走清單底部的行內重試列，不是全頁 error。 */
  loadMoreError: string | null
  /** 伺服器上的群組總數，供底部「已載入 N / M」的 M；N 直接用 `groups.length`。 */
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
  /** 批刪請求在途（含等待確認 Modal）— 防同一視窗內的連點重入。 */
  const batchDeleteInFlight = useRef(false)
  const toggleCheckedId = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // groups 換清單時修剪勾選：群組被別的路徑刪掉（單筆刪除、其他分頁的
  // 重新整理、批刪成功項）後，殘留的 id 會讓「刪除選取 (N)」虛胖，而那些列
  // 已不在畫面上、使用者無從個別取消。採 render 期間比對前次 props 的官方
  // 寫法（react.dev「You Might Not Need an Effect」），不用 useEffect —
  // 無多餘 commit，也不觸發 set-state-in-effect lint。
  // 注意：這裡刻意只吃 props.groups 的變動；搜尋過濾走的是下方的
  // visibleGroups，不影響 groups，所以「過濾不清勾選」的行為維持不變。
  //
  // disableClientFilter（伺服器端搜尋顯示中，或清單尚未捲完）下整段跳過：
  // 這時 props.groups 可能是「整批抽換的搜尋結果」（只有符合的那幾個，照修
  // 等於一搜尋就清空勾選，跟 client 模式的行為相反），也可能是「還沒抓完的
  // 累積前綴」（拿一份不完整的清單去判定「消失」，會誤刪還沒捲到、其實還在
  // 的勾選）——兩種情況都不該修剪。該模式下多選本來就只能靠一次搜尋 / 一次
  // 累積慢慢跟上。
  // 那伺服器模式下「群組真的被刪」誰來修剪？主要靠批刪自己：onBatchDelete 的
  // 結果直接把 checkedIds 設成「失敗項」（全成功則清空並退出管理模式），比對
  // 清單更精準。單列選單的刪除入口在管理模式下不渲染，離開管理模式又會清掉
  // 勾選。
  //
  // 已知的殘留來源（伺服器模式）：頁面上「刪除失敗」Modal 的「重試失敗項」
  // 直接呼叫 runGroupBatchDelete，結果被丟棄、沒有 resolver 通道回到這裡 ——
  // 重試成功的群組會留著勾。自癒路徑：下一次批刪帶上這些 id 會拿到 404，而
  // 404 在 batchDelete 裡算冪等成功（onRemoved 照樣觸發），該輪結束後勾選就被
  // 清掉了。
  // 代價（abort 語意）：殘留 id 若回的不是 404 而是 400/403 這類非暫時性錯誤，
  // batchDelete 會判定共因失敗而中止整批 —— 同批其餘群組一個都沒刪，勾選全數
  // 保留。可以再按一次重來（狀態沒壞），但要知道「一個殘留 id 擋得下整批」。
  //
  // 無限捲動的 append 也會觸發這個 effect（新陣列參考），但只有「這一頁剛好
  // 補滿、hasMoreGroups 翻假」那次會真的跑到上面的修剪——那個 render 裡
  // disableClientFilter 已經跟著翻 false。這時已載入的 id 一個都沒少，修剪
  // 跑完等於沒動，行為正確；成本是多建一個 Set（N 至多數千，可接受）。中途
  // 的 append（disableClientFilter 仍 true）不會跑到修剪，理由同上一段。
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

  // 模式翻轉時補發查詢。disableClientFilter 由呼叫端的 groupTotal 決定，而
  // groupTotal 要等第一次全量載入回來才有值 —— 在那之前它是 false，使用者提早
  // 打的字會被呼叫端的「非伺服器模式直接返回」吞掉。等載入完成翻成 true，下方
  // 的前端過濾同時被關掉：畫面上會是「完整清單配著一個非空的搜尋字」，看起來
  // 像搜尋壞了，而且要等使用者再敲一鍵才會恢復。翻轉當下補發一次，把這個窗口
  // 補起來。
  // 反向（true → false）不補發：那代表清單已完整，下方的前端過濾立刻生效。
  // 同樣採 render 期間比對前次 props（上方 syncedGroups 的寫法），不用 useEffect。
  // onQueryChange 在呼叫端是 debounce 的（只排一個 timer、不同步 setState），
  // 所以這裡呼叫它不會在 render 期間更新別的元件。
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
      // 無限捲動的觸發點。捲動中這個 handler 每幀都會跑，所以三個旗標先擋：
      // 已載完 / 已有請求在途 / 上一次失敗（失敗後停在底部不該無限重打同一個
      // 壞請求 —— 重試改由底部那列的點擊發動）。呼叫端另有 ref guard 讓重覆
      // 呼叫無害，但那是保險，不是這裡可以亂叫的理由。
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
      {/* 部分載入橫幅 — 講的是下方這份清單不完整，所以貼在清單頭上而不是
          素材區。非阻斷：已抓到的群組照常可用。不 sticky（會永久吃掉窄欄的
          垂直空間），捲動時隨清單捲走。 */}
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
            overflowWrap: 'anywhere', // 窄欄 + 伺服器錯誤訊息可能是長字串
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
          素材群組
        </span>
        <span
          style={{
            fontSize: scaledFs(10),
            fontWeight: 600,
            letterSpacing: 0.8,
            color: 'var(--text-muted)',
          }}
        >
          MODELARK
        </span>
        <button
          type="button"
          onClick={() => {
            setManageMode((v) => !v)
            // 離開管理模式時清掉勾選，避免下次進入沿用舊選取。
            if (manageMode) setCheckedIds(new Set())
            // 進入時關掉編輯中的表單 — 那一列不渲染 checkbox，
            // 但「全選」仍會收進它的 id，看不見卻選得到最危險。
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

      {/* sticky：清單無限捲動、群組數無上限，捲清單時搜尋框不該被捲走。
          外層包一層不透明 div 而非直接把 background 加在 input 上 —
          input 有自己的 --bg-input 底色，且下方 10px 間距要能擋住
          捲過去的列。offset 用 -16：sticky 的停靠邊是捲動容器的
          content box（會被 aside 的 16px padding 內縮），用 0 會在
          搜尋框上方留一條 16px 的縫讓列捲過去（headless Chrome 實測：
          -16 齊邊零裁切、0 漏 16px 帶）。 */}
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
          aria-label="搜尋群組"
          placeholder="搜尋群組…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onQueryChange?.(e.target.value)
          }}
        />
      </div>

      {/* 條件用「有輸入搜尋字」而非「groups 非空」：伺服器端搜尋模式
          （清單尚未載完）零筆符合時 groups 會被設成 []，此時仍該顯示
          「無符合群組」而不是讓頁面誤入「尚無群組」CTA。 */}
      {visibleGroups.length === 0 && query.trim() !== '' && (
        <div
          // 過濾把清單清空時，讀屏使用者也要知道
          role="status"
          style={{
            padding: '16px 8px',
            textAlign: 'center',
            fontSize: scaledFs(12),
            color: 'var(--text-muted)',
          }}
        >
          無符合群組
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
                  儲存
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
                aria-label={`選取 ${g.name}`}
                checked={checkedIds.has(g.id)}
                onChange={() => toggleCheckedId(g.id)}
                // 列本身已處理 toggle，不讓事件冒泡造成雙重切換
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
            {/* 逐群組的素材數徽章已移除：它要靠「每個群組一發 ListAssets」的
                扇出餵，群組上千時那就是打爆 QPM 的一半。改成只在主面板標題
                顯示「選中群組」的數字（spec §4.3）。 */}
            {/* 管理模式下隱藏單列選單 — 改名/單筆刪除入口與多選互斥 */}
            {!manageMode && (
              <OverflowMenu
                testId={`group-overflow-${g.id}`}
                ariaLabel="群組選項"
                triggerSize={24}
                // 鍵盤使用者：focus 也要現形（滑鼠靠 row hover 顯示）
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
                      刪除
                    </button>
                  </>
                )}
              </OverflowMenu>
            )}
          </div>
        )
      })}

      {/* 清單底部的載入狀態 — 緊貼最後一列（新列就長在這裡），非 sticky，
          兩種模式都顯示，位置在 sticky 操作列之上。三態互斥：
          載入中 → 轉圈；剛失敗 → 重試列；還有更多 → 進度小字；
          全部載完 → 什麼都不畫（清單結束本身就是訊息）。 */}
      {loadingMore ? (
        <div role="status" style={loadMoreRowStyle}>
          <span className="spinner" style={{ width: 12, height: 12 }} />
          載入中…
        </div>
      ) : loadMoreError ? (
        <button
          type="button"
          // 包一層而非直接傳 onLoadMore：後者會把 click event 當第一個引數
          // 送進一個宣告為無參數的 callback。
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
          載入更多失敗，點擊重試
        </button>
      ) : hasMore ? (
        // 單一字串（而非 `已載入 {n} / {m}`）—— 拆成多個 text node 的話
        // 讀屏會逐段念，測試也抓不到整句。
        // role="status" 與上方的載入中列同級：捲動接上新一頁時，看不見列數
        // 變多的使用者也要聽得到進度前進。
        <div role="status" style={loadMoreRowStyle}>{`已載入 ${groups.length} / ${totalCount}`}</div>
      ) : null}

      {/* 管理模式下隱藏建立入口 — 底部操作列取而代之 */}
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
            placeholder="群組名稱"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="input-field"
            placeholder="描述（選填）"
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
              建立
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
          建立新 Group
        </button>
      ))}

      {/* 底部操作列 — sticky 貼齊 aside 底部（負橫向 margin 讓列滿版；
          offset 用 -16 抵銷 aside 的 padding，理由同上方搜尋框——用 0
          會在列下方漏一條 16px 的縫）。 */}
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
            // 全選 = 把「目前可見」的群組併入勾選（搜尋過濾時不動已勾的隱藏項）
            onClick={() =>
              setCheckedIds((prev) => {
                const next = new Set(prev)
                for (const grp of visibleGroups) next.add(grp.id)
                return next
              })
            }
            style={{ ...ghostBtnStyle, flex: 1 }}
          >
            全選
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
              // deleteBusy 由父層的 job 狀態驅動，而 job 要等使用者在確認
              // Modal 上按下確認才會起跑 — 中間這段視窗內連點會開出第二個
              // Modal / 送出第二次請求。本地 in-flight 旗標補上這個缺口。
              if (batchDeleteInFlight.current) return
              batchDeleteInFlight.current = true
              try {
                const ids = [...checkedIds]
                const result = await onBatchDelete(ids)
                if (!result) return // 使用者取消 — 勾選原樣保留
                if (result.failedIds.length === 0) {
                  setCheckedIds(new Set())
                  setManageMode(false)
                } else {
                  setCheckedIds(new Set(result.failedIds)) // 留失敗項供重試
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
            刪除選取 ({checkedIds.size})
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

/** 清單底部三態共用的一列（spinner / 重試 / 進度）。 */
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
