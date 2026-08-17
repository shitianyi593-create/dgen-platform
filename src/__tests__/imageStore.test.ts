import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useImageStore } from '../stores/imageStore'
import type { ImageHistoryItem } from '../types/image'

let _seq = 0
const freshStore = () => import('../stores/imageStore?t=' + Date.now() + '_' + ++_seq)

function makeItem(over: Partial<ImageHistoryItem> = {}): ImageHistoryItem {
  return {
    id: 'img-1',
    status: 'generating',
    prompt: 'a cat',
    modelKey: 'seedream-5-0-pro',
    createdAt: 1_700_000_000_000,
    images: [],
    params: {
      size: '2K', watermark: false, sequential: false,
      refFilenames: [], refUrls: [], aspectRatio: 'auto',
    },
    ...over,
  }
}

describe('imageStore', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useImageStore.setState(useImageStore.getInitialState(), true)
  })

  it('defaults: 5.0 Pro, preset 2K, auto ratio, png, no watermark, sequential off', () => {
    const s = useImageStore.getState()
    expect(s.modelKey).toBe('seedream-5-0-pro')
    expect(s.sizeMode).toBe('preset')
    expect(s.sizeLevel).toBe('2K')
    expect(s.aspectRatio).toBe('auto')
    expect(s.outputFormat).toBe('png')
    expect(s.watermark).toBe(false)
    expect(s.sequentialEnabled).toBe(false)
  })

  it('setModelKey coerces incompatible values', () => {
    const s = useImageStore.getState()
    s.setSizeLevel('4K')            // valid… only for lite/4-5/4-0
    s.setSequentialEnabled(true)    // needs non-pro; first switch to lite
    useImageStore.getState().setModelKey('seedream-5-0-lite')
    useImageStore.getState().setSizeLevel('4K')
    useImageStore.getState().setSequentialEnabled(true)

    // Switch to 5.0 Pro: 4K invalid → coerced to first valid level; sequential off
    useImageStore.getState().setModelKey('seedream-5-0-pro')
    const after = useImageStore.getState()
    expect(after.sizeLevel).toBe('1K')
    expect(after.sequentialEnabled).toBe(false)

    // Switch to 4.5: png invalid → jpeg
    useImageStore.getState().setOutputFormat('png')
    useImageStore.getState().setModelKey('seedream-4-5')
    expect(useImageStore.getState().outputFormat).toBe('jpeg')
  })

  it('ref image add/remove by id; ref URL add/update/remove by index', () => {
    const s = useImageStore.getState()
    s.addRefImage({ id: 'r1', preview: 'blob:x', filename: 'a.png' })
    s.addRefImage({ id: 'r2', preview: 'blob:y', filename: 'b.png' })
    s.removeRefImage('r1')
    expect(useImageStore.getState().refImages.map((r) => r.id)).toEqual(['r2'])

    s.addRefUrl()
    s.updateRefUrl(0, 'https://example.com/a.png')
    expect(useImageStore.getState().refUrls).toEqual(['https://example.com/a.png'])
    s.removeRefUrl(0)
    expect(useImageStore.getState().refUrls).toEqual([])
  })

  it('history add/update/remove + currentEntryId', () => {
    const s = useImageStore.getState()
    s.addHistory(makeItem())
    s.setCurrentEntry('img-1')
    s.updateHistory('img-1', { status: 'succeeded', images: [{ url: 'https://x/y.png' }] })
    expect(useImageStore.getState().history[0].status).toBe('succeeded')
    s.removeHistory('img-1')
    expect(useImageStore.getState().history).toEqual([])
  })

  it('loadParamsFromHistory refills the form (not refs — those are stale by nature)', () => {
    const s = useImageStore.getState()
    s.loadParamsFromHistory(makeItem({
      prompt: 'sunset city',
      modelKey: 'seedream-4-0',
      params: {
        size: '1280x720', watermark: true, sequential: true, maxImages: 3,
        aspectRatio: '16:9', refFilenames: [], refUrls: ['https://a/b.png'],
      },
    }))
    const after = useImageStore.getState()
    expect(after.prompt).toBe('sunset city')
    expect(after.modelKey).toBe('seedream-4-0')
    expect(after.sizeMode).toBe('custom')
    expect(after.customWidth).toBe(1280)
    expect(after.customHeight).toBe(720)
    expect(after.watermark).toBe(true)
    expect(after.sequentialEnabled).toBe(true)
    expect(after.maxImages).toBe(3)
    expect(after.refUrls).toEqual(['https://a/b.png'])
  })

  it('loadParamsFromHistory preset size: valid level restored as-is', () => {
    useImageStore.getState().loadParamsFromHistory(makeItem({
      modelKey: 'seedream-4-0',
      params: {
        size: '2K', watermark: false, sequential: false,
        refFilenames: [], refUrls: [], aspectRatio: 'auto',
      },
    }))
    const after = useImageStore.getState()
    expect(after.sizeMode).toBe('preset')
    expect(after.sizeLevel).toBe('2K')
  })

  it('loadParamsFromHistory preset size: invalid level for model falls back to first', () => {
    // 4K is not a valid level for 5-0-pro (only 1K/2K)
    useImageStore.getState().loadParamsFromHistory(makeItem({
      modelKey: 'seedream-5-0-pro',
      params: {
        size: '4K', watermark: false, sequential: false,
        refFilenames: [], refUrls: [], aspectRatio: 'auto',
      },
    }))
    const after = useImageStore.getState()
    expect(after.sizeMode).toBe('preset')
    expect(after.sizeLevel).toBe('1K')
  })

  it('loadParamsFromHistory coerces outputFormat against the model spec', () => {
    // png is invalid on jpeg-locked 4.x — must coerce, not load verbatim
    useImageStore.getState().loadParamsFromHistory(makeItem({
      modelKey: 'seedream-4-5',
      params: {
        size: '2K', outputFormat: 'png', watermark: false, sequential: false,
        refFilenames: [], refUrls: [], aspectRatio: 'auto',
      },
    }))
    expect(useImageStore.getState().outputFormat).toBe('jpeg')
  })

  it('loadParamsFromHistory revokes blob previews of discarded ref images', () => {
    const revoked: string[] = []
    const orig = URL.revokeObjectURL
    URL.revokeObjectURL = (url: string) => { revoked.push(url) }
    try {
      const s = useImageStore.getState()
      s.addRefImage({ id: 'r1', preview: 'blob:doomed', filename: 'a.png' })
      s.loadParamsFromHistory(makeItem())
      expect(useImageStore.getState().refImages).toEqual([])
      expect(revoked).toEqual(['blob:doomed'])
    } finally {
      URL.revokeObjectURL = orig
    }
  })

  it('resetForNewTask clears prompt + refs, keeps prefs and history', () => {
    const s = useImageStore.getState()
    s.setPrompt('hello')
    s.setWatermark(true)
    s.addRefImage({ id: 'r1', preview: '', filename: 'a.png' })
    s.addHistory(makeItem())
    s.resetForNewTask()
    const after = useImageStore.getState()
    expect(after.prompt).toBe('')
    expect(after.refImages).toEqual([])
    expect(after.refUrls).toEqual([])
    expect(after.watermark).toBe(true)
    expect(after.history).toHaveLength(1)
  })

  it('persist partialize flattens File refs to stale stubs and drops imported history', () => {
    const s = useImageStore.getState()
    s.addRefImage({
      id: 'r1', preview: 'blob:x', filename: 'a.png',
      file: new File(['x'], 'a.png', { type: 'image/png' }),
    })
    s.addHistory(makeItem({ id: 'live' }))
    s.addHistory(makeItem({ id: 'imp', imported: true }))

    const opts = useImageStore.persist.getOptions()
    const partial = opts.partialize!(useImageStore.getState()) as {
      refImages: Array<{ filename: string }>
      history: ImageHistoryItem[]
    }
    expect(partial.refImages).toEqual([{ filename: 'a.png' }])
    expect(partial.history.map((h) => h.id)).toEqual(['live'])

    const merged = opts.merge!(partial, useImageStore.getInitialState()) as ReturnType<
      typeof useImageStore.getState
    >
    expect(merged.refImages[0].stale).toBe(true)
    expect(merged.refImages[0].file).toBeUndefined()
  })

  it('persists under the DGen image key and migrates the legacy key', async () => {
    sessionStorage.removeItem('dgen-platform-image')
    sessionStorage.setItem('byteplus-ai-gen-platform-image', JSON.stringify({
      version: 1,
      state: { prompt: 'legacy image', history: [] },
    }))

    vi.resetModules()
    const mod = await freshStore()
    expect(mod.useImageStore.getState().prompt).toBe('legacy image')
    mod.useImageStore.getState().setPrompt('new image')
    await new Promise((r) => setTimeout(r, 0))

    expect(sessionStorage.getItem('byteplus-ai-gen-platform-image')).toBeNull()
    const raw = sessionStorage.getItem('dgen-platform-image')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.prompt).toBe('new image')
  })

  it('does not persist blob/data image history URLs', () => {
    const s = useImageStore.getState()
    s.addHistory(makeItem({
      id: 'big',
      status: 'succeeded',
      images: [
        { url: 'data:image/png;base64,' + 'A'.repeat(5000) },
        { url: 'https://x/out.png' },
      ],
      params: {
        size: '2K',
        watermark: false,
        sequential: false,
        refFilenames: [],
        refUrls: ['blob:local-ref', 'https://x/ref.png'],
        aspectRatio: 'auto',
      },
    }))

    const opts = useImageStore.persist.getOptions()
    const partial = opts.partialize!(useImageStore.getState()) as {
      history: ImageHistoryItem[]
    }
    expect(JSON.stringify(partial)).not.toContain('data:image/png;base64')
    expect(partial.history[0].images).toEqual([{ url: 'https://x/out.png' }])
    expect(partial.history[0].params.refUrls).toEqual(['https://x/ref.png'])
  })
})
