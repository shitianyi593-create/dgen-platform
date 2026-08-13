/**
 * Hook that owns a resizable column's pixel width with localStorage
 * persistence + min/max clamping.
 *
 * Returns `[width, setWidth]` where the setter is safe to call from inside a
 * mousemove loop — it'll clamp into [min, max] and only update state if the
 * value actually changed (avoids re-render thrash).
 */
import { useCallback, useEffect, useState } from 'react'

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function readStoredWidth(
  storageKey: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw == null) return fallback
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return fallback
    return clamp(parsed, min, max)
  } catch {
    return fallback
  }
}

export interface UseResizableWidthOptions {
  /** Persisted between sessions under this localStorage key. */
  storageKey: string
  /** Width used on first load when no stored value exists. */
  defaultWidth: number
  /** Lower bound for the panel width in pixels. */
  min: number
  /** Upper bound for the panel width in pixels. */
  max: number
}

export function useResizableWidth({
  storageKey,
  defaultWidth,
  min,
  max,
}: UseResizableWidthOptions): [number, (next: number) => void] {
  const [width, setWidthState] = useState<number>(() =>
    readStoredWidth(storageKey, defaultWidth, min, max),
  )

  // Persist on every committed value change. We debounce trivially via the
  // microtask queue rather than a timer so test runs flush synchronously.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(storageKey, String(width))
    } catch {
      // Quota exceeded / privacy mode — silent fallback is fine, we still
      // have an in-memory value driving the layout.
    }
  }, [storageKey, width])

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clamp(next, min, max)
      setWidthState((prev) => (prev === clamped ? prev : clamped))
    },
    [min, max],
  )

  return [width, setWidth]
}
