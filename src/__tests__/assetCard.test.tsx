import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AssetCard from '../components/assets/AssetCard'
import type { Asset } from '../types/asset'

const baseAsset: Asset = {
  id: 'asset-20260506-x',
  name: 'hero_shot_v3_4k.png',
  url: 'https://example.com/cat.jpg',
  groupId: 'g1',
  assetType: 'Image',
  status: 'Active',
  projectName: 'p',
  createTime: '2026-05-06T00:00:00Z',
  updateTime: '2026-05-06T00:00:00Z',
}

describe('AssetCard v2', () => {
  it('renders 圖片 type badge for image asset', () => {
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
      />,
    )
    expect(screen.getByTestId('type-badge')).toHaveTextContent('圖片')
    expect(screen.getByRole('img')).toHaveAttribute('src', baseAsset.url)
  })

  it('renders 影片 type badge + play overlay for video asset', () => {
    render(
      <AssetCard
        asset={{ ...baseAsset, assetType: 'Video', name: 'a.mp4' }}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
      />,
    )
    expect(screen.getByTestId('type-badge')).toHaveTextContent('影片')
    expect(screen.getByTestId('video-play-overlay')).toBeInTheDocument()
  })

  it('renders 音訊 type badge + waveform for audio asset', () => {
    render(
      <AssetCard
        asset={{ ...baseAsset, assetType: 'Audio', name: 'a.mp3' }}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
      />,
    )
    expect(screen.getByTestId('type-badge')).toHaveTextContent('音訊')
    expect(screen.getByTestId('audio-waveform')).toBeInTheDocument()
  })

  it('shows Processing spinner branch when status=Processing', () => {
    render(
      <AssetCard
        asset={{ ...baseAsset, status: 'Processing', url: '' }}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
      />,
    )
    expect(screen.getByTestId('asset-status-processing')).toBeInTheDocument()
  })

  it('shows selected ring when selected=true', () => {
    const { rerender } = render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
      />,
    )
    const card = screen.getByTestId('asset-card')
    const before = card.getAttribute('style') ?? ''
    rerender(
      <AssetCard
        asset={baseAsset}
        selected={true}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
      />,
    )
    const after = card.getAttribute('style') ?? ''
    expect(after).not.toBe(before)
  })

  it('clicking card body fires onClick(asset)', () => {
    const onClick = vi.fn()
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={onClick}
        onCopyUri={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('asset-card'))
    expect(onClick).toHaveBeenCalledWith(baseAsset)
  })

  it('copy button fires onCopyUri with asset:// URI without bubbling onClick', () => {
    const onClick = vi.fn()
    const onCopyUri = vi.fn()
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={onClick}
        onCopyUri={onCopyUri}
      />,
    )
    fireEvent.click(screen.getByLabelText(/複製 URI/))
    expect(onCopyUri).toHaveBeenCalledWith('asset://asset-20260506-x')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does NOT render any inline delete button on the card', () => {
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/^刪除$/)).toBeNull()
  })
})

describe('AssetCard — status visualization', () => {
  function makeAsset(patch: Partial<Asset> = {}): Asset {
    return {
      id: 'asset-test-1', name: 'demo', url: '', groupId: 'g1',
      assetType: 'Image', status: 'Active', projectName: 'p',
      createTime: '2026-05-09T00:00:00Z', updateTime: '2026-05-09T00:00:00Z',
      ...patch,
    }
  }

  it('renders no status marker at all when status is Active', () => {
    const a = makeAsset({ status: 'Active' })
    render(<AssetCard asset={a} selected={false} onClick={() => {}} onCopyUri={() => {}} />)
    expect(screen.queryByTestId('status-pill')).toBeNull()
    expect(screen.queryByTestId('status-dot-active')).toBeNull()
  })

  it('renders a running processing pill when status is Processing', () => {
    const a = makeAsset({ status: 'Processing' })
    render(<AssetCard asset={a} selected={false} onClick={() => {}} onCopyUri={() => {}} />)
    const pill = screen.getByTestId('status-pill')
    expect(pill).toHaveTextContent('處理中')
  })

  it('renders a red failed pill when status is Failed', () => {
    const a = makeAsset({ status: 'Failed', error: { code: 'X', message: 'bad upload' } })
    render(<AssetCard asset={a} selected={false} onClick={() => {}} onCopyUri={() => {}} />)
    expect(screen.getByTestId('status-pill')).toHaveTextContent('失敗')
  })

  it('renders an error placeholder (not the image) when status is Failed', () => {
    const a = makeAsset({ status: 'Failed', assetType: 'Image', url: 'https://x/should-not-load' })
    render(<AssetCard asset={a} selected={false} onClick={() => {}} onCopyUri={() => {}} />)
    expect(screen.getByTestId('asset-failed-placeholder')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('AssetCard — batch-delete checkbox', () => {
  it('renders an unchecked checkbox and toggles via onToggleCheck (not onClick)', () => {
    const onToggleCheck = vi.fn()
    const onClick = vi.fn()
    const { getByTestId } = render(
      <AssetCard
        asset={{ ...baseAsset, id: 'asset-9' }}
        selected={false}
        onCopyUri={vi.fn()}
        onClick={onClick}
        checked={false}
        onToggleCheck={onToggleCheck}
      />,
    )
    const cb = getByTestId('asset-check') as HTMLInputElement
    expect(cb.checked).toBe(false)
    fireEvent.click(cb)
    expect(onToggleCheck).toHaveBeenCalledWith('asset-9')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('reflects checked=true', () => {
    const { getByTestId } = render(
      <AssetCard
        asset={{ ...baseAsset, id: 'asset-9' }}
        selected={false}
        onCopyUri={vi.fn()}
        onClick={vi.fn()}
        checked
        onToggleCheck={vi.fn()}
      />,
    )
    expect((getByTestId('asset-check') as HTMLInputElement).checked).toBe(true)
  })

  it('hides the checkbox until the card is hovered', () => {
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
        checked={false}
        onToggleCheck={vi.fn()}
      />,
    )
    const cb = screen.getByTestId('asset-check') as HTMLInputElement
    expect(cb.style.opacity).toBe('0')
    fireEvent.mouseEnter(screen.getByTestId('asset-card'))
    expect(cb.style.opacity).toBe('1')
    fireEvent.mouseLeave(screen.getByTestId('asset-card'))
    expect(cb.style.opacity).toBe('0')
  })

  it('keeps the checkbox visible when checked (no hover needed)', () => {
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
        checked
        onToggleCheck={vi.fn()}
      />,
    )
    const cb = screen.getByTestId('asset-check') as HTMLInputElement
    expect(cb.style.opacity).toBe('1')
  })

  it('keeps the checkbox visible while any card is checked (anyChecked)', () => {
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
        checked={false}
        anyChecked
        onToggleCheck={vi.fn()}
      />,
    )
    const cb = screen.getByTestId('asset-check') as HTMLInputElement
    expect(cb.style.opacity).toBe('1')
  })

  it('reveals the checkbox on keyboard focus (no hover needed)', () => {
    render(
      <AssetCard
        asset={baseAsset}
        selected={false}
        onClick={vi.fn()}
        onCopyUri={vi.fn()}
        checked={false}
        onToggleCheck={vi.fn()}
      />,
    )
    const cb = screen.getByTestId('asset-check') as HTMLInputElement
    expect(cb.style.opacity).toBe('0')
    fireEvent.focus(cb)
    expect(cb.style.opacity).toBe('1')
    fireEvent.blur(cb)
    expect(cb.style.opacity).toBe('0')
  })
})
