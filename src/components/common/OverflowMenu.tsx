import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { overflowMenuContainerStyle } from './overflowMenuStyles'

/**
 * ⋯（更多動作）overflow 選單 — 素材庫側欄 / 影片紀錄卡 / 圖片紀錄卡共用。
 * trigger 是 24-26px 的 .icon-btn；開關 state 由元件自管，
 * 關閉時機：再點 trigger、item 呼叫 close()、Escape、滑鼠離開、點擊外側。
 * item 由呼叫端以 render-prop 提供（樣式用 overflowMenuItemStyle），
 * 讓「點了不關」的項目（如圖片頁除錯資訊 toggle）自行決定是否 close()。
 */
interface OverflowMenuProps {
  /** trigger 的 aria-label；預設「更多動作」。 */
  ariaLabel?: string
  /** trigger 的 data-testid（沿用既有 group-overflow-${id} 等）。 */
  testId?: string
  /** trigger 尺寸（寬=高），預設 26。 */
  triggerSize?: number
  /** 附加 trigger 樣式（如側欄的 hover 才現形）；開啟中會強制 opacity 1。 */
  triggerStyle?: CSSProperties
  /** trigger 取得鍵盤焦點時通知（側欄用來讓整列現形）。 */
  onTriggerFocus?: () => void
  /** 附加選單容器樣式（如側欄 right: 8）。 */
  menuStyle?: CSSProperties
  children: (close: () => void) => ReactNode
}

export default function OverflowMenu({
  ariaLabel = '更多動作',
  testId,
  triggerSize = 26,
  triggerStyle,
  onTriggerFocus,
  menuStyle,
  children,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 點擊元件外側 → 關閉（開啟中才掛 listener）。
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
