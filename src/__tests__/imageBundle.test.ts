import { describe, it, expect, vi, beforeEach } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { buildImageBundleZip, buildImageBatchZip, importImageBundleZip } from '../api/imageBundle'
import { downloadAssetBlob } from '../api/local'
import type { ImageHistoryItem } from '../types/image'

vi.mock('../api/local', () => ({ downloadAssetBlob: vi.fn() }))
const mockDownload = vi.mocked(downloadAssetBlob)

function makeItem(): ImageHistoryItem {
  return {
    id: 'img-42',
    status: 'succeeded',
    prompt: 'a cat',
    modelKey: 'seedream-5-0-pro',
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_060_000,
    expiresAt: 1_700_086_460_000,
    images: [
      { url: 'https://ark.x.bytepluses.com/a.png', size: '2048x2048' },
      { url: 'https://ark.x.bytepluses.com/b.png' },
    ],
    params: {
      size: '2K', outputFormat: 'png', watermark: false, sequential: false,
      aspectRatio: '1:1', refFilenames: [], refUrls: [],
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('buildImageBundleZip', () => {
  it('zips every image + params.json; failed downloads land in missing', async () => {
    mockDownload
      .mockResolvedValueOnce(new Blob([new Uint8Array([1, 2, 3])]))
      .mockRejectedValueOnce(new Error('410 gone'))

    const { bytes, missing } = await buildImageBundleZip(makeItem())
    const files = unzipSync(bytes)

    expect(Object.keys(files).sort()).toEqual(['images/image-1.png', 'params.json'])
    expect(missing).toEqual(['images/image-2.png'])
    const meta = JSON.parse(new TextDecoder().decode(files['params.json']))
    expect(meta.id).toBe('img-42')
    expect(meta.prompt).toBe('a cat')
    expect(meta.model_key).toBe('seedream-5-0-pro')
    expect(meta.missing).toEqual(['images/image-2.png'])
  })
})

describe('buildImageBatchZip', () => {
  it('places each item under its own id folder', async () => {
    mockDownload.mockResolvedValue(new Blob([new Uint8Array([9])]))
    const a: ImageHistoryItem = { ...makeItem(), id: 'img-a', images: [{ url: 'https://x/a.png' }] }
    const b: ImageHistoryItem = { ...makeItem(), id: 'img-b', images: [{ url: 'https://x/b.png' }] }

    const { bytes, missing } = await buildImageBatchZip([a, b])
    const files = unzipSync(bytes)

    expect(Object.keys(files).sort()).toEqual([
      'img-a/images/image-1.png',
      'img-a/params.json',
      'img-b/images/image-1.png',
      'img-b/params.json',
    ])
    expect(missing).toEqual([])
    const metaB = JSON.parse(new TextDecoder().decode(files['img-b/params.json']))
    expect(metaB.id).toBe('img-b')
  })
})

describe('importImageBundleZip', () => {
  it('restores an item with blob objectURLs and imported=true', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:restored')
    // Re-wrap TextEncoder output into a same-realm Uint8Array. Under jsdom,
    // fflate's `zipSync` treats a cross-realm Uint8Array as a directory tree
    // (see importBundle.test.ts' makeZipFile for the same workaround).
    const zipBytes = zipSync({
      'params.json': new Uint8Array(new TextEncoder().encode(JSON.stringify({
        id: 'img-42', status: 'succeeded', prompt: 'a cat',
        model_key: 'seedream-5-0-pro',
        created_at: '2023-11-14T22:13:20.000Z',
        params: {
          size: '2K', watermark: false, sequential: false,
          refFilenames: [], refUrls: [],
        },
        image_count: 1,
      }))),
      'images/image-1.png': new Uint8Array([1, 2, 3]),
    })
    const file = new File([zipBytes as BlobPart], 'bundle.zip', { type: 'application/zip' })

    const items = await importImageBundleZip(file)
    expect(items).toHaveLength(1)
    expect(items[0].imported).toBe(true)
    expect(items[0].prompt).toBe('a cat')
    expect(items[0].images).toEqual([{ url: 'blob:restored' }])
    expect(items[0].id).toMatch(/^imported-/)
  })

  it('defaults params when a foreign params.json lacks the params field', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:foreign')
    const zipBytes = zipSync({
      'params.json': new Uint8Array(new TextEncoder().encode(JSON.stringify({
        id: 'ext-1', status: 'succeeded', prompt: 'no params key',
        model_key: 'seedream-4-0',
        created_at: '2023-11-14T22:13:20.000Z',
        image_count: 1,
        // 注意：刻意沒有 params 欄位（外部工具產生的 zip）
      }))),
      'images/image-1.png': new Uint8Array([1]),
    })
    const file = new File([zipBytes as BlobPart], 'foreign.zip', { type: 'application/zip' })

    const items = await importImageBundleZip(file)
    expect(items).toHaveLength(1)
    expect(items[0].params).toEqual({
      watermark: false, sequential: false, refFilenames: [], refUrls: [],
    })
  })
})
