import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildBundleManifest } from '../api/exportBundle'
import type { VideoHistoryItem } from '../types'

describe('buildBundleManifest', () => {
  it('produces output entries for video + lastFrame and rewrites task.json paths', () => {
    const item: VideoHistoryItem = {
      taskId: 'cgt-001',
      status: 'succeeded',
      prompt: 'a cat',
      createdAt: 1715000000,
      videoUrl: 'https://signed.bytepluses.com/v.mp4?sig=abc',
      lastFrameUrl: 'https://signed.bytepluses.com/last.png?sig=def',
      requestContent: { model: 'ep-test', content: [] },
    }

    const manifest = buildBundleManifest(item)

    expect(manifest.entries).toEqual([
      { path: 'output/video.mp4', sourceUrl: 'https://signed.bytepluses.com/v.mp4?sig=abc' },
      { path: 'output/last_frame.png', sourceUrl: 'https://signed.bytepluses.com/last.png?sig=def' },
    ])
    expect(manifest.taskJson.result.video_url).toBe('./output/video.mp4')
    expect(manifest.taskJson.result.last_frame_url).toBe('./output/last_frame.png')
  })

  it('extracts image/video/audio reference URLs into references/ entries', () => {
    const item: VideoHistoryItem = {
      taskId: 'cgt-002',
      status: 'succeeded',
      prompt: 'with refs',
      createdAt: 1715000000,
      requestContent: {
        model: 'ep-test',
        content: [
          { type: 'text', text: 'a cat with this look' },
          { type: 'image_url', image_url: { url: 'https://ark.bytepluses.com/img.png?sig=1' }, role: 'reference_image' },
          { type: 'video_url', video_url: { url: 'https://tos.bytepluses.com/v.mp4?sig=2' }, role: 'reference_video' },
        ],
      },
    }

    const manifest = buildBundleManifest(item)

    expect(manifest.entries).toEqual([
      { path: 'references/ref-1.png', sourceUrl: 'https://ark.bytepluses.com/img.png?sig=1' },
      { path: 'references/ref-2.mp4', sourceUrl: 'https://tos.bytepluses.com/v.mp4?sig=2' },
    ])

    const content = manifest.taskJson.request.content as Array<Record<string, unknown>>
    expect(content[0]).toEqual({ type: 'text', text: 'a cat with this look' })
    expect((content[1].image_url as { url: string }).url).toBe('./references/ref-1.png')
    expect((content[2].video_url as { url: string }).url).toBe('./references/ref-2.mp4')
  })

  it('infers extension from URL pathname, falling back to .bin', () => {
    const item: VideoHistoryItem = {
      taskId: 'cgt-003',
      status: 'succeeded',
      prompt: 'x',
      createdAt: 1715000000,
      requestContent: {
        model: 'ep-test',
        content: [
          { type: 'image_url', image_url: { url: 'https://x.bytepluses.com/foo.jpeg?x=1' }, role: 'reference_image' },
          { type: 'audio_url', audio_url: { url: 'https://x.bytepluses.com/noext?x=1' }, role: 'reference_audio' },
        ],
      },
    }

    const manifest = buildBundleManifest(item)
    expect(manifest.entries[0].path).toBe('references/ref-1.jpeg')
    expect(manifest.entries[1].path).toBe('references/ref-2.bin')
  })

  it('produces empty entries list for a failed task with no urls', () => {
    const item: VideoHistoryItem = {
      taskId: 'cgt-fail',
      status: 'failed',
      prompt: 'bad',
      createdAt: 1715000000,
      error: 'content policy',
    }
    const manifest = buildBundleManifest(item)
    expect(manifest.entries).toEqual([])
    expect(manifest.taskJson.error).toBe('content policy')
  })
})

