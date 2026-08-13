/**
 * Batch-delete orchestrator. ARK has no bulk-delete endpoint, so we issue
 * N single DeleteAsset calls paced at a steady ≤8 QPS (DeleteAsset's hard
 * limit is 10 QPS; 8 leaves headroom for jitter/clock skew). Dispatch is
 * decoupled from per-item retry so a slow retrying item never stalls the
 * 8 QPS pipeline.
 *
 * Failure model (see spec §5.3):
 *  - 404 / NotFound      → success (idempotent: the asset is already gone)
 *  - transient (429/5xx/network, isTransientError) → retry up to
 *    maxAttempts with exponential backoff; if still failing → failed[]
 *  - non-transient (400/403) → abort the whole batch (shared creds/params
 *    fail every item identically; per-item retry is pointless)
 */
import { deleteAsset, isTransientError, HttpError } from './asset'

export interface BatchDeleteProgress {
  total: number
  succeeded: number
  failed: { id: string; name: string; reason: string }[]
  status: 'running' | 'done' | 'aborted'
  abortReason?: string
}

export interface BatchDeleteOptions {
  /** Defaults to `deleteAsset`. Injected in tests. */
  deleteFn?: (id: string) => Promise<void>
  /** Resolve a display name for failed[].name. Defaults to the id. */
  getName?: (id: string) => string
  /** Called once per asset that is gone from ARK (success or 404), so the
   *  caller can `removeAsset(id)` immediately. */
  onRemoved?: (id: string) => void
  /** Called after every settled item with the current progress snapshot. */
  onProgress?: (p: BatchDeleteProgress) => void
  /** Steady dispatch rate. Default 8. */
  qps?: number
  /** Total attempts per item (1 initial + retries). Default 5. */
  maxAttempts?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function is404(err: unknown): boolean {
  return (
    err instanceof HttpError &&
    (err.status === 404 || /notfound/i.test(err.code ?? ''))
  )
}

function reason(err: unknown): string {
  if (err instanceof HttpError) {
    return err.code ? `${err.code} (HTTP ${err.status})` : `HTTP ${err.status}`
  }
  return err instanceof Error ? err.message : String(err)
}

export async function batchDelete(
  ids: string[],
  opts: BatchDeleteOptions = {},
): Promise<BatchDeleteProgress> {
  const deleteFn = opts.deleteFn ?? deleteAsset
  const getName = opts.getName ?? ((id: string) => id)
  const qps = opts.qps ?? 8
  const maxAttempts = opts.maxAttempts ?? 5
  const intervalMs = 1000 / qps
  const backoff = (attempt: number) => {
    const base = 500 * 2 ** (attempt - 1)
    return base + Math.random() * base * 0.5
  }

  const progress: BatchDeleteProgress = {
    total: ids.length,
    succeeded: 0,
    failed: [],
    status: 'running',
  }

  let aborted = false
  let nextSlotAt = 0
  const inFlight: Promise<void>[] = []

  // Steady-interval scheduler (not a burst-capable token bucket): every
  // dispatch is spaced >= intervalMs apart, so instantaneous rate can
  // never exceed `qps`. Stricter than the spec's token-bucket wording but
  // safely under DeleteAsset's 10 QPS hard limit. `Math.max(nextSlotAt,
  // now)` rebases to wall clock so a long stall can't produce a catch-up
  // burst.
  async function waitForSlot(): Promise<void> {
    const now = Date.now()
    const wait = Math.max(0, nextSlotAt - now)
    nextSlotAt = Math.max(nextSlotAt, now) + intervalMs
    if (wait > 0) await sleep(wait)
  }

  async function deleteOne(id: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await deleteFn(id)
        progress.succeeded++
        opts.onRemoved?.(id)
        opts.onProgress?.({ ...progress })
        return
      } catch (err) {
        if (is404(err)) {
          progress.succeeded++
          opts.onRemoved?.(id)
          opts.onProgress?.({ ...progress })
          return
        }
        // Non-transient = shared-cause (bad creds/params) → abort the whole
        // batch. Already-dispatched in-flight items are intentionally left
        // to settle (an issued DeleteAsset can't be unsent); a late
        // success after abort only bumps `succeeded` and never regresses
        // status, because the success/404 branches never write `status`
        // and the final promotion (below) only lifts 'running' → 'done'.
        if (!isTransientError(err)) {
          aborted = true
          progress.status = 'aborted'
          progress.abortReason = reason(err)
          opts.onProgress?.({ ...progress })
          return
        }
        if (attempt >= maxAttempts) {
          progress.failed.push({ id, name: getName(id), reason: reason(err) })
          opts.onProgress?.({ ...progress })
          return
        }
        await sleep(backoff(attempt))
      }
    }
  }

  for (const id of ids) {
    if (aborted) break
    await waitForSlot()
    if (aborted) break
    inFlight.push(deleteOne(id))
  }
  await Promise.allSettled(inFlight)

  if (progress.status === 'running') progress.status = 'done'
  opts.onProgress?.({ ...progress })
  return progress
}
