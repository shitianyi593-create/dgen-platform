/**
 * OverflowMenu component test
 *
 * 涵盖需求（review 后续清理：三页 ⋯ 选单抽共用）：
 * - trigger：icon-btn、默认 aria-label 更多动作、aria-haspopup/aria-expanded
 * - 点 trigger 开/关；item 透过 close() 关闭
 * - Escape、鼠标离开、点击选单外侧都会关闭
 * - testId / ariaLabel / onTriggerFocus / triggerStyle 客制
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import OverflowMenu from '../components/common/OverflowMenu'
import { overflowMenuItemStyle } from '../components/common/overflowMenuStyles'

afterEach(cleanup)

function renderMenu(props: Partial<React.ComponentProps<typeof OverflowMenu>> = {}) {
  return render(
    <div>
      <button type="button">外面的按钮</button>
      <OverflowMenu {...props}>
        {(close) => (
          <>
            <button type="button" style={overflowMenuItemStyle} onClick={close}>
              动作一
            </button>
            <button type="button" style={overflowMenuItemStyle}>
              不关闭的动作
            </button>
          </>
        )}
      </OverflowMenu>
    </div>,
  )
}

describe('OverflowMenu', () => {
  it('renders a trigger with default aria-label 更多动作 and menu closed', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: '更多动作' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '动作一' })).toBeNull()
  })

  it('opens on trigger click and closes again on second click', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: '更多动作' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '动作一' })).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('button', { name: '动作一' })).toBeNull()
  })

  it('an item can close the menu via the close() callback', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多动作' }))
    fireEvent.click(screen.getByRole('button', { name: '动作一' }))
    expect(screen.queryByRole('button', { name: '动作一' })).toBeNull()
  })

  it('an item without close() keeps the menu open (调试信息 pattern)', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多动作' }))
    fireEvent.click(screen.getByRole('button', { name: '不关闭的动作' }))
    expect(screen.getByRole('button', { name: '不关闭的动作' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: '更多动作' })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '动作一' })).toBeNull()
  })

  it('closes when the pointer leaves the trigger+menu wrapper', () => {
    const { container } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多动作' }))
    const wrapper = container.querySelector('[data-overflow-menu]')!
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByRole('button', { name: '动作一' })).toBeNull()
  })

  it('closes on mousedown outside the component', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多动作' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: '外面的按钮' }))
    expect(screen.queryByRole('button', { name: '动作一' })).toBeNull()
  })

  it('does NOT close on mousedown inside the open menu', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '更多动作' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: '动作一' }))
    expect(screen.getByRole('button', { name: '动作一' })).toBeInTheDocument()
  })

  it('supports custom ariaLabel, testId and onTriggerFocus', () => {
    const onFocus = vi.fn()
    renderMenu({ ariaLabel: '群组选项', testId: 'group-overflow-g1', onTriggerFocus: onFocus })
    const trigger = screen.getByTestId('group-overflow-g1')
    expect(trigger).toHaveAccessibleName('群组选项')
    fireEvent.focus(trigger)
    expect(onFocus).toHaveBeenCalled()
  })

  it('forces trigger opacity 1 while open even if triggerStyle hides it', () => {
    renderMenu({ triggerStyle: { opacity: 0 } })
    const trigger = screen.getByRole('button', { name: '更多动作' })
    expect(trigger.style.opacity).toBe('0')
    fireEvent.click(trigger)
    expect(trigger.style.opacity).toBe('1')
  })
})
