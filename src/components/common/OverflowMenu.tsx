import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { overflowMenuContainerStyle } from './overflowMenuStyles'

/**
 * ⋯（更多动作）overflow 选单 — 素材库侧栏 / 视频记录卡 / 图片记录卡共用。
 * trigger 是 24-26px 的 .icon-btn；开关 state 由组件自管，
 * 关闭时机：再点 trigger、item 呼叫 close()、Escape、鼠标离开、点击外侧。
 * item 由呼叫端以 render-prop 提供（样式用 overflowMenuItemStyle），
 * 让「点了不关」的项目（如图片页调试信息 toggle）自行决定是否 close()。
 */
interface OverflowMenuProps {
  /** trigger 的 aria-label；默认「更多动作」。 */
  ariaLabel?: string
  /** trigger 的 data-testid（沿用既有 group-overflow-${id} 等）。 */
  testId?: string
  /** trigger 尺寸（宽=高），默认 26。 */
  triggerSize?: number
  /** 附加 trigger 样式（如侧栏的 hover 才现形）；打开中会强制 opacity 1。 */
  triggerStyle?: CSSProperties
  /** trigger 获取键盘焦点时通知（侧栏用来让整列现形）。 */
  onTriggerFocus?: () => void
  /** 附加选单容器样式（如侧栏 right: 8）。 */
  menuStyle?: CSSProperties
  children: (close: () => void) => ReactNode
}

export default function OverflowMenu({
  ariaLabel = '更多动作',
  testId,
  triggerSize = 26,
  triggerStyle,
  onTriggerFocus,
  menuStyle,
  children,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点击组件外侧 → 关闭（打开中才挂 listener）。
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  return (
    <div
      ref={wrapRef}
      data-overflow-menu=""
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
    >
      <button
        type="button"
        className="icon-btn"
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={onTriggerFocus}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        style={{
          width: triggerSize,
          height: triggerSize,
          ...triggerStyle,
          ...(open ? { opacity: 1 } : {}),
        }}
      >
        <Icon name="more-horizontal" size={14} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ ...overflowMenuContainerStyle, ...menuStyle }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
