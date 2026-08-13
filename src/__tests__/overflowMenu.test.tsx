/**
 * OverflowMenu component test
 *
 * 涵蓋需求（review 後續清理：三頁 ⋯ 選單抽共用）：
 * - trigger：icon-btn、預設 aria-label 更多動作、aria-haspopup/aria-expanded
 * - 點 trigger 開/關；item 透過 close() 關閉
 * - Escape、滑鼠離開、點擊選單外側都會關閉
 * - testId / ariaLabel / onTriggerFocus / triggerStyle 客製
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import OverflowMenu from '../components/common/OverflowMenu'
import { overflowMenuItemStyle } from '../components/common/overflowMenuStyles'

afterEach(cleanup)

function renderMenu(props: Partial<React.ComponentProps<typeof OverflowMenu>> = {}) {
  return render(
    <div>
      <button type="button">外面的按鈕</button>
      <OverflowMenu {...props}>
        {(close) => (
          <>
            <button type="button" style={overflowMenuItemStyle} onClick={close}>
              動作一
            </button>
            <button type="button" style={overflowMenuItemStyle}>
              不關閉的動作
            </button>
          </>
        )}
      </OverflowMenu>
    </div>,
  )
}

describe('OverflowMenu', () => {
  it('renders a trigger with default aria-label 更多動作 and menu closed', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: '更多動作' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '動作一' })).toBeNull()
  })

  it('opens on trigger click and closes again on second click', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: '更多動作' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '動作一' })).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('button', { name: '動作一' })).toBeNull()
  })

  it('an item can close the menu via the close() callback', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: '動作一' }))
    expect(screen.queryByRole('button', { name: '動作一' })).toBeNull()
  })

  it('an item without close() keeps the menu open (除錯資訊 pattern)', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: '不關閉的動作' }))
    expect(screen.getByRole('button', { name: '不關閉的動作' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: '更多動作' })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '動作一' })).toBeNull()
  })

  it('closes when the pointer leaves the trigger+menu wrapper', () => {
    const { container } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    const wrapper = container.querySelector('[data-overflow-menu]')!
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByRole('button', { name: '動作一' })).toBeNull()
  })

  it('closes on mousedown outside the component', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: '外面的按鈕' }))
    expect(screen.queryByRole('button', { name: '動作一' })).toBeNull()
  })

  it('does NOT close on mousedown inside the open menu', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: '動作一' }))
    expect(screen.getByRole('button', { name: '動作一' })).toBeInTheDocument()
  })

  it('supports custom ariaLabel, testId and onTriggerFocus', () => {
    const onFocus = vi.fn()
    renderMenu({ ariaLabel: '群組選項', testId: 'group-overflow-g1', onTriggerFocus: onFocus })
    const trigger = screen.getByTestId('group-overflow-g1')
    expect(trigger).toHaveAccessibleName('群組選項')
    fireEvent.focus(trigger)
    expect(onFocus).toHaveBeenCalled()
  })

  it('forces trigger opacity 1 while open even if triggerStyle hides it', () => {
    renderMenu({ triggerStyle: { opacity: 0 } })
    const trigger = screen.getByRole('button', { name: '更多動作' })
    expect(trigger.style.opacity).toBe('0')
    fireEvent.click(trigger)
    expect(trigger.style.opacity).toBe('1')
  })
})
