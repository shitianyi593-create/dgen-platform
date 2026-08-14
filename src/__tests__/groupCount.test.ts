/**
 * `refreshGroupCount` used to be duplicated: a copy inside
 * AssetLibraryPage.tsx (guarded by a per-groupId seq Map on a component
 * ref) and an independent, unguarded copy in useAssetUpload.ts. Final
 * branch review (composing all 6 lazy-loading tasks together) found that
 * split meant an upload finishing into the same group the page had just
 * queried could land its response after the page's own request and
 * silently overwrite a fresher count — invisible to the page's guard,
 * since it only knew about its own calls. Consolidating into this single
 * module gives every caller the same guard automatically; this file pins
 * the guard's correctness directly rather than through one caller's UI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { refreshGroupCount } from '../api/groupCount'
import { useAssetStore } from '../stores/assetStore'

vi.mock('../api/asset', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/asset')>()
  return { ...orig, countAssetsInGroup: vi.fn() }
})
import { countAssetsInGroup } from '../api/asset'

describe('refreshGroupCount (shared guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAssetStore.setState(useAssetStore.getInitialState())
  })

  it('writes the resolved count to the store', async () => {
    vi.mocked(countAssetsInGroup).mockResolvedValueOnce(7)
    await refreshGroupCount('g-1')
    expect(useAssetStore.getState().groupCounts['g-1']).toBe(7)
  })

  it('a failed fetch leaves the store untouched (best-effort)', async () => {
    vi.mocked(countAssetsInGroup).mockRejectedValueOnce(new Error('x'))
    await expect(refreshGroupCount('g-1')).resolves.toBeUndefined()
    expect(useAssetStore.getState().groupCounts['g-1']).toBeUndefined()
  })

  it('an older in-flight call for the same groupId cannot overwrite a fresher one', async () => {
    // 这是唯一的实作，任何呼叫端（页面的选择效果、单删/批删、上传收尾）都
    // 共用同一份模块层级的序号表——这里直接呼叫两次，模擬的是「不管是谁、
    // 从哪里发起」都会被同一道防线挡住，不只是同一个呼叫端内部的竞态。
    let resolveFirst!: (n: number) => void
    let resolveSecond!: (n: number) => void
    vi.mocked(countAssetsInGroup)
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockImplementationOnce(() => new Promise((r) => (resolveSecond = r)))

    const first = refreshGroupCount('g-1')
    const second = refreshGroupCount('g-1')

    resolveSecond(99) // 较新那次先回来
    await second
    expect(useAssetStore.getState().groupCounts['g-1']).toBe(99)

    resolveFirst(1) // 较旧那次晚到——不得盖掉 99
    await first
    expect(useAssetStore.getState().groupCounts['g-1']).toBe(99)
  })

  it('calls for different groupIds do not interfere with each other', async () => {
    // 用 Map 而非单一计数器的理由：不同 groupId 的序号要各自独立，后一个
    // groupId 的呼叫不能把前一个 groupId 仍在途的请求误判为过期。
    let resolveA!: (n: number) => void
    let resolveB!: (n: number) => void
    vi.mocked(countAssetsInGroup).mockImplementation((groupId: string) =>
      groupId === 'g-a'
        ? new Promise((r) => (resolveA = r))
        : new Promise((r) => (resolveB = r)),
    )

    const a = refreshGroupCount('g-a')
    const b = refreshGroupCount('g-b')
    resolveB(2)
    await b
    resolveA(1)
    await a

    expect(useAssetStore.getState().groupCounts).toEqual({ 'g-a': 1, 'g-b': 2 })
  })
})
