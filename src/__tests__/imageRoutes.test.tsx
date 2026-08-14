import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from '../components/layout/Header'
import ImageGenPage from '../components/image/ImageGenPage'
import { I18nProvider } from '../i18n/I18nProvider'

describe('Header tabs', () => {
  it('shows the 图片生成 tab between video and assets', () => {
    render(
      <MemoryRouter initialEntries={['/image']}>
        <I18nProvider initialLocale="zh-CN">
          <Header />
        </I18nProvider>
      </MemoryRouter>,
    )
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toContain('视频生成')
    expect(labels).toContain('图片生成')
    expect(labels).toContain('私有素材库管理')
  })
})

describe('ImageGenPage', () => {
  it('mounts all three panels', () => {
    render(<MemoryRouter initialEntries={['/image']}><ImageGenPage /></MemoryRouter>)
    expect(screen.getByText('模型版本')).toBeInTheDocument()   // ImageParams
    expect(screen.getByText(/尚未生成/)).toBeInTheDocument()    // ImagePreview（空状态）
    expect(screen.getByText('生成记录')).toBeInTheDocument()   // ImageHistory
  })
})
