import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { uploadToTos, signGetUrl } from '../api/tos'
import { createAsset, pollAssetUntilDone } from '../api/asset'
import { refreshGroupCount } from '../api/groupCount'
import type { Asset, AssetTypeApi } from '../types/asset'
import { useAssetStore } from '../stores/assetStore'

/**
 * Asset URLs provisioned for ARK CreateAsset must outlive the longest
 * plausible async preprocessing window. ARK can take several minutes for
 * video; TOS' default 3h GET TTL is wider but we explicitly re-sign with
 * 12h here to be defensive and decouple from whatever the caller's TOS
 * default happens to be.
 */
const TOS_GET_TTL_FOR_ASSET_SEC = 12 * 60 * 60

/**
 * Hard cap on simultaneous in-flight uploads. Sized to ARK CreateAsset's
 * Premium-tier QPM (300/min ≈ 5 QPS, the binding bottleneck — TOS PUT is
 * bandwidth-bound, not QPS-bound); 8 keeps steady-state RPS near the
 * ceiling, and createAsset() backs off on 429 so brief bursts auto-recover.
 */
export const MAX_CONCURRENT_UPLOADS = 8

/** Module-level semaphore so concurrency is global, not per-call. */
class UploadSemaphore {
  private active = 0
  private waiters: Array<() => void> = []
  private readonly cap: number

  // Avoid TS parameter-property syntax — banned by `erasableSyntaxOnly`
  // in this project's tsconfig.
  constructor(cap: number) {
    this.cap = cap
  }

  /** Counter for tests / instrumentation; never read in production. */
  get inFlight(): number {
    return this.active
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.cap) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active++
    try {
      return await task()
    } finally {
      this.active--
      const next = this.waiters.shift()
      next?.()
    }
  }
}

const uploadSemaphore = new UploadSemaphore(MAX_CONCURRENT_UPLOADS)

/** Test-only escape hatch so we don't have to spin up real timers. */
export function _getUploadSemaphoreForTests(): UploadSemaphore {
  return uploadSemaphore
}

function clientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * ARK Asset.Name is "up to 64 characters". Cap while preserving the file
 * extension when present so the displayed name stays meaningful.
 *
 *   "very_long_filename_with_lots_of_chars_xxxxxxxxxxxxxxxxxxxxxxxxx.png"
 *     → "very_long_filename_with_lots_of_chars_xxxxxxxxxxxxxxxxxxxx.png"
 *
 * Empty / whitespace-only strings fall back to "asset".
 */
export function capAssetName(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return 'asset'
  if (trimmed.length <= 64) return trimmed

  const lastDot = trimmed.lastIndexOf('.')
  // Keep the extension if it's plausibly real (≤10 chars after the dot
  // and there's actual content before the dot).
  if (lastDot > 0 && trimmed.length - lastDot <= 10) {
    const ext = trimmed.slice(lastDot)
    return trimmed.slice(0, 64 - ext.length) + ext
  }
  return trimmed.slice(0, 64)
}

/**
 * Decide what to send as ARK Asset.Name. Prefer an explicit override,
 * otherwise default to the local file name (capped to 64 chars). The
 * spec allows underscore-replacement of problematic characters but in
 * practice ARK accepts unicode + common filename punctuation, so we
 * only intervene on length.
 */
export function deriveAssetName(input: { name?: string; file: File }): string {
  if (input.name && input.name.trim()) return capAssetName(input.name)
  return capAssetName(input.file.name)
}

export interface UploadOneAssetInput {
  file: File
  groupId: string
  assetType: AssetTypeApi
  name?: string
  /** Inject deps for tests. */
  deps?: {
    upload?: typeof uploadToTos
    signGet?: typeof signGetUrl
    createAsset?: typeof createAsset
    pollAssetUntilDone?: typeof pollAssetUntilDone
    getNow?: () => number
  }
}

/**
 * Run the full pipeline for a single file:
 *
 *   1)  Upload to TOS (existing TOS plugin / TOS account)
 *   1.5) Re-sign GET URL with 12h TTL
 *   2)  CreateAsset(URL=12h URL) on the ARK Asset Library account; the server-
 *       side plugin auto-applies Moderation Skip + ProjectName.
 *   3)  Insert a Processing placeholder so the grid shows the new card
 *       immediately.
 *   4)  Background-poll GetAsset until Active or Failed.
 *
 * Updates `assetStore.uploads` for per-stage progress UI; toasts on
 * Active / Failed / pipeline error.
 */
