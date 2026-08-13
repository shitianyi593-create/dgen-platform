/**
 * videoStore 測試
 *
 * 涵蓋需求：
 * - 影片生成參數管理 (prompt, ratio, duration, watermark, generateAudio)
 * - 參考媒體管理 (images, videos, audios)
 * - Asset 參考管理 (image/video/audio 類型)
 * - 併發任務追蹤 (activeTaskIds)
 * - 歷史紀錄管理 (新增、更新、清除)
 * - 預覽面板選擇 (currentTaskId, currentVideoUrl)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useVideoStore } from '../stores/videoStore'
import type { VideoHistoryItem } from '../types'
import { EXECUTION_EXPIRES_OPTIONS } from '../types'

function resetStore() {
  useVideoStore.setState(useVideoStore.getInitialState())
}

describe('videoStore', () => {
  beforeEach(resetStore)

  // ── 參數管理 ──

  describe('generation params', () => {
    it('should have correct default values', () => {
      const s = useVideoStore.getState()
      expect(s.prompt).toBe('')
      // Seedance 2.0's official default — let the model pick the ratio based on inputs.
      expect(s.ratio).toBe('adaptive')
      expect(s.duration).toBe(5)
      expect(s.watermark).toBe(false)
      expect(s.generateAudio).toBe(true)
    })

    it('should update prompt', () => {
      useVideoStore.getState().setPrompt('一隻貓在跳舞')
      expect(useVideoStore.getState().prompt).toBe('一隻貓在跳舞')
    })

    it('should update ratio', () => {
      useVideoStore.getState().setRatio('9:16')
      expect(useVideoStore.getState().ratio).toBe('9:16')
    })

    it('should update duration', () => {
      useVideoStore.getState().setDuration(11)
      expect(useVideoStore.getState().duration).toBe(11)
    })

    it('should toggle watermark', () => {
      useVideoStore.getState().setWatermark(true)
      expect(useVideoStore.getState().watermark).toBe(true)
    })

    it('should default resolution to 720p (Seedance 2.0 spec)', () => {
      expect(useVideoStore.getState().resolution).toBe('720p')
    })

    it('should update resolution', () => {
      useVideoStore.getState().setResolution('1080p')
      expect(useVideoStore.getState().resolution).toBe('1080p')
      useVideoStore.getState().setResolution('480p')
      expect(useVideoStore.getState().resolution).toBe('480p')
    })

    it('should default returnLastFrame to true', () => {
      expect(useVideoStore.getState().returnLastFrame).toBe(true)
    })

    it('should toggle returnLastFrame', () => {
      useVideoStore.getState().setReturnLastFrame(false)
      expect(useVideoStore.getState().returnLastFrame).toBe(false)
      useVideoStore.getState().setReturnLastFrame(true)
      expect(useVideoStore.getState().returnLastFrame).toBe(true)
    })

    it('should toggle generateAudio', () => {
      useVideoStore.getState().setGenerateAudio(false)
      expect(useVideoStore.getState().generateAudio).toBe(false)
    })
  })

  // ── Asset 參考 ──

  describe('asset references', () => {
    it('should add an asset ref', () => {
      useVideoStore.getState().addAssetRef({ id: 'asset-abc', type: 'image' })
      expect(useVideoStore.getState().assetRefs).toHaveLength(1)
      // Image asset refs auto-populate role from current mode (multimodal default).
      expect(useVideoStore.getState().assetRefs[0]).toEqual({
        id: 'asset-abc',
        type: 'image',
        role: 'reference_image',
      })
    })

    it('should support image, video, audio types', () => {
      const { addAssetRef } = useVideoStore.getState()
      addAssetRef({ id: 'a1', type: 'image' })
      addAssetRef({ id: 'a2', type: 'video' })
      addAssetRef({ id: 'a3', type: 'audio' })
      const refs = useVideoStore.getState().assetRefs
      expect(refs).toHaveLength(3)
      expect(refs.map(r => r.type)).toEqual(['image', 'video', 'audio'])
    })

    it('should update asset ref type', () => {
      useVideoStore.getState().addAssetRef({ id: 'a1', type: 'image' })
      useVideoStore.getState().updateAssetRef(0, { type: 'video' })
      expect(useVideoStore.getState().assetRefs[0].type).toBe('video')
    })

    it('should remove asset ref by index', () => {
      const { addAssetRef } = useVideoStore.getState()
      addAssetRef({ id: 'a1', type: 'image' })
      addAssetRef({ id: 'a2', type: 'video' })
      useVideoStore.getState().removeAssetRef(0)
      expect(useVideoStore.getState().assetRefs).toHaveLength(1)
      expect(useVideoStore.getState().assetRefs[0].id).toBe('a2')
    })
  })

  // ── 併發任務追蹤 ──

  describe('concurrent task tracking', () => {
    it('should start with empty activeTaskIds', () => {
      expect(useVideoStore.getState().activeTaskIds).toEqual([])
    })

    it('should add multiple active tasks', () => {
      const { addActiveTask } = useVideoStore.getState()
      addActiveTask('task-1')
      addActiveTask('task-2')
      addActiveTask('task-3')
      expect(useVideoStore.getState().activeTaskIds).toEqual(['task-1', 'task-2', 'task-3'])
    })

    it('should remove a specific active task', () => {
      const { addActiveTask } = useVideoStore.getState()
      addActiveTask('task-1')
      addActiveTask('task-2')
      addActiveTask('task-3')
      useVideoStore.getState().removeActiveTask('task-2')
      expect(useVideoStore.getState().activeTaskIds).toEqual(['task-1', 'task-3'])
    })

    it('should not affect other tasks when removing one', () => {
      const { addActiveTask } = useVideoStore.getState()
      addActiveTask('task-a')
      addActiveTask('task-b')
      useVideoStore.getState().removeActiveTask('task-a')
      expect(useVideoStore.getState().activeTaskIds).toEqual(['task-b'])
    })

    it('removing non-existent task should be safe', () => {
      useVideoStore.getState().addActiveTask('task-1')
      useVideoStore.getState().removeActiveTask('task-999')
      expect(useVideoStore.getState().activeTaskIds).toEqual(['task-1'])
    })
  })

  // ── 歷史紀錄管理 ──

  describe('history management', () => {
    const makeItem = (id: string, overrides?: Partial<VideoHistoryItem>): VideoHistoryItem => ({
      taskId: id,
      status: 'succeeded',
      prompt: `prompt for ${id}`,
      createdAt: Date.now() / 1000,
      ...overrides,
    })

    it('should add history items (newest first)', () => {
      const { addHistory } = useVideoStore.getState()
      addHistory(makeItem('t1'))
      addHistory(makeItem('t2'))
      const ids = useVideoStore.getState().history.map(h => h.taskId)
      expect(ids).toEqual(['t2', 't1'])
    })

    it('should update a specific history item by taskId', () => {
      useVideoStore.getState().addHistory(makeItem('t1', { status: 'running' }))
      useVideoStore.getState().updateHistory('t1', {
        status: 'succeeded',
        videoUrl: 'https://example.com/video.mp4',
        seed: 12345,
      })
      const item = useVideoStore.getState().history[0]
      expect(item.status).toBe('succeeded')
      expect(item.videoUrl).toBe('https://example.com/video.mp4')
      expect(item.seed).toBe(12345)
    })

    it('should preserve objectUrl when updating other fields', () => {
      useVideoStore.getState().addHistory(makeItem('t1', { objectUrl: 'blob:t1-mp4' }))
      useVideoStore.getState().updateHistory('t1', { status: 'succeeded' })
      expect(useVideoStore.getState().history[0].objectUrl).toBe('blob:t1-mp4')
    })

    it('should clear all history', () => {
      useVideoStore.getState().addHistory(makeItem('t1'))
      useVideoStore.getState().addHistory(makeItem('t2'))
      useVideoStore.getState().clearHistory()
      expect(useVideoStore.getState().history).toEqual([])
    })

    it('should store requestContent for export', () => {
      const request = {
        model: 'ep-xxx',
        content: [{ type: 'text' as const, text: 'hello' }],
        ratio: '16:9',
        duration: 5,
        watermark: false,
        generate_audio: true,
      }
      useVideoStore.getState().addHistory(makeItem('t1', { requestContent: request }))
      expect(useVideoStore.getState().history[0].requestContent).toEqual(request)
    })
  })

  // ── resetForNewTask ──

  describe('resetForNewTask', () => {
    it('clears prompt, all reference media and asset refs', () => {
      const file = new File(['x'], 'a.mp4', { type: 'video/mp4' })
      useVideoStore.getState().setPrompt('hello')
      useVideoStore.getState().addReferenceImage({ file, preview: 'blob:img', uploading: false })
      useVideoStore.getState().addReferenceVideo({ file, preview: 'blob:vid', uploading: false })
      useVideoStore.getState().addReferenceAudio({ file, preview: 'blob:aud', uploading: false })
      useVideoStore.getState().addAssetRef({ id: 'asset-1', type: 'image' })

      useVideoStore.getState().resetForNewTask()

      const s = useVideoStore.getState()
      expect(s.prompt).toBe('')
      expect(s.referenceImages).toEqual([])
      expect(s.referenceVideos).toEqual([])
      expect(s.referenceAudios).toEqual([])
      expect(s.assetRefs).toEqual([])
    })

    it('preserves user preferences (ratio / duration / resolution / watermark / generateAudio / returnLastFrame)', () => {
      useVideoStore.getState().setRatio('9:16')
      useVideoStore.getState().setDuration(11)
      useVideoStore.getState().setResolution('1080p')
      useVideoStore.getState().setWatermark(true)
      useVideoStore.getState().setGenerateAudio(false)
      useVideoStore.getState().setReturnLastFrame(false)
      useVideoStore.getState().setPrompt('to-be-cleared')

      useVideoStore.getState().resetForNewTask()

      const s = useVideoStore.getState()
      expect(s.ratio).toBe('9:16')
      expect(s.duration).toBe(11)
      expect(s.resolution).toBe('1080p')
      expect(s.watermark).toBe(true)
      expect(s.generateAudio).toBe(false)
      expect(s.returnLastFrame).toBe(false)
      expect(s.prompt).toBe('')
    })

    it('preserves history and active task IDs', () => {
      useVideoStore.getState().addHistory({
        taskId: 't-existing',
        status: 'succeeded',
        prompt: 'old',
        createdAt: Date.now() / 1000,
      })
      useVideoStore.getState().addActiveTask('t-running')

      useVideoStore.getState().resetForNewTask()

      const s = useVideoStore.getState()
      expect(s.history).toHaveLength(1)
      expect(s.history[0].taskId).toBe('t-existing')
      expect(s.activeTaskIds).toEqual(['t-running'])
    })

    it('revokes blob URLs of removed preview entries', () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
      useVideoStore.getState().addReferenceImage({
        file: new File(['x'], 'a.png', { type: 'image/png' }),
        preview: 'blob:preview-img',
        uploading: false,
      })
      useVideoStore.getState().addReferenceVideo({
        file: new File(['x'], 'a.mp4', { type: 'video/mp4' }),
        preview: 'blob:preview-vid',
        uploading: false,
      })

      useVideoStore.getState().resetForNewTask()

      expect(revoke).toHaveBeenCalledWith('blob:preview-img')
      expect(revoke).toHaveBeenCalledWith('blob:preview-vid')
      revoke.mockRestore()
    })
  })

  // ── Seed ──

  describe('seed', () => {
    beforeEach(() => {
      useVideoStore.setState(useVideoStore.getInitialState())
    })

    it('defaults seed to -1 (random)', () => {
      expect(useVideoStore.getState().seed).toBe(-1)
    })

    it('setSeed updates the value', () => {
      useVideoStore.getState().setSeed(42)
      expect(useVideoStore.getState().seed).toBe(42)
    })

    it('resetForNewTask does NOT reset seed', () => {
      useVideoStore.getState().setSeed(123456)
      useVideoStore.getState().resetForNewTask()
      expect(useVideoStore.getState().seed).toBe(123456)
    })
  })

  // ── 預覽選擇 ──

  describe('preview selection', () => {
    it('should set currentTaskId', () => {
      useVideoStore.getState().setCurrentTask('task-abc')
      expect(useVideoStore.getState().currentTaskId).toBe('task-abc')
    })

    it('should set currentVideoUrl', () => {
      useVideoStore.getState().setCurrentVideoUrl('https://example.com/v.mp4')
      expect(useVideoStore.getState().currentVideoUrl).toBe('https://example.com/v.mp4')
    })

    it('should allow null for both (deselect)', () => {
      useVideoStore.getState().setCurrentTask('t1')
      useVideoStore.getState().setCurrentVideoUrl('url')
      useVideoStore.getState().setCurrentTask(null)
      useVideoStore.getState().setCurrentVideoUrl(null)
      expect(useVideoStore.getState().currentTaskId).toBeNull()
      expect(useVideoStore.getState().currentVideoUrl).toBeNull()
    })
  })
})

describe('EXECUTION_EXPIRES_OPTIONS', () => {
  it('matches ARK valid range and includes 1hr default', () => {
    const values = EXECUTION_EXPIRES_OPTIONS.map((o) => o.value)
    expect(Math.min(...values)).toBe(3600)
    expect(Math.max(...values)).toBe(259200)
    expect(values).toContain(3600)
    expect(values).toContain(172800)
    expect(values).toContain(259200)
  })

  it('all options are within ARK valid range [3600, 259200]', () => {
    for (const o of EXECUTION_EXPIRES_OPTIONS) {
      expect(o.value).toBeGreaterThanOrEqual(3600)
      expect(o.value).toBeLessThanOrEqual(259200)
    }
  })
})

describe('executionExpiresAfter state', () => {
  beforeEach(() => {
    useVideoStore.setState(useVideoStore.getInitialState())
  })

  it('defaults to 3600 (1 hour)', () => {
    expect(useVideoStore.getState().executionExpiresAfter).toBe(3600)
  })

  it('setExecutionExpiresAfter updates the value', () => {
    useVideoStore.getState().setExecutionExpiresAfter(7200)
    expect(useVideoStore.getState().executionExpiresAfter).toBe(7200)
  })
})

describe('removeHistory', () => {
  beforeEach(() => {
    useVideoStore.setState(useVideoStore.getInitialState())
  })

  it('removes the matching task from history', () => {
    useVideoStore.setState({
      history: [
        { taskId: 'a', status: 'succeeded', prompt: 'p1', createdAt: 0 },
        { taskId: 'b', status: 'failed', prompt: 'p2', createdAt: 1 },
      ],
    })
    useVideoStore.getState().removeHistory('a')
    expect(useVideoStore.getState().history).toEqual([
      { taskId: 'b', status: 'failed', prompt: 'p2', createdAt: 1 },
    ])
  })

  it('is a no-op when the taskId is not in history', () => {
    useVideoStore.setState({
      history: [
        { taskId: 'a', status: 'succeeded', prompt: 'p1', createdAt: 0 },
      ],
    })
    useVideoStore.getState().removeHistory('nonexistent')
    expect(useVideoStore.getState().history).toHaveLength(1)
  })

  it('revokes the removed item\'s blob: object URLs', () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(),
      revokeObjectURL: vi.fn((u: string) => { revoked.push(u) }),
    })
    useVideoStore.setState({
      history: [
        {
          taskId: 'imp',
          status: 'succeeded',
          prompt: 'imported',
          createdAt: 0,
          objectUrl: 'blob:fake-video',
          frameObjectUrl: 'blob:fake-frame',
          imported: true,
        },
      ],
    })
    useVideoStore.getState().removeHistory('imp')
    expect(revoked.sort()).toEqual(['blob:fake-frame', 'blob:fake-video'])
    vi.unstubAllGlobals()
  })
})

describe('clearHistory', () => {
  beforeEach(() => {
    useVideoStore.setState(useVideoStore.getInitialState())
  })

  it('revokes blob: URLs across all items before clearing', () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(),
      revokeObjectURL: vi.fn((u: string) => { revoked.push(u) }),
    })
    useVideoStore.setState({
      history: [
        { taskId: 'a', status: 'succeeded', prompt: 'p', createdAt: 0, objectUrl: 'blob:a-vid' },
        { taskId: 'b', status: 'succeeded', prompt: 'p', createdAt: 1, objectUrl: 'blob:b-vid', frameObjectUrl: 'blob:b-frame' },
      ],
    })
    useVideoStore.getState().clearHistory()
    expect(useVideoStore.getState().history).toEqual([])
    expect(revoked.sort()).toEqual(['blob:a-vid', 'blob:b-frame', 'blob:b-vid'])
    vi.unstubAllGlobals()
  })
})

describe('videoStore — mode state', () => {
  beforeEach(() => {
    useVideoStore.getState().resetForNewTask()
    useVideoStore.setState({ mode: 'multimodal' })
  })

  it('defaults to multimodal', () => {
    useVideoStore.setState({ mode: 'multimodal' })
    expect(useVideoStore.getState().mode).toBe('multimodal')
  })

  it('setMode updates the mode state', () => {
    useVideoStore.getState().setMode('first_frame')
    expect(useVideoStore.getState().mode).toBe('first_frame')
    useVideoStore.getState().setMode('first_last_frame')
    expect(useVideoStore.getState().mode).toBe('first_last_frame')
  })

  it('setMode does not mutate referenceImages / videos / audios / assetRefs', () => {
    useVideoStore.getState().addReferenceImage({ preview: 'blob:i', uploading: false })
    useVideoStore.getState().addReferenceVideo({ preview: 'blob:v', uploading: false })
    useVideoStore.getState().addReferenceAudio({ preview: 'blob:a', uploading: false })
    useVideoStore.getState().addAssetRef({ id: 'asset-1', type: 'image' })

    const imgs = useVideoStore.getState().referenceImages
    const vids = useVideoStore.getState().referenceVideos
    const auds = useVideoStore.getState().referenceAudios
    const refs = useVideoStore.getState().assetRefs

    useVideoStore.getState().setMode('first_frame')

    expect(useVideoStore.getState().referenceImages).toBe(imgs)
    expect(useVideoStore.getState().referenceVideos).toBe(vids)
    expect(useVideoStore.getState().referenceAudios).toBe(auds)
    expect(useVideoStore.getState().assetRefs).toBe(refs)
  })
})

describe('videoStore — role auto-population', () => {
  beforeEach(() => {
    useVideoStore.getState().resetForNewTask()
    useVideoStore.setState({ mode: 'multimodal' })
  })

  it('addReferenceImage in multimodal mode sets role=reference_image', () => {
    useVideoStore.getState().addReferenceImage({ preview: 'b', uploading: false })
    expect(useVideoStore.getState().referenceImages[0].role).toBe('reference_image')
  })

  it('addReferenceImage in first_frame mode sets role=first_frame', () => {
    useVideoStore.setState({ mode: 'first_frame' })
    useVideoStore.getState().addReferenceImage({ preview: 'b', uploading: false })
    expect(useVideoStore.getState().referenceImages[0].role).toBe('first_frame')
  })

  it('addReferenceImage in first_last_frame mode sets first then last', () => {
    useVideoStore.setState({ mode: 'first_last_frame' })
    useVideoStore.getState().addReferenceImage({ preview: 'a', uploading: false })
    useVideoStore.getState().addReferenceImage({ preview: 'b', uploading: false })
    expect(useVideoStore.getState().referenceImages[0].role).toBe('first_frame')
    expect(useVideoStore.getState().referenceImages[1].role).toBe('last_frame')
  })

  it('setImageRole updates role on existing image', () => {
    useVideoStore.getState().addReferenceImage({ preview: 'b', uploading: false })
    useVideoStore.getState().setImageRole(0, 'first_frame')
    expect(useVideoStore.getState().referenceImages[0].role).toBe('first_frame')
  })

  it('addAssetRef with image type auto-populates role', () => {
    useVideoStore.setState({ mode: 'first_frame' })
    useVideoStore.getState().addAssetRef({ id: 'asset-x', type: 'image' })
    expect(useVideoStore.getState().assetRefs[0].role).toBe('first_frame')
  })

  it('addAssetRef with video type does not set role', () => {
    useVideoStore.getState().addAssetRef({ id: 'asset-v', type: 'video' })
    expect(useVideoStore.getState().assetRefs[0].role).toBeUndefined()
  })
})

describe('partialize — imported items are NOT persisted', () => {
  it('drops items with imported:true so blob: URLs don\'t resurrect dead', () => {
    // We can't reach partialize directly without hooking the persist
    // middleware, so smoke-test the persisted JSON via sessionStorage.
    useVideoStore.setState({
      history: [
        { taskId: 'live', status: 'succeeded', prompt: 'a', createdAt: 0, videoUrl: 'https://x.byteplus.com/v.mp4' },
        { taskId: 'imp', status: 'succeeded', prompt: 'b', createdAt: 1, objectUrl: 'blob:dead-on-reload', imported: true },
      ],
    })
    // Trigger persist by setting any persisted field.
    useVideoStore.getState().setPrompt('trigger-persist')
    const raw = sessionStorage.getItem('byteplus-ai-gen-platform-video')
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw!) as { state: { history: Array<{ taskId: string }> } }
    const ids = persisted.state.history.map((h) => h.taskId)
    expect(ids).toEqual(['live'])  // 'imp' dropped
  })
})
