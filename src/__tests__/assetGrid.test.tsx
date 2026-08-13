import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import AssetGrid from '../components/assets/AssetGrid'
import type { Asset } from '../types/asset'

function makeAsset(over: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'cat',
    url: 'https://u',
    groupId: 'g1',
    assetType: 'Image',
    status: 'Active',
    projectName: 'p',
    createTime: '2026-05-19T00:00:00Z',
    updateTime: '2026-05-19T00:00:00Z',
    ...over,
  }
}

describe('AssetGrid — batch-delete wiring', () => {
  it('passes checked state and forwards toggles by id', () => {
    const onToggleCheck = vi.fn()
    const { getAllByTestId } = render(
      <AssetGrid
        assets={[makeAsset({ id: 'a' }), makeAsset({ id: 'b' })]}
        loading={false}
        selectedId={null}
        checkedIds={new Set(['a'])}
        onToggleCheck={onToggleCheck}
        onCopyUri={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    const boxes = getAllByTestId('asset-check') as HTMLInputElement[]
    expect(boxes[0].checked).toBe(true)
    expect(boxes[1].checked).toBe(false)
    // With at least one card checked (anyChecked), every card's checkbox
    // stays visible — even unchecked, unhovered ones.
    expect(boxes[1].style.opacity).toBe('1')
    fireEvent.click(boxes[1])
    expect(onToggleCheck).toHaveBeenCalledWith('b')
  })
})

describe('AssetGrid — loading skeleton', () => {
  it('renders the card-shaped skeleton grid while loading', () => {
    const { getByTestId } = render(
      <AssetGrid
        assets={[]}
        loading
        selectedId={null}
        checkedIds={new Set()}
        onToggleCheck={vi.fn()}
        onCopyUri={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(getByTestId('asset-grid-loading')).toBeInTheDocument()
  })
})
