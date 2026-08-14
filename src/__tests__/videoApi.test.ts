/**
 * video API 层测试
 *
 * 涵盖需求：
 * - 创建视频生成任务 (createVideoTask)
 * - 获取任务状态 (getVideoTask)
 * - 任务轮询直到完成 (pollTaskUntilDone)
 * - 轮询逾时处理
 * - onProgress 回呼在每次轮询时被触发
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VideoTask, CreateVideoTaskRequest } from '../types'

// Mock axios-based apiClient
vi.mock('../api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}))

import { apiClient } from '../api/client'
import {
  createVideoTask,
  getVideoTask,
  pollTaskUntilDone,
  nextPollInterval,
} from '../api/video'

const mockedClient = vi.mocked(apiClient)

describe('video API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createVideoTask', () => {
    it('should POST to the tasks endpoint and return the task ID', async () => {
      mockedClient.post.mockResolvedValue({ data: { id: 'cgt-123' } })

      const body: CreateVideoTaskRequest = {
        model: 'ep-test',
        content: [{ type: 'text', text: '一隻貓' }],
        ratio: '16:9',
        duration: 5,
      }

      const result = await createVideoTask(body)
      expect(result.id).toBe('cgt-123')
      expect(mockedClient.post).toHaveBeenCalledWith(
        '/api/v3/contents/generations/tasks',
        body,
      )
    })
  })

  describe('getVideoTask', () => {
    it('should GET the task by ID', async () => {
      const task: VideoTask = {
        id: 'cgt-123',
        model: 'ep-test',
        status: 'running',
        created_at: Date.now() / 1000,
      }
      mockedClient.get.mockResolvedValue({ data: task })

      const result = await getVideoTask('cgt-123')
      expect(result.status).toBe('running')
      expect(mockedClient.get).toHaveBeenCalledWith(
        '/api/v3/contents/generations/tasks/cgt-123',
      )
    })
  })

  describe('pollTaskUntilDone', () => {
    it('should return immediately if task is already succeeded', async () => {
      const task: VideoTask = {
        id: 'cgt-1',
        model: 'ep-test',
        status: 'succeeded',
        content: { video_url: 'https://example.com/v.mp4' },
        created_at: Date.now() / 1000,
      }
      mockedClient.get.mockResolvedValue({ data: task })

      const result = await pollTaskUntilDone('cgt-1', { intervalMs: 10, maxWaitMs: 100 })
      expect(result.status).toBe('succeeded')
      expect(result.content?.video_url).toBe('https://example.com/v.mp4')
    })

    it('should poll until task transitions to succeeded', async () => {
      let callCount = 0
      mockedClient.get.mockImplementation(async () => {
        callCount++
        if (callCount < 3) {
          return { data: { id: 'cgt-1', model: 'ep-test', status: 'running', created_at: 0 } }
        }
        return {
          data: {
            id: 'cgt-1', model: 'ep-test', status: 'succeeded',
            content: { video_url: 'url' }, created_at: 0,
          },
        }
      })

      const result = await pollTaskUntilDone('cgt-1', { intervalMs: 10, maxWaitMs: 5000 })
      expect(result.status).toBe('succeeded')
      expect(callCount).toBe(3)
    })

    it('should return failed task without throwing', async () => {
      mockedClient.get.mockResolvedValue({
        data: {
          id: 'cgt-1', model: 'ep-test', status: 'failed',
          error: { message: 'content policy' }, created_at: 0,
        },
      })

      const result = await pollTaskUntilDone('cgt-1', { intervalMs: 10, maxWaitMs: 100 })
      expect(result.status).toBe('failed')
      expect(result.error?.message).toBe('content policy')
    })

    it('returns the last observed status without throwing on timeout', async () => {
      mockedClient.get.mockResolvedValue({
        data: { id: 'cgt-1', model: 'ep-test', status: 'running', created_at: 0 },
      })

      const result = await pollTaskUntilDone('cgt-1', { intervalMs: 10, maxWaitMs: 50 })
      expect(result.status).toBe('running')
    })

    it('does one final sync at timeout in case server marked expired', async () => {
      let callCount = 0
      mockedClient.get.mockImplementation(async () => {
        callCount++
        // Switch to 'expired' on the final sync call
        const status = callCount >= 4 ? 'expired' : 'running'
        return { data: { id: 'cgt-1', model: 'ep-test', status, created_at: 0 } }
      })

      const result = await pollTaskUntilDone('cgt-1', { intervalMs: 10, maxWaitMs: 30 })
      expect(result.status).toBe('expired')
    })

    it('should call onProgress for each poll', async () => {
      let callCount = 0
      mockedClient.get.mockImplementation(async () => {
        callCount++
        const status = callCount >= 2 ? 'succeeded' : 'running'
        return { data: { id: 'cgt-1', model: 'ep-test', status, created_at: 0 } }
      })

      const progress = vi.fn()
      await pollTaskUntilDone('cgt-1', { intervalMs: 10, maxWaitMs: 5000, onProgress: progress })

      expect(progress).toHaveBeenCalledTimes(2)
      expect(progress.mock.calls[0][0].status).toBe('running')
      expect(progress.mock.calls[1][0].status).toBe('succeeded')
    })
  })

  describe('nextPollInterval', () => {
    it('returns 3000ms when elapsed < 30s', () => {
      expect(nextPollInterval(0)).toBe(3000)
      expect(nextPollInterval(29_000)).toBe(3000)
    })

    it('returns 10000ms when elapsed in [30s, 5min)', () => {
      expect(nextPollInterval(30_000)).toBe(10_000)
      expect(nextPollInterval(4 * 60_000)).toBe(10_000)
    })

    it('returns 20000ms when elapsed >= 5min', () => {
      expect(nextPollInterval(5 * 60_000)).toBe(20_000)
      expect(nextPollInterval(60 * 60_000)).toBe(20_000)
    })
  })
})