export async function uploadOneAsset(
  input: UploadOneAssetInput,
): Promise<Asset> {
  const {
    upload = uploadToTos,
    signGet = signGetUrl,
    createAsset: createA = createAsset,
    pollAssetUntilDone: pollA = pollAssetUntilDone,
    getNow = Date.now,
  } = input.deps ?? {}

  const cid = clientId()
  const store = useAssetStore.getState()
  const assetName = deriveAssetName(input)

  store.startUpload({
    clientId: cid,
    filename: input.file.name,
    stage: 'tos',
    groupId: input.groupId,
    assetType: input.assetType,
  })

  try {
    // ── Stage 1: TOS PUT ──
    const put = await upload(input.file)

    // ── Stage 1.5: re-sign GET with 12h TTL ──
    useAssetStore.getState().patchUpload(cid, { stage: 'sign-get' })
    const longGet = await signGet(put.key, TOS_GET_TTL_FOR_ASSET_SEC)

    // ── Stage 2: CreateAsset ──
    useAssetStore.getState().patchUpload(cid, { stage: 'create' })
    const created = await createA({
      groupId: input.groupId,
      url: longGet.url,
      assetType: input.assetType,
      name: assetName,
    })
    useAssetStore
      .getState()
      .patchUpload(cid, { stage: 'polling', assetId: created.id })

    // Insert a Processing placeholder so the grid renders the card
    // immediately, even before we have the real ARK record.
    const placeholder: Asset = {
      id: created.id,
      name: assetName,
      url: '',
      groupId: input.groupId,
      assetType: input.assetType,
      status: 'Processing',
      projectName: '',
      createTime: new Date(getNow()).toISOString(),
      updateTime: new Date(getNow()).toISOString(),
    }
    useAssetStore.getState().upsertAsset(placeholder)

    // ── Stage 3: background poll ──
    const final = await pollA(created.id, {
      intervalMs: 5_000,
      maxWaitMs: 600_000,
      onTick: (a) => useAssetStore.getState().upsertAsset(a),
    })
    useAssetStore.getState().upsertAsset(final)
    useAssetStore.getState().patchUpload(cid, { stage: 'done' })
    useAssetStore.getState().finishUpload(cid)

    // Best-effort: refresh the main-panel header count (shown when this
    // group is selected) so it stays in sync with ARK without waiting for
    // a manual reload. Shared with AssetLibraryPage's own call sites —
    // uploads run up to MAX_CONCURRENT_UPLOADS at once into potentially
    // the same group, so the out-of-order guard has to be common state,
    // not a copy private to this file.
    void refreshGroupCount(input.groupId)

    if (final.status === 'Active') {
      toast.success(`資產已就緒：${final.name || final.id}`)
    } else {
      toast.error(`資產處理失敗：${final.error?.message ?? final.id}`)
    }
    return final
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    useAssetStore.getState().patchUpload(cid, { stage: 'error', error: msg })
    useAssetStore.getState().finishUpload(cid)
    toast.error(`上傳失敗（${input.file.name}）：${msg}`)
    throw err
  }
}

/**
 * Kick off many uploads at once with a global concurrency cap of
 * MAX_CONCURRENT_UPLOADS. Resolves once every input has reached a
 * terminal state (success OR failure); the dialog typically does NOT
 * await this — it fires-and-forgets and lets `useAssetJobToasts` render
 * the in-flight set from `assetStore.uploads` as a toast.
 */
export async function startManyAssetUploads(
  inputs: UploadOneAssetInput[],
): Promise<void> {
  await Promise.all(
    inputs.map((input) =>
      uploadSemaphore
        .run(() => uploadOneAsset(input))
        // uploadOneAsset already toasts on failure and clears the store
        // entry, so swallow here to keep Promise.all from short-circuiting.
        .catch(() => undefined),
    ),
  )
}

export function useAssetUpload() {
  const upload = useCallback(
    (input: UploadOneAssetInput) => uploadOneAsset(input),
    [],
  )
  return { upload }
}
