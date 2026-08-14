/**
 * Shared, guarded `countAssetsInGroup` refresh — the single implementation
 * for every caller that wants "fetch this group's count and write it to
 * the store" (the asset library page's selected-group effect + its
 * single/batch-delete call sites, and `useAssetUpload`'s post-upload
 * refresh).
 *
 * Deliberately its own module rather than living inside `asset.ts` next to
 * `countAssetsInGroup`: this function imports `countAssetsInGroup` as a
 * genuine cross-module import so `vi.mock('.../api/asset', …)` can
 * intercept the call in tests. A same-module self-call (this function
 * defined inside asset.ts calling asset.ts's own `countAssetsInGroup`)
 * bypasses that interception — the mocked module namespace only rewires
 * what *other* modules see when they import from it, not a module's own
 * internal function-to-function calls — so the real network call would
 * run underneath the test instead of the stub.
 */
import { countAssetsInGroup } from './asset'
import { useAssetStore } from '../stores/assetStore'

/**
 * Per-groupId in-flight generation counter. Module scope, not a component
 * ref — every caller listed above shares one guard instead of each
 * keeping an independent copy that's blind to the others' in-flight calls.
 */
const groupCountSeq = new Map<string, number>()

/**
 * Fetch a group's asset count and write it to the store, discarding the
 * result if a newer call for the same groupId has started since. Without
 * this, two overlapping calls for the same group — re-selecting it while
 * the previous count is still retrying under `retryOnRateLimit`'s
 * 0.5/1/2s backoff, or two uploads into the same group finishing out of
 * order — can let the older response land last and silently clobber the
 * fresher number (both calls "succeed", so nothing surfaces an error).
 *
 * Best-effort: swallows failures, leaving whatever was there before (the
 * '—' placeholder, or a still-valid older count) rather than crashing the
 * UI over a transient count fetch.
 */
export async function refreshGroupCount(groupId: string): Promise<void> {
  const seq = (groupCountSeq.get(groupId) ?? 0) + 1
  groupCountSeq.set(groupId, seq)
  try {
    const n = await countAssetsInGroup(groupId)
    if (groupCountSeq.get(groupId) !== seq) return // 过期：更新的一次已接手
    useAssetStore.getState().setGroupCount(groupId, n)
  } catch {
    // best-effort — don't crash the UI on a stale count
  }
}
