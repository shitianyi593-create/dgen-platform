import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from '../components/layout/Header'
import { I18N_STORAGE_KEY } from '../i18n/locales'
import { I18nProvider } from '../i18n/I18nProvider'

function renderHeader(initialLocale: 'zh-CN' | 'en-US' = 'zh-CN') {
  return render(
    <MemoryRouter initialEntries={['/video']}>
      <I18nProvider initialLocale={initialLocale}>
        <Header />
      </I18nProvider>
    </MemoryRouter>,
  )
}

describe('Header language switcher', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the five DGen nav items in Simplified Chinese', () => {
    renderHeader('zh-CN')

    expect(screen.getByRole('button', { name: '视频生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '视频生成 2.5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '图片生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文字生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '私有素材库管理' })).toBeInTheDocument()
  })

  it('switches Header navigation to English and persists the choice', () => {
    renderHeader('zh-CN')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }))

    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Video 2.5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Private Assets' })).toBeInTheDocument()
    expect(localStorage.getItem(I18N_STORAGE_KEY)).toBe('en-US')
  })
})
