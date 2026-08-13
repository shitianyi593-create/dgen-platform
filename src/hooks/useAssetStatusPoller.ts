import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getAsset, pollUntilCancelled } from '../api/asset'
import { useAssetStore } from '../stores/assetStore'
import type { Asset } from '../types/asset'

export interface PollerOptions {
  /** Default 5_000 (5 s). */
  intervalMs?: number
}

/**
 * Watches the `assets` array; for every entry whose status is 'Processing'
 * and isn't already being polled, kicks off a cancellable poller. Terminal
 * results are merged into the store via `upsertAsset`.
 *
 * Cancels all in-flight pollers on unmount.
 */
export function useAssetStatusPoller(
  assets: Asset[],
  opts: PollerOptions = {},
): void {
  const upsertAsset = useAssetStore((s) => s.upsertAsset)
  const uploads = useAssetStore(useShallow((s) => s.uploads))
  const uploadedAssetIds = useMemo(
    () => new Set(uploads.map((u) => u.assetId).filter((x): x is string => !!x)),
    [uploads],
  )
  const inflight = useRef<Map<string, () => void>>(new Map())

  useEffect(() => {
    const intervalMs = opts.intervalMs ?? 5_000

    for (const a of assets) {
      if (a.status !== 'Processing') continue
      if (uploadedAssetIds.has(a.id)) continue
      if (inflight.current.has(a.id)) continue

      // Capture `a.id` in closure so the correct store entry is updated
      // even if the fetcher returns a payload with a mismatched id field.
      const assetId = a.id
      const { promise, cancel } = pollUntilCancelled(assetId, {
        intervalMs,
        fetcher: getAsset,
        onTick: (latest) => {
          // Mid-poll: don't overwrite store unless status actually changes
          // (avoid churn from URL/timestamp drift on intermediate ticks).
          if (latest.status !== 'Processing') {
            upsertAsset({ ...latest, id: assetId })
          }
        },
      })
      inflight.current.set(assetId, cancel)

      promise
        .then((terminal) => {
          upsertAsset({ ...terminal, id: assetId })
        })
        .catch(() => {
          // cancellation or transient API error — ignore; the next tick of
          // the parent useEffect will re-evaluate.
        })
        .finally(() => {
          inflight.current.delete(assetId)
        })
    }
    // No teardown here — pollers self-clean via finally(). The full
    // unmount teardown is in the next useEffect.
  }, [assets, opts.intervalMs, upsertAsset, uploadedAssetIds])

  // Unmount: cancel everything still in flight.
  useEffect(() => {
    const map = inflight.current
    return () => {
      for (const cancel of map.values()) cancel()
      map.clear()
    }
  }, [])
}
