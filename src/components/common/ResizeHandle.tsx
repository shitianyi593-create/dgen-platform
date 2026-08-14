/**
 * Vertical splitter handle: 6px-wide hit area, 1px visual line, drag to
 * resize the sibling on `side` ('left' = adjust panel to my left,
 * 'right' = adjust panel to my right).
 *
 * The handle owns no width state of its own — it just emits `onResize(next)`
 * during pointer drag. Owning the value at the page level keeps the leaf
 * panels stateless and avoids prop-drill loops.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export interface ResizeHandleProps {
  /**
   * Which neighbouring panel this handle resizes.
   *  - 'left'  → drag right grows the panel on this handle's left side.
   *  - 'right' → drag right shrinks the panel on this handle's right side.
   */
  side: 'left' | 'right'
  /** Read the panel's current width when a drag begins. */
  getCurrentWidth: () => number
  /** Called on every committed pixel change while dragging. */
  onResize: (nextWidth: number) => void
  /** Optional double-click resets to this value (e.g. the panel default). */
  resetWidth?: number
  /** Visual hint label, also used for ARIA. */
  ariaLabel?: string
}

export default function ResizeHandle({
  side,
  getCurrentWidth,
  onResize,
  resetWidth,
  ariaLabel = '拖拽调整宽度',
}: ResizeHandleProps) {
  const [active, setActive] = useState(false)
  const [hover, setHover] = useState(false)

  // Keep latest values in refs so the pointermove listener — which is
  // attached once per drag — reads fresh data without re-binding.
  const onResizeRef = useRef(onResize)
  const getCurrentWidthRef = useRef(getCurrentWidth)
  useEffect(() => {
    onResizeRef.current = onResize
    getCurrentWidthRef.current = getCurrentWidth
  })

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore non-primary buttons (right-click, middle-click).
      if (e.button !== 0) return
      e.preventDefault()

      const startX = e.clientX
      const startWidth = getCurrentWidthRef.current()
      const sign = side === 'left' ? 1 : -1

      // Cursor + selection lock for the duration of the drag.
      const prevCursor = document.body.style.cursor
      const prevUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      setActive(true)

      let pendingFrame = 0
      let latestNext = startWidth

      const flush = () => {
        pendingFrame = 0
        onResizeRef.current(latestNext)
      }

      const handleMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX
        latestNext = startWidth + sign * delta
        if (pendingFrame === 0) {
          pendingFrame = window.requestAnimationFrame(flush)
        }
      }

      const handleUp = () => {
        if (pendingFrame !== 0) {
          window.cancelAnimationFrame(pendingFrame)
          pendingFrame = 0
        }
        // Final commit so the last pixel isn't dropped.
        onResizeRef.current(latestNext)
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevUserSelect
        setActive(false)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [side],
  )

  const handleDoubleClick = useCallback(() => {
    if (resetWidth != null) onResize(resetWidth)
  }, [resetWidth, onResize])

  // Keyboard nudges for accessibility — focused handle accepts ←/→.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const sign = side === 'left' ? 1 : -1
      const step = e.shiftKey ? 32 : 8
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        onResize(getCurrentWidth() + sign * step)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onResize(getCurrentWidth() - sign * step)
      }
    },
    [side, getCurrentWidth, onResize],
  )

  const showLine = active || hover
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onKeyDown={handleKeyDown}
      style={{
        ...handleStyle,
        background: showLine ? 'var(--accent)' : 'transparent',
      }}
    >
      {/* Inner 1px line so the hit area can stay 6px without showing a
          chunky stripe at rest. */}
      <div
        style={{
          width: 1,
          height: '100%',
          background: showLine ? 'transparent' : 'var(--border)',
          margin: '0 auto',
        }}
      />
    </div>
  )
}

const handleStyle: CSSProperties = {
  flex: '0 0 6px',
  width: 6,
  height: '100%',
  cursor: 'col-resize',
  alignSelf: 'stretch',
  // Soft transition only on the background colour change; size changes
  // happen on the panel siblings, not here.
  transition: 'background-color 0.15s ease',
  outline: 'none',
  // Avoid touch-scroll fighting with horizontal drag on touch devices.
  touchAction: 'none',
}
