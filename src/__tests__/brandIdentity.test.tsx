import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from '../components/layout/Header'
import { I18nProvider } from '../i18n/I18nProvider'

describe('DGen brand identity', () => {
  it('renders the DGen wordmark in the header without the legacy product name', () => {
    render(
      <MemoryRouter initialEntries={['/video']}>
        <I18nProvider initialLocale="zh-CN">
          <Header />
        </I18nProvider>
      </MemoryRouter>,
    )

    expect(screen.getByText('DGen')).toBeInTheDocument()
    expect(screen.queryByText('BytePlus AI Gen Platform')).not.toBeInTheDocument()
  })

  it('uses DGen metadata in index.html', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain('<title>DGen — AI Creative Studio</title>')
    expect(html).toContain('name="description"')
    expect(html).toContain('AI Creative Studio')
    expect(html).not.toContain('<title>BytePlus AI Gen Platform</title>')
  })

  it('uses a simple monochrome D favicon', () => {
    const svg = readFileSync(join(process.cwd(), 'public/favicon.svg'), 'utf8')
    expect(svg).toContain('>D<')
    expect(svg).not.toContain('#863bff')
    expect(svg).not.toContain('color(display-p3')
  })
})
