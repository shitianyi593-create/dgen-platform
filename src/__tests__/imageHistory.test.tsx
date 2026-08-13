import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImageHistory from '../components/image/ImageHistory'
import { buildImageBatchZip } from '../api/imageBundle'
import { useImageStore } from '../stores/imageStore'
import type { ImageHistoryItem } from '../types/image'

vi.mock('../api/imageBundle', () => ({
  buildImageBundleZip: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), missing: [] }),
  buildImageBatchZip: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), missing: [] }),
  importImageBundleZip: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/local', () => ({ downloadAssetBlob: vi.fn().mockResolvedValue(new Blob(['x'])) }))
vi.mock('../api/exportBundle', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/exportBundle')>()
  return { ...orig, downloadBlob: vi.fn() }
})
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  copyWithToast: vi.fn(),
}))

function item(over: Partial<ImageHistoryItem> = {}): ImageHistoryItem {
  return {
    id: 'h1', status: 'succeeded', prompt: 'a very nice cat picture',
    modelKey: 'seedream-5-0-pro', createdAt: Date.now() - 60_000,
    completedAt: Date.now() - 55_000, expiresAt: Date.now() + 3600_000,
    images: [{ url: 'https://x/a.png' }],
    params: {
      size: '2K', watermark: false, sequential: false,
      refFilenames: [], refUrls: [], aspectRatio: 'auto',
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useImageStore.setState(useImageStore.getInitialState(), true)
})

describe('ImageHistory', () => {
  it('renders entry card with prompt + model badge + countdown', () => {
    useImageStore.setState({ history: [item()] })
    render(<ImageHistory width={300} />)
    expect(screen.getByText(/a very nice cat/)).toBeInTheDocument()
    expect(screen.getByText(/Seedream 5.0 Pro/)).toBeInTheDocument()
    expect(screen.getByText(/後過期/)).toBeInTheDocument()
  })
  it('expired entry shows 已過期 and disables download', () => {
    useImageStore.setState({ history: [item({ expiresAt: Date.now() - 1000 })] })
    render(<ImageHistory width={300} />)
    expect(screen.getByText('已過期')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /下載/ })).toBeDisabled()
  })
  it('載入參數 via ⋯ 選單 refills the form', () => {
    useImageStore.setState({ history: [item({ prompt: 'reload me' })] })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: '載入參數' }))
    expect(useImageStore.getState().prompt).toBe('reload me')
  })
  it('expired card shows persistent 載入參數重生成 that refills the form', () => {
    useImageStore.setState({
      history: [item({ prompt: 'regen me', expiresAt: Date.now() - 1000 })],
    })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '載入參數重生成' }))
    expect(useImageStore.getState().prompt).toBe('regen me')
  })
  it('刪除 via ⋯ 選單 asks for confirmation then removes', () => {
    useImageStore.setState({ history: [item()] })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    fireEvent.click(screen.getByRole('button', { name: '確認' }))
    expect(useImageStore.getState().history).toHaveLength(0)
  })
  it('匯出全部 excludes imported entries from the batch', async () => {
    useImageStore.setState({
      history: [
        item(),
        item({
          id: 'imp1', imported: true, expiresAt: undefined,
          images: [{ url: 'blob:imported' }],
        }),
      ],
    })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: /匯出全部/ }))
    await waitFor(() => expect(vi.mocked(buildImageBatchZip)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(buildImageBatchZip)).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'h1' }),
    ])
  })
  it('failed entry shows error text', () => {
    useImageStore.setState({ history: [item({ status: 'failed', error: 'quota', images: [] })] })
    render(<ImageHistory width={300} />)
    expect(screen.getByText(/quota/)).toBeInTheDocument()
  })

  it('除錯資訊 collapsed by default; expands to show requestId / model / URL row', () => {
    useImageStore.setState({
      history: [item({
        images: [{ url: 'https://x/a.png', size: '2048x2048', outputFormat: 'png' }],
        debug: { requestId: 'req-xyz', responseModel: 'dola-seedream-5-0-pro-260628', createdApi: 1757323224 },
      })],
    })
    render(<ImageHistory width={300} />)
    // 收合：內容不可見
    expect(screen.queryByText(/req-xyz/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: /除錯資訊/ }))
    expect(screen.getByText(/req-xyz/)).toBeInTheDocument()
    expect(screen.getByText(/dola-seedream-5-0-pro/)).toBeInTheDocument()
    expect(screen.getByText(/#1 2048x2048 png/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '開啟' })).toHaveAttribute('href', 'https://x/a.png')
  })

  it('複製 button in debug section calls the copy helper with the request id', async () => {
    const { copyWithToast } = await import('../utils/clipboard')
    useImageStore.setState({
      history: [item({ debug: { requestId: 'req-xyz' } })],
    })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: /除錯資訊/ }))
    // Request ID 列的複製鈕（第一顆）
    fireEvent.click(screen.getAllByRole('button', { name: '複製' })[0])
    await waitFor(() =>
      expect(vi.mocked(copyWithToast)).toHaveBeenCalledWith('Request ID', 'req-xyz'),
    )
  })

  it('debug per-image row shows the URL text with the full value in title', () => {
    useImageStore.setState({
      history: [item({ images: [{ url: 'https://x/a.png', size: '2048x2048' }] })],
    })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: /除錯資訊/ }))
    expect(screen.getByText('https://x/a.png')).toHaveAttribute('title', 'https://x/a.png')
  })

  it('card-level 複製 URL copies a single image URL', async () => {
    const { copyWithToast } = await import('../utils/clipboard')
    useImageStore.setState({ history: [item()] })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '複製 URL' }))
    await waitFor(() =>
      expect(vi.mocked(copyWithToast)).toHaveBeenCalledWith('URL', 'https://x/a.png'),
    )
  })

  it('card-level 複製 URL joins multiple image URLs with newlines', async () => {
    const { copyWithToast } = await import('../utils/clipboard')
    useImageStore.setState({
      history: [item({ images: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }] })],
    })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '複製 URL' }))
    await waitFor(() =>
      expect(vi.mocked(copyWithToast)).toHaveBeenCalledWith(
        '2 個 URL',
        'https://x/a.png\nhttps://x/b.png',
      ),
    )
  })

  it('card-level 複製 URL disabled for expired and imported entries', () => {
    useImageStore.setState({
      history: [
        item({ id: 'exp1', expiresAt: Date.now() - 1000 }),
        item({
          id: 'imp1', imported: true, expiresAt: undefined,
          images: [{ url: 'blob:imported' }],
        }),
      ],
    })
    render(<ImageHistory width={300} />)
    const btns = screen.getAllByRole('button', { name: '複製 URL' })
    expect(btns).toHaveLength(2)
    for (const b of btns) expect(b).toBeDisabled()
  })

  it('failed card debug section shows errorCode', () => {
    useImageStore.setState({
      history: [item({ status: 'failed', error: 'blocked', images: [], errorCode: 'InputImageSensitiveContentDetected' })],
    })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    fireEvent.click(screen.getByRole('button', { name: /除錯資訊/ }))
    expect(screen.getByText(/InputImageSensitiveContentDetected/)).toBeInTheDocument()
  })

  it('generating card with nothing to show has no 除錯資訊 item in the ⋯ menu', () => {
    useImageStore.setState({
      history: [item({
        status: 'generating', images: [], completedAt: undefined,
        expiresAt: undefined, usage: undefined, debug: undefined,
      })],
    })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    expect(screen.queryByRole('button', { name: /除錯資訊/ })).not.toBeInTheDocument()
  })

  it('debug menu item exposes aria-expanded state', () => {
    useImageStore.setState({ history: [item({ debug: { requestId: 'req-xyz' } })] })
    render(<ImageHistory width={300} />)
    fireEvent.click(screen.getByRole('button', { name: '更多動作' }))
    const toggle = screen.getByRole('button', { name: /除錯資訊/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})
