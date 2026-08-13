import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAssetStatusPoller } from '../hooks/useAssetStatusPoller'
import { useAssetStore } from '../stores/assetStore'
import type { Asset } from '../types/asset'

vi.mock('../api/asset', async () => {
  const actual = await vi.importActual<typeof import('../api/asset')>('../api/asset')
  return { ...actual, getAsset: vi.fn() }
})
import { getAsset } from '../api/asset'

function makeAsset(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'a1', name: 'x', url: '', groupId: 'g',
    assetType: 'Image', status: 'Processing', projectName: 'p',
    createTime: '2026-05-09T00:00:00Z', updateTime: '2026-05-09T00:00:00Z',
    ...patch,
  }
}

describe('useAssetStatusPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAssetStore.setState({ assets: [] })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('polls every Processing asset and upserts when terminal', async () => {
    vi.mocked(getAsset).mockResolvedValue(makeAsset({ status: 'Active', url: 'https://ok' }))
    const initial = [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2' })]
    renderHook(() => useAssetStatusPoller(initial, { intervalMs: 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    const stored = useAssetStore.getState().assets
    expect(stored.find((a) => a.id === 'a1')?.status).toBe('Active')
    expect(stored.find((a) => a.id === 'a2')?.status).toBe('Active')
  })

  it('does not double-poll the same id', async () => {
    vi.mocked(getAsset).mockResolvedValue(makeAsset({ status: 'Processing' }))
    const initial = [makeAsset({ id: 'a1' })]
    const { rerender } = renderHook(
      ({ list }: { list: Asset[] }) => useAssetStatusPoller(list, { intervalMs: 100 }),
      { initialProps: { list: initial } },
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    rerender({ list: initial }) // same list reference / same ids
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    // First call on mount + one interval; should NOT be 4+ from double registration
    expect(vi.mocked(getAsset).mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('skips ids that are already terminal', async () => {
    const initial = [makeAsset({ id: 'a1', status: 'Active' })]
    renderHook(() => useAssetStatusPoller(initial, { intervalMs: 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(getAsset).not.toHaveBeenCalled()
  })

  it('skips assets that are currently being uploaded (uploads map has matching assetId)', async () => {
    // Seed an upload entry for the asset's id
    useAssetStore.setState({
      uploads: [
        {
          clientId: 'cid-1',
          filename: 'x.png',
          stage: 'polling',
          groupId: 'g',
          assetType: 'Image',
          assetId: 'a1',
        },
      ],
    })
    const initial = [makeAsset({ id: 'a1' })]
    renderHook(() => useAssetStatusPoller(initial, { intervalMs: 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(getAsset).not.toHaveBeenCalled()
  })
})
