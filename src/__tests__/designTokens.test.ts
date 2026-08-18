import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('DGen design tokens', () => {
  it('defines PRD color tokens and compatibility aliases', () => {
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

    expect(tokens).toContain('--color-bg: #080B12')
    expect(tokens).toContain('--color-surface: rgba(15, 23, 35, 0.88)')
    expect(tokens).toContain('--color-surface-raised: rgba(22, 34, 50, 0.92)')
    expect(tokens).toContain('--color-text: #F6FAFF')
    expect(tokens).toContain('--color-border: rgba(103, 132, 171, 0.28)')
    expect(tokens).toContain('--color-accent: #4FD7FF')
    expect(tokens).toContain('--color-accent-2: #7CFFCB')
    expect(tokens).toContain('--color-success: #49E6A2')
    expect(tokens).toContain('--color-warning: #F3C969')
    expect(tokens).toContain('--color-danger: #FF6F8F')

    expect(tokens).toContain('--bg-primary: var(--color-bg)')
    expect(tokens).toContain('--text-primary: var(--color-text)')
    expect(tokens).toContain('--border: var(--color-border)')
  })

  it('imports tokens before global component styles', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

    expect(css).toContain('@import "./styles/tokens.css";')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
