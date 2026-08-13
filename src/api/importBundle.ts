import { unzip } from 'fflate'
import type { VideoHistoryItem, CreateVideoTaskRequest, TaskStatus, ImageRole } from '../types'

/** Known image roles. Bundles from a future version (or hand-edited
 *  task.json) may carry a role outside this set — normalize to
 *  `reference_image` rather than propagate garbage into the store. */
const KNOWN_ROLES = ['first_frame', 'last_frame', 'reference_image'] as const

function normalizeRole(r: unknown): ImageRole {
  if (typeof r === 'string' && (KNOWN_ROLES as readonly string[]).includes(r)) {
    return r as ImageRole
  }
  console.warn('[importBundle] unknown role, falling back to reference_image:', r)
  return 'reference_image'
}

/** Revoke every `blob:` URL stored on an imported VideoHistoryItem — the
 *  output object URL, the last-frame object URL, and any reference URLs
 *  inside `requestContent.content[]` that were rewritten to blob: URLs by
 *  toHistoryItem. Call this BEFORE the item leaves history (removeHistory,
 *  clearHistory, or duplicate-skip during import) so we don't leak Blob
 *  references that pin tens of MB of video data per task. */
export function revokeImportedUrls(
  item: Pick<VideoHistoryItem, 'objectUrl' | 'frameObjectUrl' | 'requestContent'>,
): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  const tryRevoke = (u: string | undefined): void => {
    if (u && u.startsWith('blob:')) {
      try { URL.revokeObjectURL(u) } catch { /* ignore — not a real blob URL */ }
    }
  }
  tryRevoke(item.objectUrl)
  tryRevoke(item.frameObjectUrl)
  const content = item.requestContent?.content
  if (!Array.isArray(content)) return
  for (const c of content as unknown as Array<Record<string, unknown>>) {
    if (c.type === 'image_url') tryRevoke((c.image_url as { url?: string } | undefined)?.url)
    else if (c.type === 'video_url') tryRevoke((c.video_url as { url?: string } | undefined)?.url)
    else if (c.type === 'audio_url') tryRevoke((c.audio_url as { url?: string } | undefined)?.url)
  }
}

/** Result of parsing one task folder/bundle. Paths are normalized to be
 *  relative to the task root (no leading task-folder name). */
export interface ParsedTask {
  /** Raw task.json content (URLs in this object still reference relative
   *  paths like "./output/video.mp4"). */
  taskJson: Record<string, unknown>
  /** Blob for output/video.mp4 if present. */
  videoBlob?: Blob
  /** Blob for output/last_frame.png if present. */
  lastFrameBlob?: Blob
  /** Map keyed by relative path (e.g. "references/ref-1.png") → Blob. */
  referenceBlobs: Map<string, Blob>
}

/** Strip the leading folder segment(s) and return the path relative to the
 *  task root. Returns null if the file is not under a task folder
 *  (i.e. no task.json sibling). The caller already grouped by task root. */
function stripTaskRoot(fullPath: string, taskRoot: string): string {
  if (!fullPath.startsWith(taskRoot + '/')) return fullPath
  return fullPath.slice(taskRoot.length + 1)
}

/** Group files by the directory containing their task.json. */
function groupByTaskRoot(files: File[]): Map<string, File[]> {
  const taskRoots = new Set<string>()
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name
    if (rel.endsWith('/task.json') || rel === 'task.json') {
      const taskRoot = rel === 'task.json' ? '' : rel.slice(0, -'/task.json'.length)
      taskRoots.add(taskRoot)
    }
  }
  const grouped = new Map<string, File[]>()
  for (const root of taskRoots) grouped.set(root, [])
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name
    // Find the longest taskRoot that this file lives under
    let bestRoot: string | null = null
    for (const root of taskRoots) {
      if (root === '' && !rel.includes('/')) {
        bestRoot = root
      } else if (rel.startsWith(root + '/')) {
        if (bestRoot === null || root.length > bestRoot.length) bestRoot = root
      }
    }
    if (bestRoot !== null) grouped.get(bestRoot)!.push(f)
  }
  return grouped
}

