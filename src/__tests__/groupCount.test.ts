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
    // 這是唯一的實作，任何呼叫端（頁面的選取效果、單刪/批刪、上傳收尾）都
    // 共用同一份模組層級的序號表——這裡直接呼叫兩次，模擬的是「不管是誰、
    // 從哪裡發起」都會被同一道防線擋住，不只是同一個呼叫端內部的競態。
    let resolveFirst!: (n: number) => void
    let resolveSecond!: (n: number) => void
    vi.mocked(countAssetsInGroup)
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockImplementationOnce(() => new Promise((r) => (resolveSecond = r)))

    const first = refreshGroupCount('g-1')
    const second = refreshGroupCount('g-1')

    resolveSecond(99) // 較新那次先回來
    await second
    expect(useAssetStore.getState().groupCounts['g-1']).toBe(99)

    resolveFirst(1) // 較舊那次晚到——不得蓋掉 99
    await first
    expect(useAssetStore.getState().groupCounts['g-1']).toBe(99)
  })

  it('calls for different groupIds do not interfere with each other', async () => {
    // 用 Map 而非單一計數器的理由：不同 groupId 的序號要各自獨立，後一個
    // groupId 的呼叫不能把前一個 groupId 仍在途的請求誤判為過期。
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
