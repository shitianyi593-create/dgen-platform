import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from '../components/layout/Header'
import ImageGenPage from '../components/image/ImageGenPage'

describe('Header tabs', () => {
  it('shows the 圖片生成 tab between video and assets', () => {
    render(<MemoryRouter initialEntries={['/image']}><Header /></MemoryRouter>)
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toContain('影片生成')
    expect(labels).toContain('圖片生成')
    expect(labels).toContain('私有素材庫管理')
  })
})

describe('ImageGenPage', () => {
  it('mounts all three panels', () => {
    render(<MemoryRouter initialEntries={['/image']}><ImageGenPage /></MemoryRouter>)
    expect(screen.getByText('模型版本')).toBeInTheDocument()   // ImageParams
    expect(screen.getByText(/尚未生成/)).toBeInTheDocument()    // ImagePreview（空狀態）
    expect(screen.getByText('生成紀錄')).toBeInTheDocument()   // ImageHistory
  })
})
