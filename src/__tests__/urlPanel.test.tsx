/**
 * UrlPanel component test
 *
 * 涵蓋需求（handoff 共用新元件 UrlPanel）：
 * - 每列：label + readonly URL 框 + 「複製」鈕（accessible name 恰為 複製）
 * - openable 列多一顆「開啟」連結（href = url、新分頁）
 * - row testId 透傳到列容器
 * - 底部 hint
 * - 點「複製」→ copyWithToast(label, url)
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import UrlPanel from '../components/common/UrlPanel'
import { copyWithToast } from '../utils/clipboard'

vi.mock('../utils/clipboard', () => ({
  copyWithToast: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UrlPanel', () => {
  it('renders one row per entry with label and readonly url box', () => {
    render(
      <UrlPanel
        rows={[
          { label: '影片', url: 'https://cdn/x.mp4', testId: 'video-url-row' },
          { label: '尾幀', url: 'https://cdn/y.png', testId: 'last-frame-url-row' },
        ]}
      />,
    )
    expect(screen.getByTestId('video-url-row')).toBeInTheDocument()
    expect(screen.getByTestId('last-frame-url-row')).toBeInTheDocument()
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    expect(inputs[0].value).toBe('https://cdn/x.mp4')
    expect(inputs[0]).toHaveAttribute('readonly')
    // a11y：readonly 框以列 label 作為 accessible name
    expect(screen.getByRole('textbox', { name: '影片' })).toBe(inputs[0])
  })

  it('each row has a copy button named exactly 複製; click copies via copyWithToast', () => {
    render(<UrlPanel rows={[{ label: '影片', url: 'https://cdn/x.mp4' }]} />)
    const btn = screen.getByRole('button', { name: '複製' })
    fireEvent.click(btn)
    expect(vi.mocked(copyWithToast)).toHaveBeenCalledWith('影片', 'https://cdn/x.mp4')
  })

  it('openable rows render an 開啟 link to the url in a new tab', () => {
    render(<UrlPanel rows={[{ label: '影片', url: 'https://cdn/x.mp4', openable: true }]} />)
    const link = screen.getByRole('link', { name: '開啟' })
    expect(link).toHaveAttribute('href', 'https://cdn/x.mp4')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('rows without openable render no link', () => {
    render(<UrlPanel rows={[{ label: '影片', url: 'https://cdn/x.mp4' }]} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders the hint text when provided', () => {
    render(<UrlPanel rows={[{ label: 'a', url: 'https://x' }]} hint="URL 24 小時後過期" />)
    expect(screen.getByText('URL 24 小時後過期')).toBeInTheDocument()
  })
})