/** Locate `_shared/` reference binaries living at the same depth as the
 *  task folders (i.e. siblings of taskRoot, not children). Batch exports
 *  put deduped references at `<parent>/_shared/<hash>.<ext>`; each task's
 *  task.json points at them via `../_shared/...` relative paths. We key
 *  the returned map by exactly that `../_shared/...` string so it matches
 *  what `toHistoryItem`'s `tryRewriteRefUrl` will look up later. */
function collectSharedAt(parent: string, allFiles: File[]): Map<string, Blob> {
  const out = new Map<string, Blob>()
  const sharedPrefix = parent ? `${parent}/_shared/` : '_shared/'
  for (const f of allFiles) {
    const rel = f.webkitRelativePath || f.name
    if (rel.startsWith(sharedPrefix)) {
      const filename = rel.slice(sharedPrefix.length)
      out.set(`../_shared/${filename}`, f)
    }
  }
  return out
}

/** Parse a flat list of File objects (from webkitdirectory or drag-drop
 *  webkitGetAsEntry traversal) into one or more ParsedTask records.
 *  Folders without a task.json are silently skipped. */
export async function parseTaskFolder(files: File[]): Promise<ParsedTask[]> {
  const grouped = groupByTaskRoot(files)
  const out: ParsedTask[] = []

  for (const [taskRoot, taskFiles] of grouped) {
    const taskJsonFile = taskFiles.find((f) => {
      const rel = f.webkitRelativePath || f.name
      return rel === (taskRoot ? `${taskRoot}/task.json` : 'task.json')
    })
    if (!taskJsonFile) continue

    let taskJson: Record<string, unknown>
    try {
      taskJson = JSON.parse(await taskJsonFile.text()) as Record<string, unknown>
    } catch {
      continue
    }

    const refs = new Map<string, Blob>()
    let videoBlob: Blob | undefined
    let lastFrameBlob: Blob | undefined

    for (const f of taskFiles) {
      const rel = f.webkitRelativePath || f.name
      const inner = taskRoot ? stripTaskRoot(rel, taskRoot) : rel
      if (inner === 'task.json') continue
      if (inner === 'output/video.mp4') {
        videoBlob = f
      } else if (inner === 'output/last_frame.png') {
        lastFrameBlob = f
      } else if (inner.startsWith('references/')) {
        refs.set(inner, f)
      }
    }

    // Merge sibling `_shared/` files. parent = everything before the last
    // segment of taskRoot; '' for single-task layouts at the top level.
    const lastSlash = taskRoot.lastIndexOf('/')
    const parent = lastSlash >= 0 ? taskRoot.slice(0, lastSlash) : ''
    for (const [k, v] of collectSharedAt(parent, files)) {
      refs.set(k, v)
    }

    out.push({ taskJson, videoBlob, lastFrameBlob, referenceBlobs: refs })
  }

  return out
}

/** Read a zip File and return ParsedTask records. Per-task subfolders are
 *  detected by the location of each `task.json`. Files outside any task
 *  folder are exposed via the *first* task that references them with a
 *  `../` relative path (used for `_shared/` dedup in batch exports). */
export async function parseTaskZip(zipFile: File): Promise<ParsedTask[]> {
  const buf = new Uint8Array(await zipFile.arrayBuffer())
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buf, (err, data) => (err ? reject(err) : resolve(data)))
  })

  // Find all task.json locations to determine task roots
  const taskRoots: string[] = []
  for (const path of Object.keys(entries)) {
    if (path.endsWith('/task.json')) {
      taskRoots.push(path.slice(0, -'/task.json'.length))
    } else if (path === 'task.json') {
      taskRoots.push('')
    }
  }

  const out: ParsedTask[] = []

  for (const root of taskRoots) {
    const taskJsonKey = root ? `${root}/task.json` : 'task.json'
    let taskJson: Record<string, unknown>
    try {
      taskJson = JSON.parse(new TextDecoder().decode(entries[taskJsonKey])) as Record<string, unknown>
    } catch {
      continue
    }

    const refs = new Map<string, Blob>()
    let videoBlob: Blob | undefined
    let lastFrameBlob: Blob | undefined

    for (const [path, bytes] of Object.entries(entries)) {
      if (path === taskJsonKey) continue
      let inner: string | null
      if (root === '') {
        // task.json at zip root → every non-shared file is "inside" this task
        inner = path.startsWith('_shared/') ? null : path
      } else if (path.startsWith(root + '/')) {
        inner = path.slice(root.length + 1)
      } else {
        inner = null
      }

      if (inner === 'output/video.mp4') {
        videoBlob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
      } else if (inner === 'output/last_frame.png') {
        lastFrameBlob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      } else if (inner && inner.startsWith('references/')) {
        refs.set(inner, new Blob([new Uint8Array(bytes)]))
      } else if (path.startsWith('_shared/')) {
        // Shared assets are addressable from inside a task folder via "../_shared/..."
        refs.set(`../${path}`, new Blob([new Uint8Array(bytes)]))
      }
    }

    out.push({ taskJson, videoBlob, lastFrameBlob, referenceBlobs: refs })
  }

  return out
}

