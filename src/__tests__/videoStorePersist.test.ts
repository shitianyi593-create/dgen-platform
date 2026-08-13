import { describe, it, expect, beforeEach } from 'vitest'

let _seq = 0
const freshStore = () => import('../stores/videoStore?t=' + Date.now() + '_' + ++_seq)

describe('videoStore persistence (sessionStorage)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('persists prompt and assetRefs to sessionStorage under "byteplus-ai-gen-platform-video"', async () => {
    const mod = await freshStore()
    mod.useVideoStore.getState().setPrompt('a cat')
    mod.useVideoStore.getState().addAssetRef({ id: 'asset-1', type: 'image' })

    // Allow zustand persist to flush
    await new Promise((r) => setTimeout(r, 0))

    const raw = sessionStorage.getItem('byteplus-ai-gen-platform-video')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.prompt).toBe('a cat')
    // Image asset refs auto-populate role from current mode (multimodal default).
    expect(parsed.state.assetRefs).toEqual([
      { id: 'asset-1', type: 'image', role: 'reference_image' },
    ])
  })

  it('persists generation settings (executionExpiresAfter, ratio, etc)', async () => {
    const mod = await freshStore()
    mod.useVideoStore.getState().setExecutionExpiresAfter(7200)
    mod.useVideoStore.getState().setRatio('9:16')

    await new Promise((r) => setTimeout(r, 0))

    const parsed = JSON.parse(sessionStorage.getItem('byteplus-ai-gen-platform-video')!)
    expect(parsed.state.executionExpiresAfter).toBe(7200)
    expect(parsed.state.ratio).toBe('9:16')
  })

  it('persists activeTaskIds and history with executionExpiresAfter', async () => {
    const mod = await freshStore()
    mod.useVideoStore.getState().addActiveTask('cgt-1')
    mod.useVideoStore.getState().addHistory({
      taskId: 'cgt-1',
      status: 'queued',
      prompt: 'hi',
      createdAt: 1000,
      executionExpiresAfter: 3600,
    })

    await new Promise((r) => setTimeout(r, 0))

    const parsed = JSON.parse(sessionStorage.getItem('byteplus-ai-gen-platform-video')!)
    expect(parsed.state.activeTaskIds).toEqual(['cgt-1'])
    expect(parsed.state.history[0].executionExpiresAfter).toBe(3600)
  })

  it('flattens reference media to {filename, type} stubs (no File, no preview)', async () => {
    const mod = await freshStore()
    const fakeFile = new File(['x'], 'cat.png', { type: 'image/png' })
    mod.useVideoStore.getState().addReferenceImage({
      file: fakeFile,
      preview: 'blob:http://localhost/abc',
      uploading: false,
    })

    await new Promise((r) => setTimeout(r, 0))

    const parsed = JSON.parse(sessionStorage.getItem('byteplus-ai-gen-platform-video')!)
    expect(parsed.state.referenceImages).toEqual([
      { filename: 'cat.png', type: 'image' },
    ])
  })

  it('persists mode in the sessionStorage snapshot', async () => {
    const mod = await freshStore()
    mod.useVideoStore.getState().setMode('first_last_frame')

    await new Promise((r) => setTimeout(r, 0))

    const raw = sessionStorage.getItem('byteplus-ai-gen-platform-video')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.mode).toBe('first_last_frame')
  })

  it('falls back to multimodal when persisted state lacks mode', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-video', JSON.stringify({
      version: 1,
      state: { prompt: 'legacy' },
    }))
    const mod = await freshStore()
    expect(mod.useVideoStore.getState().mode).toBe('multimodal')
  })

  it('rehydrates reference media as stale stubs', async () => {
    sessionStorage.setItem('byteplus-ai-gen-platform-video', JSON.stringify({
      version: 1,
      state: {
        prompt: 'hi',
        executionExpiresAfter: 7200,
        referenceImages: [{ filename: 'cat.png', type: 'image' }],
        referenceVideos: [],
        referenceAudios: [],
        assetRefs: [],
        activeTaskIds: [],
        history: [],
        currentTaskId: null,
        currentVideoUrl: null,
        ratio: 'adaptive',
        duration: 5,
        resolution: '720p',
        watermark: false,
        generateAudio: true,
        returnLastFrame: true,
        seed: -1,
      },
    }))

    const mod = await freshStore()
    const refs = mod.useVideoStore.getState().referenceImages
    expect(refs).toHaveLength(1)
    expect(refs[0].filename).toBe('cat.png')
    expect(refs[0].stale).toBe(true)
    expect(refs[0].uploading).toBe(false)
  })
})
