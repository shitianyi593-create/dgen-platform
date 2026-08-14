import type { CSSProperties } from 'react'
import { scaledFs } from '../../utils/panelScale'

// OverflowMenu 的样式常数独立成档 — react-refresh 规则要求组件档
// 只 export 组件（对象常数会破坏 HMR fast refresh）。

/** 选单项的统一样式（handoff Interactions：项目 13px、删除项 danger 色由呼叫端覆写）。 */
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

/** 选单容器（绝对定位下拉）— 导入小选单等同款下拉也可重用。 */
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
