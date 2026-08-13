import type { CSSProperties } from 'react'

/**
 * Purely decorative SVG waveform.
 *
 * Heights are derived deterministically from the `seed` (an asset id), so
 * the same asset always renders the same waveform — that's enough to
 * differentiate audio cards visually without paying for any actual audio
 * decoding.
 *
 * The hash + RNG are vendored on purpose: they're tiny, side-effect-free,
 * and don't depend on the runtime crypto API (which jsdom mocks out).
 */

interface Props {
  seed: string
  /** Total height in px. Defaults to 96. */
  height?: number
  /** Bar fill colour. Defaults to spec green. */
  color?: string
  /** Pass-through to the root <svg>. */
  'data-testid'?: string
  style?: CSSProperties
}

// FNV-1a-ish hash → 32-bit unsigned int.
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return h
}

// mulberry32-ish: cheap, deterministic, returns [0, 1).
function pseudoRandom(seed: number, i: number): number {
  let t = (seed + i * 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const BARS = 30

export default function AudioWaveformDecoration({
  seed,
  height = 96,
  color = '#34d399',
  style,
  ...rest
}: Props) {
  const hashed = hashSeed(seed)
  const w = 4
  const gap = 4
  const totalW = BARS * (w + gap)
  return (
    <svg
      viewBox={`0 0 ${totalW} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', ...style }}
      {...rest}
    >
      {Array.from({ length: BARS }).map((_, i) => {
        const rel = pseudoRandom(hashed, i) // 0..1
        const h = Math.max(8, rel * height * 0.85) // never collapse to invisible
        const y = (height - h) / 2
        const x = i * (w + gap)
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={1.5}
            fill={color}
          />
        )
      })}
    </svg>
  )
}
