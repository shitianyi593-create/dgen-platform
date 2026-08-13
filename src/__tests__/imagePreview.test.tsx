import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ImagePreview from '../components/image/ImagePreview'
import { copyWithToast } from '../utils/clipboard'
import { useImageStore } from '../stores/imageStore'
import type { ImageHistoryItem } from '../types/image'

vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  copyWithToast: vi.fn(),
}))

function seed(entry: ImageHistoryItem) {
  useImageStore.setState({ history: [entry], currentEntryId: entry.id })
}
function base(over: Partial<ImageHistoryItem>): ImageHistoryItem {
  return {
    id: 'e1', status: 'succeeded', prompt: 'p', modelKey: 'seedream-5-0-pro',
    createdAt: Date.now() - 5000, images: [],
    params: { watermark: false, sequential: false, refFilenames: [], refUrls: [] },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useImageStore.setState(useImageStore.getInitialState(), true)
})

describe('ImagePreview', () => {
  it('empty state', () => {
    render(<ImagePreview />)
    expect(screen.getByText(/尚未生成/)).toBeInTheDocument()
  })
  it('generating: spinner + elapsed seconds', () => {
    seed(base({ status: 'generating' }))
    render(<ImagePreview />)
    expect(screen.getByText(/生成中/)).toBeInTheDocument()
  })
  it('single image renders full width', () => {
    seed(base({
      images: [{ url: 'https://x/a.png' }],
      completedAt: Date.now(), expiresAt: Date.now() + 1000_000,
    }))
    render(<ImagePreview />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/a.png')
  })
  it('multiple images render as grid', () => {
    seed(base({
      images: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }],
      completedAt: Date.now(), expiresAt: Date.now() + 1000_000,
    }))
    render(<ImagePreview />)
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })
  it('expired entry shows notice instead of images', () => {
    seed(base({
      images: [{ url: 'https://x/a.png' }],
      completedAt: Date.now() - 2000, expiresAt: Date.now() - 1000,
    }))
    render(<ImagePreview />)
    expect(screen.getByText(/已過期/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })
  it('failed entry shows the error', () => {
    seed(base({ status: 'failed', error: 'boom' }))
    render(<ImagePreview />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
  it('succeeded entry shows a URL action bar per image; 複製 URL calls the copy helper', () => {
    seed(base({
      images: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }],
      completedAt: Date.now(), expiresAt: Date.now() + 1000_000,
    }))
    render(<ImagePreview />)
    // URL 以唯讀 input 顯示完整值（monospace 面板）
    expect(screen.getByDisplayValue('https://x/a.png')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://x/b.png')).toBeInTheDocument()
    const copyBtns = screen.getAllByRole('button', { name: '複製' })
    expect(copyBtns).toHaveLength(2)
    fireEvent.click(copyBtns[0])
    // UrlPanel 以列 label 作為 toast 主詞
    expect(vi.mocked(copyWithToast)).toHaveBeenCalledWith('圖片 1', 'https://x/a.png')
    const links = screen.getAllByRole('link', { name: '開啟' })
    expect(links[1]).toHaveAttribute('href', 'https://x/b.png')
  })
  it('imported (blob) entry renders images without a URL action bar', () => {
    seed(base({ images: [{ url: 'blob:local-1' }], imported: true }))
    render(<ImagePreview />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '複製' })).not.toBeInTheDocument()
    expect(screen.queryByText(/blob:local-1/)).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(/blob:local-1/)).not.toBeInTheDocument()
  })
  it('expired entry has no URL action bar (notice view only)', () => {
    seed(base({
      images: [{ url: 'https://x/a.png' }],
      completedAt: Date.now() - 2000, expiresAt: Date.now() - 1000,
    }))
    render(<ImagePreview />)
    expect(screen.queryByRole('button', { name: '複製' })).not.toBeInTheDocument()
  })
})
