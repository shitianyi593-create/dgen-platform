import { zip, unzip } from 'fflate'
import type { ImageHistoryItem } from '../types/image'
import { downloadAssetBlob } from './local'
import { normalizeForFflate } from './exportBundle'

/** params.json 的形状（zip 内的任务中继数据）。 */
export interface ImageBundleJson {
  id: string
  status: string
  prompt: string
  model_key: string
  created_at: string
  params: ImageHistoryItem['params']
  image_count: number
  missing?: string[]
}

function extFromUrl(url: string): string {
  const m = url.match(/\.([A-Za-z0-9]{1,5})(?:$|[?#])/)
  return m ? m[1].toLowerCase() : 'png'
}

export interface BuiltImageBundle {
  bytes: Uint8Array
  missing: string[]
}

/** 单笔历史 → zip（images/image-N.ext + params.json）。下载失败的图列入 missing。 */
export async function buildImageBundleZip(item: ImageHistoryItem): Promise<BuiltImageBundle> {
  const files: Record<string, Uint8Array> = {}
  const missing: string[] = []

  const results = await Promise.allSettled(
    item.images.map(async (img, i) => {
      const path = `images/image-${i + 1}.${extFromUrl(img.url)}`
      const blob = await downloadAssetBlob(img.url, path.split('/').pop()!)
      return { path, bytes: new Uint8Array(await blob.arrayBuffer()) }
    }),
  )
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') files[r.value.path] = r.value.bytes
    else missing.push(`images/image-${i + 1}.${extFromUrl(item.images[i].url)}`)
  }

  const meta: ImageBundleJson = {
    id: item.id,
    status: item.status,
    prompt: item.prompt,
    model_key: item.modelKey,
    created_at: new Date(item.createdAt).toISOString(),
    params: item.params,
    image_count: item.images.length,
    ...(missing.length > 0 ? { missing } : {}),
  }
  files['params.json'] = new TextEncoder().encode(JSON.stringify(meta, null, 2))

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(normalizeForFflate(files), (err, data) => (err ? reject(err) : resolve(data)))
  })
  return { bytes, missing }
}

/** 多笔 → 每笔一个数据夹（<id>/images/... + <id>/params.json）。 */
export async function buildImageBatchZip(items: ImageHistoryItem[]): Promise<BuiltImageBundle> {
  const files: Record<string, Uint8Array> = {}
  const missing: string[] = []
  for (const item of items) {
    const single = await buildImageBundleZip(item)
    const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      unzip(single.bytes, (err, data) => (err ? reject(err) : resolve(data)))
    })
    for (const [path, bytes] of Object.entries(entries)) {
      files[`${item.id}/${path}`] = bytes
    }
    missing.push(...single.missing.map((p) => `${item.id}/${p}`))
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(normalizeForFflate(files), (err, data) => (err ? reject(err) : resolve(data)))
  })
  return { bytes, missing }
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

/**
 * 导入 zip → ImageHistoryItem[]。支持单笔（根层 params.json）与批次
 * （<folder>/params.json）。图片转 blob objectURL（仅存活于本页，不持久化）。
 */
export async function importImageBundleZip(file: File): Promise<ImageHistoryItem[]> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buf, (err, data) => (err ? reject(err) : resolve(data)))
  })

  const metaPaths = Object.keys(entries).filter((p) => p.endsWith('params.json'))
  if (metaPaths.length === 0) throw new Error('zip 内找不到 params.json')

  const items: ImageHistoryItem[] = []
  // 中途失败（例如后面某个 params.json 坏掉）要先释放已创建的 objectURL 再
  // rethrow，否则部分导入会泄漏 blob（同 VideoHistory.importFiles 的惯例）。
  const createdUrls: string[] = []
  try {
    for (const metaPath of metaPaths) {
      const prefix = metaPath.slice(0, metaPath.length - 'params.json'.length) // '' 或 '<id>/'
      const meta = JSON.parse(new TextDecoder().decode(entries[metaPath])) as ImageBundleJson
      const imagePaths = Object.keys(entries)
        .filter((p) => p.startsWith(`${prefix}images/`))
        .sort()
      const images = imagePaths.map((p) => {
        const ext = p.split('.').pop() ?? 'png'
        const blob = new Blob([entries[p] as BlobPart], {
          type: IMAGE_MIME_BY_EXT[ext] ?? 'image/png',
        })
        const url = URL.createObjectURL(blob)
        createdUrls.push(url)
        return { url }
      })
      items.push({
        id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        status: meta.status === 'failed' ? 'failed' : 'succeeded',
        prompt: meta.prompt,
        modelKey: (meta.model_key as ImageHistoryItem['modelKey']) ?? 'seedream-5-0-pro',
        createdAt: Date.parse(meta.created_at) || Date.now(),
        images,
        imported: true,
        // 外部产生的 zip 可能没有 params 字段 — 给安全默认，避免历史列表
        // 读 params.refFilenames 等字段时直接 crash。
        params: meta.params ?? {
          watermark: false, sequential: false, refFilenames: [], refUrls: [],
        },
      })
    }
  } catch (e) {
    for (const url of createdUrls) {
      try { URL.revokeObjectURL(url) } catch { /* test env 可能没有 revoke */ }
    }
    throw e
  }
  return items
}
