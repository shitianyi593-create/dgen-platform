import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('DGen design tokens', () => {
  it('defines PRD color tokens and compatibility aliases', () => {
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

    expect(tokens).toContain('--color-bg: #0A0A0B')
    expect(tokens).toContain('--color-surface: #141416')
    expect(tokens).toContain('--color-surface-raised: #1C1C1F')
    expect(tokens).toContain('--color-text: #F5F5F6')
    expect(tokens).toContain('--color-border: #303036')
    expect(tokens).toContain('--color-success: #36C98A')
    expect(tokens).toContain('--color-warning: #E3A43B')
    expect(tokens).toContain('--color-danger: #FF6B6B')

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