function tryRewriteRefUrl(
  url: string,
  refs: Map<string, Blob>,
): string {
  // Accept "./references/...", "references/...", "../_shared/...", "_shared/..."
  const stripped = url.replace(/^\.\//, '')
  const blob = refs.get(stripped) ?? refs.get(url)
  return blob ? URL.createObjectURL(blob) : url
}

/** Normalize a ParsedTask into the in-memory VideoHistoryItem the UI uses.
 *  All blob fields become object URLs (in-memory only — page reload kills
 *  them). The caller is responsible for revoking those URLs when the item
 *  is removed from history. */
export async function toHistoryItem(parsed: ParsedTask): Promise<VideoHistoryItem> {
  const tj = parsed.taskJson as Record<string, unknown>
  const request = (tj.request as Record<string, unknown> | undefined) ?? { model: '', content: [] }
  const result = (tj.result as Record<string, unknown> | undefined) ?? {}

  // Deep-rewrite request.content reference URLs to object URLs where the
  // matching blob exists.
  const origContent = Array.isArray(request.content) ? (request.content as Array<Record<string, unknown>>) : []
  const newContent = origContent.map((c) => {
    if (c.type === 'image_url') {
      const inner = c.image_url as { url: string }
      return {
        ...c,
        image_url: { ...inner, url: tryRewriteRefUrl(inner.url, parsed.referenceBlobs) },
        role: normalizeRole((c as { role?: unknown }).role),
      }
    }
    if (c.type === 'video_url') {
      const inner = c.video_url as { url: string }
      return { ...c, video_url: { ...inner, url: tryRewriteRefUrl(inner.url, parsed.referenceBlobs) } }
    }
    if (c.type === 'audio_url') {
      const inner = c.audio_url as { url: string }
      return { ...c, audio_url: { ...inner, url: tryRewriteRefUrl(inner.url, parsed.referenceBlobs) } }
    }
    return c
  })

  const objectUrl = parsed.videoBlob ? URL.createObjectURL(parsed.videoBlob) : undefined
  const frameObjectUrl = parsed.lastFrameBlob ? URL.createObjectURL(parsed.lastFrameBlob) : undefined

  const createdAt = typeof tj.created_at === 'string'
    ? new Date(tj.created_at).getTime() / 1000
    : Date.now() / 1000

  const requestContent: CreateVideoTaskRequest = {
    model: (request.model as string) ?? '',
    content: newContent as unknown as CreateVideoTaskRequest['content'],
    ratio: request.ratio as string | undefined,
    duration: request.duration as number | undefined,
    resolution: request.resolution as string | undefined,
    watermark: request.watermark as boolean | undefined,
    generate_audio: request.generate_audio as boolean | undefined,
    return_last_frame: request.return_last_frame as boolean | undefined,
  }

  return {
    taskId: tj.task_id as string,
    status: ((tj.status as string) || 'succeeded') as TaskStatus,
    prompt: (tj.prompt as string) ?? '',
    videoUrl: undefined,        // signed URLs from old exports are gone; we play objectUrl
    objectUrl,
    lastFrameUrl: undefined,
    frameObjectUrl,
    createdAt,
    seed: result.seed as number | undefined,
    resolution: result.resolution as string | undefined,
    fps: result.fps as number | undefined,
    ratio: request.ratio as string | undefined,
    duration: request.duration as number | undefined,
    error: tj.error as string | undefined,
    requestContent,
    imported: true,
  }
}
