import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AudioWaveformDecoration from '../components/assets/AudioWaveformDecoration'

describe('AudioWaveformDecoration', () => {
  it('renders 30 vertical bars', () => {
    render(<AudioWaveformDecoration seed="asset-x" data-testid="wf" />)
    const svg = screen.getByTestId('wf')
    expect(svg.querySelectorAll('rect').length).toBe(30)
  })

  it('is deterministic for the same seed', () => {
    const { container: a } = render(
      <AudioWaveformDecoration seed="abc" data-testid="wf-a" />,
    )
    const { container: b } = render(
      <AudioWaveformDecoration seed="abc" data-testid="wf-b" />,
    )
    // strip data-testid attribute before compare so the container HTMLs
    // differ only by random body, not by the testid.
    const norm = (s: string) => s.replace(/data-testid="[^"]*"/g, '')
    expect(norm(a.innerHTML)).toBe(norm(b.innerHTML))
  })

  it('produces different bars for different seeds', () => {
    const { container: a } = render(<AudioWaveformDecoration seed="abc" />)
    const { container: b } = render(<AudioWaveformDecoration seed="xyz" />)
    expect(a.innerHTML).not.toBe(b.innerHTML)
  })
})
