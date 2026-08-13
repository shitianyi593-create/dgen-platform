import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNow } from '../hooks/useNow'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns current Date.now() initially', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
    const { result } = renderHook(() => useNow(1000))
    expect(result.current).toBe(Date.now())
  })

  it('updates after the interval elapses', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
    const { result } = renderHook(() => useNow(1000))
    const t0 = result.current

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBeGreaterThan(t0)
  })

  it('cleans up the interval on unmount', () => {
    const { unmount } = renderHook(() => useNow(1000))
    const spy = vi.spyOn(globalThis, 'clearInterval')
    unmount()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not start an interval when intervalMs is 0', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    renderHook(() => useNow(0))
    expect(setSpy).not.toHaveBeenCalled()
    setSpy.mockRestore()
  })
})
