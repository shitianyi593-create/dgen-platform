/**
 * Export / Import 高階整合測試。
 * 細部單元測試在 exportBundle.test.ts 與 importBundle.test.ts。
 *
 * 這支測試只驗證：
 * - export 出來的 zip 可以被 import 還原成等價的 VideoHistoryItem
 * - 過期素材以 missing 標記但不阻擋匯出
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VideoHistoryItem } from '../types'

let originalCreateObjectURL: typeof URL.createObjectURL | undefined
let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined

beforeEach(() => {
  let counter = 0
  originalCreateObjectURL = URL.createObjectURL
  originalRevokeObjectURL = URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => `blob:roundtrip-${counter++}`) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
})
afterEach(() => {
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL
  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL
  vi.resetModules()
})

describe('Export → Import round-trip', () => {
  it('preserves task_id, prompt, request fields, status across the bundle boundary', async () => {
    vi.doMock('../api/local', () => ({
      downloadAssetBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3]) as BlobPart])),
    }))
    const { buildBundleZip } = await import('../api/exportBundle')
    const { parseTaskZip, toHistoryItem } = await import('../api/importBundle')

    const source: VideoHistoryItem = {
      taskId: 'cgt-rt-1',
      status: 'succeeded',
      prompt: '一隻貓在跳舞',
      createdAt: 1715000000,
      videoUrl: 'https://signed.bytepluses.com/v.mp4?sig=x',
      requestContent: {
        model: 'ep-rt',
        content: [{ type: 'text', text: '一隻貓' }],
        ratio: '16:9',
        duration: 5,
      },
      seed: 42,
      resolution: '1280x720',
      fps: 24,
    }

    const { bytes } = await buildBundleZip(source)
    const zipFile = new File([bytes as BlobPart], 'cgt-rt-1.zip', { type: 'application/zip' })
    const parsed = await parseTaskZip(zipFile)
    expect(parsed).toHaveLength(1)
    const restored = await toHistoryItem(parsed[0])

    expect(restored.taskId).toBe('cgt-rt-1')
    expect(restored.prompt).toBe('一隻貓在跳舞')
    expect(restored.status).toBe('succeeded')
    expect(restored.seed).toBe(42)
    expect(restored.resolution).toBe('1280x720')
    expect(restored.fps).toBe(24)
    expect(restored.requestContent?.model).toBe('ep-rt')
    expect(restored.requestContent?.ratio).toBe('16:9')
    expect(restored.objectUrl).toMatch(/^blob:roundtrip-/)
    expect(restored.imported).toBe(true)
  })

  it('handles expired video_url by marking it missing and still producing a zip', async () => {
    vi.doMock('../api/local', () => ({
      downloadAssetBlob: vi.fn(async () => { throw new Error('502 expired') }),
    }))
    const { buildBundleZip } = await import('../api/exportBundle')
    const source: VideoHistoryItem = {
      taskId: 'cgt-expired',
      status: 'succeeded',
      prompt: 'old',
      createdAt: 1715000000,
      videoUrl: 'https://signed.bytepluses.com/expired.mp4',
      requestContent: { model: 'm', content: [] },
    }
    const { bytes, missing } = await buildBundleZip(source)
    expect(missing).toEqual(['output/video.mp4'])
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})
