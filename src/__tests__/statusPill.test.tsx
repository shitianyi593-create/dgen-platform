/**
 * StatusPill component test
 *
 * 涵盖需求（handoff 全站共用改动 §2）：
 * - 统一胶囊样式：radius 999、11px、bg/bd/fg 用语意 tokens
 * - kind → token 对照：success / running / danger / warning / muted
 * - running 带 spinner（取代文字 ●）
 * - testId 透传
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import StatusPill from '../components/common/StatusPill'

afterEach(cleanup)

describe('StatusPill', () => {
  it('renders the label text', () => {
    render(<StatusPill kind="success" label="完成" />)
    expect(screen.getByText('完成')).toBeInTheDocument()
  })

  it.each([
    ['success', '--success-bg', '--success-bd', '--success'],
    ['danger', '--danger-bg', '--danger-bd', '--danger'],
    ['warning', '--warning-bg', '--warning-bd', '--warning'],
    ['running', '--accent-bg', '--accent-bd', '--accent'],
  ] as const)('kind=%s uses %s / %s / %s tokens', (kind, bg, bd, fg) => {
    render(<StatusPill kind={kind} label="x" testId="pill-under-test" />)
    const pill = screen.getByTestId('pill-under-test')
    const style = pill.getAttribute('style') ?? ''
    expect(style).toContain(`var(${bg})`)
    expect(style).toContain(`var(${bd})`)
    expect(style).toContain(`var(${fg})`)
  })

  it('kind=muted uses pend-bg with muted text', () => {
    render(<StatusPill kind="muted" label="排隊中" testId="pill-under-test" />)
    const style = screen.getByTestId('pill-under-test').getAttribute('style') ?? ''
    expect(style).toContain('var(--pend-bg)')
    expect(style).toContain('var(--text-muted)')
  })

  it('running kind shows a spinner instead of the ● character', () => {
    const { container } = render(<StatusPill kind="running" label="生成中" />)
    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(container.textContent).not.toContain('●')
  })

  it('non-running kinds have no spinner', () => {
    const { container } = render(<StatusPill kind="success" label="完成" />)
    expect(container.querySelector('.spinner')).toBeNull()
  })
})