describe('buildBundleZip', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fetches each entry, packages them, and includes task.json', async () => {
    const fetchedUrls: string[] = []
    vi.doMock('../api/local', () => ({
      downloadAssetBlob: vi.fn(async (url: string) => {
        fetchedUrls.push(url)
        return new Blob([new Uint8Array([1, 2, 3])])
      }),
    }))

    const { buildBundleZip } = await import('../api/exportBundle')
    const item: VideoHistoryItem = {
      taskId: 'cgt-zip-1',
      status: 'succeeded',
      prompt: 'p',
      createdAt: 1715000000,
      videoUrl: 'https://signed.bytepluses.com/v.mp4',
      lastFrameUrl: 'https://signed.bytepluses.com/l.png',
      requestContent: { model: 'm', content: [] },
    }
    const { bytes, missing } = await buildBundleZip(item)

    expect(missing).toEqual([])
    expect(fetchedUrls).toHaveLength(2)
    // Sanity: a real zip starts with PK\x03\x04 (0x50 0x4B 0x03 0x04)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('marks failed fetches as missing and still produces a zip', async () => {
    vi.doMock('../api/local', () => ({
      downloadAssetBlob: vi.fn(async (url: string) => {
        if (url.includes('bad')) throw new Error('502 expired')
        return new Blob([new Uint8Array([9])])
      }),
    }))

    const { buildBundleZip } = await import('../api/exportBundle')
    const item: VideoHistoryItem = {
      taskId: 'cgt-zip-2',
      status: 'succeeded',
      prompt: 'p',
      createdAt: 1715000000,
      videoUrl: 'https://signed.bytepluses.com/bad-v.mp4',
      requestContent: { model: 'm', content: [] },
    }
    const { bytes, missing } = await buildBundleZip(item)

    expect(missing).toEqual(['output/video.mp4'])
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})

describe('buildBatchBundleZip', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('packages multiple tasks under per-task subfolders', async () => {
    vi.doMock('../api/local', () => ({
      downloadAssetBlob: vi.fn(async () => new Blob([new Uint8Array([7])])),
    }))
    const { buildBatchBundleZip } = await import('../api/exportBundle')
    const items: VideoHistoryItem[] = [
      {
        taskId: 'cgt-A', status: 'succeeded', prompt: 'a', createdAt: 1715000000,
        videoUrl: 'https://signed.bytepluses.com/a.mp4',
        requestContent: { model: 'm', content: [] },
      },
      {
        taskId: 'cgt-B', status: 'succeeded', prompt: 'b', createdAt: 1715000001,
        videoUrl: 'https://signed.bytepluses.com/b.mp4',
        requestContent: { model: 'm', content: [] },
      },
    ]

    const { bytes, missing, perTaskMissing } = await buildBatchBundleZip(items)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(missing).toEqual([])
    expect(perTaskMissing).toEqual({})
  })

  it('deduplicates references shared across tasks via _shared/', async () => {
    const seen: string[] = []
    vi.doMock('../api/local', () => ({
      downloadAssetBlob: vi.fn(async (url: string) => {
        seen.push(url)
        return new Blob([new Uint8Array([1])])
      }),
    }))
    const { buildBatchBundleZip } = await import('../api/exportBundle')
    const sharedUrl = 'https://ark.bytepluses.com/shared.png?sig=1'
    const items: VideoHistoryItem[] = [
      {
        taskId: 'cgt-A', status: 'succeeded', prompt: 'a', createdAt: 1715000000,
        requestContent: {
          model: 'm',
          content: [{ type: 'image_url', image_url: { url: sharedUrl }, role: 'reference_image' }],
        },
      },
      {
        taskId: 'cgt-B', status: 'succeeded', prompt: 'b', createdAt: 1715000001,
        requestContent: {
          model: 'm',
          content: [{ type: 'image_url', image_url: { url: sharedUrl }, role: 'reference_image' }],
        },
      },
    ]

    await buildBatchBundleZip(items)
    expect(seen).toEqual([sharedUrl])  // fetched once, not twice
  })
})

describe('downloadBlob', () => {
  it('creates an object URL, clicks an <a download>, and revokes the URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    const clickSpy = vi.fn()
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const anchor = origCreateElement('a') as HTMLAnchorElement
        anchor.click = clickSpy
        return anchor
      }
      return origCreateElement(tag)
    })

    const { downloadBlob } = await import('../api/exportBundle')
    const blob = new Blob(['x'], { type: 'application/zip' })
    downloadBlob(blob, 'cgt-1.zip')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
