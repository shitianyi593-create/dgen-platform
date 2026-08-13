import { zip } from 'fflate'
import type { VideoHistoryItem, ContentItem } from '../types'
import { downloadAssetBlob } from './local'

/** A single binary entry in the bundle: what to fetch and where to put it. */
export interface BundleEntry {
  /** Path inside the zip (POSIX, no leading slash). */
  path: string
  /** Remote URL to fetch via /local-api/download-asset. */
  sourceUrl: string
}

/** The serializable task.json that goes into the bundle. URLs in the
 *  request content and result fields are rewritten to relative paths
 *  pointing at sibling entries in the same bundle. */
export interface BundleTaskJson {
  task_id: string
  created_at: string
  status: string
  prompt: string
  request: {
    model: string
    content: unknown[]
    ratio?: string
    duration?: number
    resolution?: string
    watermark?: boolean
    generate_audio?: boolean
    return_last_frame?: boolean
  }
  result: {
    video_url: string | null
    last_frame_url: string | null
    seed?: number
    resolution?: string
    fps?: number
  }
  error?: string
  /** Entries flagged here failed to download at export time. */
  missing?: string[]
}

export interface BundleManifest {
  entries: BundleEntry[]
  taskJson: BundleTaskJson
}

const URL_EXT_RE = /\.([A-Za-z0-9]{1,5})(?:$|[?#])/

function extFromUrl(url: string): string {
  // Strip query/fragment, then match last ".ext" before end or ? or #
  const m = url.match(URL_EXT_RE)
  return m ? m[1].toLowerCase() : 'bin'
}

/** Build the file manifest + rewritten task.json for a single history item.
 *  Pure: no fetches, no side effects. */
export function buildBundleManifest(item: VideoHistoryItem): BundleManifest {
  const entries: BundleEntry[] = []

  // Walk request.content; rewrite reference URLs in a deep-cloned copy.
  // refIdx is a running counter over reference items (text items don't bump it),
  // so ref-N matches the Nth media reference regardless of interleaved text.
  const originalContent: ContentItem[] = (item.requestContent?.content ?? []) as ContentItem[]
  let refIdx = 0
  const rewrittenContent: unknown[] = originalContent.map((c) => {
    if (c.type === 'image_url') {
      refIdx += 1
      const url = c.image_url.url
      const path = `references/ref-${refIdx}.${extFromUrl(url)}`
      entries.push({ path, sourceUrl: url })
      return { ...c, image_url: { ...c.image_url, url: `./${path}` } }
    }
    if (c.type === 'video_url') {
      refIdx += 1
      const url = c.video_url.url
      const path = `references/ref-${refIdx}.${extFromUrl(url)}`
      entries.push({ path, sourceUrl: url })
      return { ...c, video_url: { ...c.video_url, url: `./${path}` } }
    }
    if (c.type === 'audio_url') {
      refIdx += 1
      const url = c.audio_url.url
      const path = `references/ref-${refIdx}.${extFromUrl(url)}`
      entries.push({ path, sourceUrl: url })
      return { ...c, audio_url: { ...c.audio_url, url: `./${path}` } }
    }
    return c
  })

  let videoRelPath: string | null = null
  if (item.videoUrl) {
    const path = 'output/video.mp4'
    entries.push({ path, sourceUrl: item.videoUrl })
    videoRelPath = `./${path}`
  }

  let lastFrameRelPath: string | null = null
  if (item.lastFrameUrl) {
    const path = 'output/last_frame.png'
    entries.push({ path, sourceUrl: item.lastFrameUrl })
    lastFrameRelPath = `./${path}`
  }

  const taskJson: BundleTaskJson = {
    task_id: item.taskId,
    created_at: new Date(item.createdAt * 1000).toISOString(),
    status: item.status,
    prompt: item.prompt,
    request: item.requestContent
      ? {
          model: item.requestContent.model,
          content: rewrittenContent,
          ratio: item.requestContent.ratio,
          duration: item.requestContent.duration,
          resolution: item.requestContent.resolution,
          watermark: item.requestContent.watermark,
          generate_audio: item.requestContent.generate_audio,
          return_last_frame: item.requestContent.return_last_frame,
        }
      : { model: '', content: [] },
    result: {
      video_url: videoRelPath,
      last_frame_url: lastFrameRelPath,
      seed: item.seed,
      resolution: item.resolution,
      fps: item.fps,
    },
    error: item.error,
  }

  return { entries, taskJson }
}

export interface BuiltBundle {
  bytes: Uint8Array
  missing: string[]
}

async function blobToUint8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** fflate checks `val instanceof Uint8Array` against its own captured global.
 *  Bytes from a different realm (e.g. jsdom-wrapped TextEncoder, web workers)
 *  fail that check and get treated as a nested directory tree. Re-wrap each
 *  entry as a same-realm Uint8Array so fflate always sees a leaf. */
export function normalizeForFflate(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(files)) {
    out[k] = v instanceof Uint8Array
      ? v
      : new Uint8Array((v as Uint8Array).buffer, (v as Uint8Array).byteOffset, (v as Uint8Array).byteLength)
  }
  return out
}

/** Build a single-task zip bundle, fetching every entry through the
 *  asset-download proxy. Entries that fail to download are excluded from
 *  the zip and reported in `missing`; the task.json still lists their
 *  intended relative paths in its `missing` field. */
export async function buildBundleZip(item: VideoHistoryItem): Promise<BuiltBundle> {
  const manifest = buildBundleManifest(item)
  const missing: string[] = []
  const files: Record<string, Uint8Array> = {}

  // Fetch in parallel — sequential download of dozens of MB serially is painful UX
  const results = await Promise.allSettled(
    manifest.entries.map(async (e) => ({
      path: e.path,
      bytes: await blobToUint8(await downloadAssetBlob(e.sourceUrl, e.path.split('/').pop()!)),
    })),
  )

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      files[r.value.path] = r.value.bytes
    } else {
      missing.push(manifest.entries[i].path)
    }
  }

  if (missing.length > 0) {
    manifest.taskJson.missing = missing
  }
  files['task.json'] = new TextEncoder().encode(JSON.stringify(manifest.taskJson, null, 2))

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(normalizeForFflate(files), (err, data) => (err ? reject(err) : resolve(data)))
  })
  return { bytes, missing }
}

