import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addReferenceWithUpload } from '../hooks/useReferenceUpload'
import { useVideoStore } from '../stores/videoStore'
import { useVideo25Store } from '../stores/video25Store'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

describe('addReferenceWithUpload with injected store (Seedance 2.5 page)', () => {
  beforeEach(() => {
    useVideoStore.setState(useVideoStore.getInitialState())
    useVideo25Store.setState(useVideo25Store.getInitialState())
  })

  it('writes into the injected 2.5 store, not the default 2.0 store', async () => {
    const upload = vi.fn().mockResolvedValue({ key: 'k', viewUrl: 'https://tos/u', expiresAt: 1 })
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })

    await addReferenceWithUpload(
      'video',
      { file, preview: 'blob:p', uploading: false },
      { upload },
      useVideo25Store,
    )

    expect(useVideo25Store.getState().referenceVideos).toHaveLength(1)
    expect(useVideo25Store.getState().referenceVideos[0].uploadedUrl).toBe('https://tos/u')
    expect(useVideoStore.getState().referenceVideos).toHaveLength(0)
  })

  it('defaults to the 2.0 store when no store is given (existing behavior)', async () => {
    const upload = vi.fn().mockResolvedValue({ key: 'k', viewUrl: 'https://tos/u', expiresAt: 1 })
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })

    await addReferenceWithUpload('video', { file, preview: 'blob:p', uploading: false }, { upload })

    expect(useVideoStore.getState().referenceVideos).toHaveLength(1)
    expect(useVideo25Store.getState().referenceVideos).toHaveLength(0)
  })
})
