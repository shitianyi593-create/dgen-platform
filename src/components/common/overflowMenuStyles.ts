import type { CSSProperties } from 'react'
import { scaledFs } from '../../utils/panelScale'

// OverflowMenu 的樣式常數獨立成檔 — react-refresh 規則要求元件檔
// 只 export 元件（物件常數會破壞 HMR fast refresh）。

/** 選單項的統一樣式（handoff Interactions：項目 13px、刪除項 danger 色由呼叫端覆寫）。 */
export const overflowMenuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '6px 10px',
  background: 'none',
  border: 'none',
  borderRadius: 4,
  textAlign: 'left',
  fontSize: scaledFs(13),
  color: 'var(--text-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

/** 選單容器（絕對定位下拉）— 匯入小選單等同款下拉也可重用。 */
export const overflowMenuContainerStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '100%',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: 4,
  zIndex: 10,
  minWidth: 132,
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
}
