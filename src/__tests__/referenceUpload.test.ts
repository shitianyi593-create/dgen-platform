/**
 * useReferenceUpload / addReferenceWithUpload 测试
 *
 * 涵盖需求：
 * - 加入后立刻 uploading=true，且带到自动产生的 id
 * - 上传成功 → 写回 uploadedUrl + tosKey + uploading=false
 * - 上传失败 → 写回 error + uploading=false，不会留下 stale uploadedUrl
 * - 上传中用户移除该项目 → 不应写回（避免污染后续加入的项目）
 * - video / audio 路径互不干扰
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useVideoStore } from '../stores/videoStore'
import { addReferenceWithUpload } from '../hooks/useReferenceUpload'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function resetStore() {
  useVideoStore.setState(useVideoStore.getInitialState())
}

function makeFile(name = 'a.mp4', type = 'video/mp4') {
  return new File(['x'], name, { type })
}

describe('addReferenceWithUpload', () => {
  beforeEach(resetStore)

  describe('video — happy path', () => {
    it('marks the item uploading then writes uploadedUrl/tosKey on success', async () => {
      const upload = vi.fn().mockResolvedValue({
        key: 'seedance-2-0/2026/04/uuid-a.mp4',
        viewUrl: 'https://tos.example/a.mp4?X-Tos-Expires=10800',
        expiresAt: 10800,
      })
      const file = makeFile()

      const promise = addReferenceWithUpload(
        'video',
        { file, preview: 'blob:p', uploading: false },
        { upload },
      )

      // While the upload promise is pending the item is in 'uploading' state.
      const intermediate = useVideoStore.getState().referenceVideos
      expect(intermediate).toHaveLength(1)
      expect(intermediate[0].uploading).toBe(true)
      expect(intermediate[0].uploadedUrl).toBeUndefined()
      expect(intermediate[0].id).toBeTruthy()

      await promise

      const final = useVideoStore.getState().referenceVideos[0]
      expect(final.uploading).toBe(false)
      expect(final.uploadedUrl).toBe('https://tos.example/a.mp4?X-Tos-Expires=10800')
      expect(final.tosKey).toBe('seedance-2-0/2026/04/uuid-a.mp4')
      expect(final.error).toBeUndefined()
      expect(upload).toHaveBeenCalledWith(file)
    })
  })

  describe('video — failure', () => {
    it('writes error string and clears uploading without setting uploadedUrl', async () => {
      const upload = vi.fn().mockRejectedValue(new Error('TOS upload failed: HTTP 403'))
      await addReferenceWithUpload(
        'video',
        { file: makeFile(), preview: 'blob:p', uploading: false },
        { upload },
      )

      const item = useVideoStore.getState().referenceVideos[0]
      expect(item.uploading).toBe(false)
      expect(item.error).toBe('TOS upload failed: HTTP 403')
      expect(item.uploadedUrl).toBeUndefined()
      expect(item.tosKey).toBeUndefined()
    })
  })

  describe('audio — happy path', () => {
    it('writes the uploadedUrl into referenceAudios', async () => {
      const upload = vi.fn().mockResolvedValue({
        key: 'seedance-2-0/2026/04/uuid-a.mp3',
        viewUrl: 'https://tos.example/a.mp3?sig',
        expiresAt: 10800,
      })
      await addReferenceWithUpload(
        'audio',
        { file: makeFile('a.mp3', 'audio/mpeg'), preview: 'blob:p', uploading: false },
        { upload },
      )

      const audio = useVideoStore.getState().referenceAudios[0]
      const video = useVideoStore.getState().referenceVideos
      expect(audio.uploadedUrl).toBe('https://tos.example/a.mp3?sig')
      expect(audio.tosKey).toBe('seedance-2-0/2026/04/uuid-a.mp3')
      // Did NOT touch video list
      expect(video).toEqual([])
    })
  })

  describe('removal during upload', () => {
    it('does not write back if the user removed the item before upload completed', async () => {
      let resolveUpload!: (v: { key: string; viewUrl: string; expiresAt: number }) => void
      const upload = vi.fn(
        () =>
          new Promise<{ key: string; viewUrl: string; expiresAt: number }>((r) => {
            resolveUpload = r
          }),
      )

      const promise = addReferenceWithUpload(
        'video',
        { file: makeFile(), preview: 'blob:p', uploading: false },
        { upload },
      )

      // user removes the item
      useVideoStore.getState().removeReferenceVideo(0)
      expect(useVideoStore.getState().referenceVideos).toHaveLength(0)

      // upload finishes after removal
      resolveUpload({
        key: 'seedance-2-0/k',
        viewUrl: 'https://tos.example/k.mp4',
        expiresAt: 10800,
      })
      await promise

      // List should remain empty — no zombie write
      expect(useVideoStore.getState().referenceVideos).toEqual([])
    })

    it('handles 3 concurrent video uploads finishing out of order without cross-contamination', async () => {
      // Each upload returns a controllable promise so we can resolve them out of order.
      const resolvers: Array<(v: { key: string; viewUrl: string; expiresAt: number }) => void> = []
      const upload = vi.fn(
        () =>
          new Promise<{ key: string; viewUrl: string; expiresAt: number }>((r) => {
            resolvers.push(r)
          }),
      )

      // Add 3 videos in quick succession (mimicking a user dropping 3 files).
      const promises = [1, 2, 3].map((i) =>
        addReferenceWithUpload(
          'video',
          { file: makeFile(`v${i}.mp4`), preview: `blob:v${i}`, uploading: false },
          { upload },
        ),
      )

      // All 3 are now in store, all uploading, with stable ids.
      const intermediate = useVideoStore.getState().referenceVideos
      expect(intermediate).toHaveLength(3)
      expect(intermediate.every((m) => m.uploading)).toBe(true)
      const ids = intermediate.map((m) => m.id)
      expect(new Set(ids).size).toBe(3) // all unique

      // Resolve in reversed order: 3rd, 1st, 2nd.
      resolvers[2]({ key: 'k3', viewUrl: 'u3', expiresAt: 30 })
      resolvers[0]({ key: 'k1', viewUrl: 'u1', expiresAt: 10 })
      resolvers[1]({ key: 'k2', viewUrl: 'u2', expiresAt: 20 })
      await Promise.all(promises)

      const final = useVideoStore.getState().referenceVideos
      expect(final).toHaveLength(3)
      // Each item must have its OWN url/key (no cross-contamination).
      expect(final[0].uploadedUrl).toBe('u1')
      expect(final[0].tosKey).toBe('k1')
      expect(final[1].uploadedUrl).toBe('u2')
      expect(final[1].tosKey).toBe('k2')
      expect(final[2].uploadedUrl).toBe('u3')
      expect(final[2].tosKey).toBe('k3')
      expect(final.every((m) => m.uploading === false)).toBe(true)
    })

    it('does not corrupt a freshly added item if the previous upload finishes after removal', async () => {
      let resolveFirst!: (v: { key: string; viewUrl: string; expiresAt: number }) => void
      const uploadFirst = vi.fn(
        () =>
          new Promise<{ key: string; viewUrl: string; expiresAt: number }>((r) => {
            resolveFirst = r
          }),
      )
      const uploadSecond = vi.fn().mockResolvedValue({
        key: 'k2',
        viewUrl: 'url2',
        expiresAt: 10800,
      })

      // Add A and start uploading
      const pA = addReferenceWithUpload(
        'video',
        { file: makeFile('a.mp4'), preview: 'blob:a', uploading: false },
        { upload: uploadFirst },
      )

      // Remove A, then add B
      useVideoStore.getState().removeReferenceVideo(0)
      const pB = addReferenceWithUpload(
        'video',
        { file: makeFile('b.mp4'), preview: 'blob:b', uploading: false },
        { upload: uploadSecond },
      )

      // Resolve A AFTER B has been added — must not overwrite B
      resolveFirst({ key: 'k1', viewUrl: 'url1', expiresAt: 10800 })
      await Promise.all([pA, pB])

      const list = useVideoStore.getState().referenceVideos
      expect(list).toHaveLength(1)
      expect(list[0].uploadedUrl).toBe('url2')
      expect(list[0].tosKey).toBe('k2')
    })
  })
})
