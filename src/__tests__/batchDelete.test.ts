import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { batchDelete } from '../api/batchDelete'
import { HttpError } from '../api/asset'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

async function run<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return p
}

describe('batchDelete', () => {
  it('deletes every id and reports all succeeded', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    const removed: string[] = []
    const promise = batchDelete(['a', 'b', 'c'], {
      deleteFn,
      onRemoved: (id) => removed.push(id),
    })
    const res = await run(promise)
    expect(deleteFn).toHaveBeenCalledTimes(3)
    expect(res.succeeded).toBe(3)
    expect(res.failed).toEqual([])
    expect(res.status).toBe('done')
    expect(new Set(removed)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('treats 404 / NotFound as success (idempotent delete)', async () => {
    const deleteFn = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new HttpError(404, 'gone', 'NotFound'))
    const removed: string[] = []
    const promise = batchDelete(['a', 'b'], {
      deleteFn,
      onRemoved: (id) => removed.push(id),
    })
    const res = await run(promise)
    expect(res.succeeded).toBe(2)
    expect(res.failed).toEqual([])
    expect(new Set(removed)).toEqual(new Set(['a', 'b']))
  })

  it('retries transient errors then succeeds', async () => {
    const deleteFn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(429, 'slow', 'TooManyRequests'))
      .mockRejectedValueOnce(new HttpError(503, 'down'))
      .mockResolvedValueOnce(undefined)
    const promise = batchDelete(['a'], { deleteFn })
    const res = await run(promise)
    expect(deleteFn).toHaveBeenCalledTimes(3)
    expect(res.succeeded).toBe(1)
    expect(res.failed).toEqual([])
  })

  it('retries a flow-control rejection instead of aborting the batch', async () => {
    // Real incident code: 400 + AccountFlowLimitExceeded mid-batch must be
    // retried per item, not treated as terminal (which would abort the run).
    const deleteFn = vi
      .fn()
      .mockRejectedValueOnce(
        new HttpError(
          400,
          'Request was rejected because the request speed of this openAPI is beyond the current flow control limit.',
          'AccountFlowLimitExceeded',
        ),
      )
      .mockResolvedValue(undefined)
    const promise = batchDelete(['a', 'b'], { deleteFn })
    const res = await run(promise)
    expect(res.status).toBe('done')
    expect(res.succeeded).toBe(2)
    expect(res.failed).toEqual([])
    expect(deleteFn).toHaveBeenCalledTimes(3) // one retry + two clean passes
  })

  it('after maxAttempts of transient failure, records failed but does not abort', async () => {
    const deleteFn = vi.fn().mockImplementation((id: string) =>
      id === 'a'
        ? Promise.reject(new HttpError(503, 'down'))
        : Promise.resolve(undefined),
    )
    const promise = batchDelete(['a', 'b'], {
      deleteFn,
      maxAttempts: 3,
      getName: (id) => `name-${id}`,
    })
    const res = await run(promise)
    expect(res.status).toBe('done')
    expect(res.succeeded).toBe(1)
    expect(res.failed).toEqual([
      { id: 'a', name: 'name-a', reason: expect.stringContaining('503') },
    ])
  })

  it('aborts the whole batch on a non-transient error (e.g. 403 AccessDenied)', async () => {
    const deleteFn = vi.fn().mockImplementation((id: string) =>
      id === 'a'
        ? Promise.resolve(undefined)
        : Promise.reject(new HttpError(403, 'denied', 'AccessDenied')),
    )
    const removed: string[] = []
    const promise = batchDelete(['a', 'b', 'c'], {
      deleteFn,
      onRemoved: (id) => removed.push(id),
    })
    const res = await run(promise)
    expect(res.status).toBe('aborted')
    expect(res.abortReason).toContain('AccessDenied')
    expect(removed).toContain('a')
    expect(deleteFn).not.toHaveBeenCalledWith('c')
  })

  it('reports progress via onProgress on each settled item', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    const seen: number[] = []
    const promise = batchDelete(['a', 'b'], {
      deleteFn,
      onProgress: (p) => seen.push(p.succeeded),
    })
    await run(promise)
    expect(seen[seen.length - 1]).toBe(2)
  })

  it('handles an empty id list', async () => {
    const deleteFn = vi.fn()
    const res = await batchDelete([], { deleteFn })
    expect(deleteFn).not.toHaveBeenCalled()
    expect(res).toEqual({
      total: 0,
      succeeded: 0,
      failed: [],
      status: 'done',
    })
  })

  it('paces dispatch at <= qps (steady 8 QPS by default)', async () => {
    const times: number[] = []
    const deleteFn = vi.fn().mockImplementation(() => {
      times.push(Date.now())
      return Promise.resolve()
    })
    const promise = batchDelete(['a', 'b', 'c', 'd', 'e'], { deleteFn })
    await run(promise)
    expect(times).toHaveLength(5)
    // first dispatch is immediate; every subsequent dispatch is spaced
    // >= 1000/8 = 125ms apart (steady-interval scheduler).
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(125)
    }
  })
})
