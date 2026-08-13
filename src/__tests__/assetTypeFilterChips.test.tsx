import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AssetTypeFilterChips from '../components/assets/AssetTypeFilterChips'

describe('AssetTypeFilterChips', () => {
  it('renders 全部 / 圖片 / 影片 / 音訊 with the supplied counts', () => {
    render(
      <AssetTypeFilterChips
        counts={{ all: 86, Image: 42, Video: 31, Audio: 13 }}
        value="all"
        onChange={vi.fn()}
      />,
    )
    // Read the parent <button>'s textContent, since label and count live in
    // sibling spans inside the chip.
    expect(screen.getByText(/全部/).closest('button')!.textContent).toMatch(/86/)
    expect(screen.getByText(/圖片/).closest('button')!.textContent).toMatch(/42/)
    expect(screen.getByText(/影片/).closest('button')!.textContent).toMatch(/31/)
    expect(screen.getByText(/音訊/).closest('button')!.textContent).toMatch(/13/)
  })

  it('renders a type icon inside each typed chip', () => {
    render(
      <AssetTypeFilterChips
        counts={{ all: 0, Image: 0, Video: 0, Audio: 0 }}
        value="all"
        onChange={vi.fn()}
      />,
    )
    for (const label of ['圖片', '影片', '音訊']) {
      expect(
        screen.getByText(label).closest('button')!.querySelector('svg'),
      ).toBeTruthy()
    }
  })

  it('calls onChange with the picked filter value', () => {
    const onChange = vi.fn()
    render(
      <AssetTypeFilterChips
        counts={{ all: 0, Image: 0, Video: 0, Audio: 0 }}
        value="all"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText(/圖片/))
    expect(onChange).toHaveBeenCalledWith('Image')
  })

  it('marks the selected chip with aria-pressed=true', () => {
    render(
      <AssetTypeFilterChips
        counts={{ all: 0, Image: 0, Video: 0, Audio: 0 }}
        value="Audio"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/音訊/).closest('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(/圖片/).closest('button')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