export interface BatchBuiltBundle {
  bytes: Uint8Array
  missing: string[]                       // shared-asset paths that failed
  perTaskMissing: Record<string, string[]> // taskId → list of in-task paths that failed
}

/** Tiny non-crypto hash, sufficient for naming shared-asset paths inside the
 *  zip. We just want consistent filenames per URL inside one bundle. */
function hashUrl(url: string): string {
  let h = 5381
  for (let i = 0; i < url.length; i++) {
    h = ((h * 33) ^ url.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

/** Build a batch zip containing many tasks. References that appear in
 *  multiple tasks are downloaded once and placed under `_shared/`, with
 *  each task.json pointing at them via `../_shared/<hash>.<ext>`. */
export async function buildBatchBundleZip(
  items: VideoHistoryItem[],
): Promise<BatchBuiltBundle> {
  const files: Record<string, Uint8Array> = {}
  const missing: string[] = []
  const perTaskMissing: Record<string, string[]> = {}

  // Phase 1: collect every URL across all tasks, dedupe references (only refs;
  // output mp4 / frame stay per-task because they're inherently unique).
  type Plan = {
    taskId: string
    manifest: BundleManifest
    /** Per-entry override: if set, replace the original entry's path with
     *  this shared path in task.json. Index aligned with manifest.entries. */
    sharedOverride: (string | null)[]
  }
  const sharedUrlToPath = new Map<string, string>()
  const plans: Plan[] = items.map((item) => {
    const manifest = buildBundleManifest(item)
    const sharedOverride: (string | null)[] = manifest.entries.map((e) => {
      if (!e.path.startsWith('references/')) return null
      const existing = sharedUrlToPath.get(e.sourceUrl)
      if (existing) return existing
      const ext = e.path.split('.').pop() ?? 'bin'
      const shared = `_shared/${hashUrl(e.sourceUrl)}.${ext}`
      sharedUrlToPath.set(e.sourceUrl, shared)
      return shared
    })
    return { taskId: item.taskId, manifest, sharedOverride }
  })

  // Phase 2: download all shared assets once
  const sharedEntries = Array.from(sharedUrlToPath.entries())
  const sharedResults = await Promise.allSettled(
    sharedEntries.map(async ([url, path]) => ({
      path,
      bytes: new Uint8Array(
        await (await downloadAssetBlob(url, path.split('/').pop()!)).arrayBuffer(),
      ),
    })),
  )
  const sharedFailed = new Set<string>()
  for (let i = 0; i < sharedResults.length; i++) {
    const r = sharedResults[i]
    if (r.status === 'fulfilled') {
      files[r.value.path] = r.value.bytes
    } else {
      missing.push(sharedEntries[i][1])
      sharedFailed.add(sharedEntries[i][0])  // url
    }
  }

  // Phase 3: per-task, download non-shared (output) entries and write task.json
  for (const plan of plans) {
    const taskMissing: string[] = []
    const fetchList: Array<{ idx: number; entry: BundleEntry }> = []
    for (let i = 0; i < plan.manifest.entries.length; i++) {
      if (plan.sharedOverride[i] === null) {
        fetchList.push({ idx: i, entry: plan.manifest.entries[i] })
      }
    }
    const results = await Promise.allSettled(
      fetchList.map(async ({ entry }) => ({
        path: `${plan.taskId}/${entry.path}`,
        bytes: new Uint8Array(
          await (await downloadAssetBlob(entry.sourceUrl, entry.path.split('/').pop()!)).arrayBuffer(),
        ),
      })),
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled') {
        files[r.value.path] = r.value.bytes
      } else {
        taskMissing.push(fetchList[i].entry.path)
      }
    }

    // Rewrite task.json paths for shared references
    const content = plan.manifest.taskJson.request.content as Array<Record<string, unknown>>
    let refIdx = 0
    const newContent = content.map((c) => {
      if (c.type !== 'image_url' && c.type !== 'video_url' && c.type !== 'audio_url') return c
      const shared = plan.sharedOverride[refIdx]
      const origPath = plan.manifest.entries[refIdx].path
      const origUrl = plan.manifest.entries[refIdx].sourceUrl
      refIdx++
      if (shared && !sharedFailed.has(origUrl)) {
        const key = c.type
        const inner = c[key] as { url: string }
        return { ...c, [key]: { ...inner, url: `../${shared}` } }
      }
      if (sharedFailed.has(origUrl)) {
        taskMissing.push(origPath)
      }
      return c
    })
    plan.manifest.taskJson.request.content = newContent

    if (taskMissing.length > 0) {
      plan.manifest.taskJson.missing = taskMissing
      perTaskMissing[plan.taskId] = taskMissing
    }

    files[`${plan.taskId}/task.json`] = new TextEncoder().encode(
      JSON.stringify(plan.manifest.taskJson, null, 2),
    )
  }

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(normalizeForFflate(files), (err, data) => (err ? reject(err) : resolve(data)))
  })
  return { bytes, missing, perTaskMissing }
}

/** Trigger a browser download of a Blob with a suggested filename.
 *  Browser settings determine whether a save dialog is shown. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
