/**
 * Regression guard for the real incident on a 5,881-group account:
 * ARK rejected group-list paging with
 *   AccountFlowLimitExceeded: Request was rejected because the request speed
 *   of this openAPI is beyond the current flow control limit.
 * Neither rate-limit matcher recognised that code (both only matched
 * status 429 or /throttl|ratelimit/i), so the list failed with zero retries
 * and batch delete aborted the whole run instead of retrying per item.
 *
 * Timers: the retry backoff is 0.5/1/2s, so the retry test uses
 * vi.useFakeTimers() + runAllTimersAsync() (same pattern as the existing
 * createAsset retry tests in assetApi.test.ts) rather than paying a real
 * ~0.75s wall-clock wait.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listAssetGroups, HttpError, isTransientError } from '../api/asset'
import { useAuthStore } from '../stores/authStore'

const FLOW_LIMIT_CODE = 'AccountFlowLimitExceeded'
const FLOW_LIMIT_MESSAGE =
  'Request was rejected because the request speed of this openAPI is beyond the current flow control limit.'

describe('isTransientError — flow-control code', () => {
  it('treats a 400 + AccountFlowLimitExceeded as transient (status is undocumented)', () => {
    expect(
      isTransientError(new HttpError(400, FLOW_LIMIT_MESSAGE, FLOW_LIMIT_CODE)),
    ).toBe(true)
  })

  it('treats a 429 + AccountFlowLimitExceeded as transient', () => {
    expect(
      isTransientError(new HttpError(429, FLOW_LIMIT_MESSAGE, FLOW_LIMIT_CODE)),
    ).toBe(true)
  })

  it('still treats 403 AccessDenied as non-transient', () => {
    expect(isTransientError(new HttpError(403, 'no', 'AccessDenied'))).toBe(
      false,
    )
  })

  it('still treats 400 InvalidParam as non-transient', () => {
    expect(isTransientError(new HttpError(400, 'bad', 'InvalidParam'))).toBe(
      false,
    )
  })

  it('keeps quota-style WorkflowLimitExceeded (permanent) non-transient', () => {
    // `/FlowLimit/` is case-sensitive: the lowercase `f` in
    // `WorkflowLimitExceeded` must not match — quota exhaustion is not flow
    // control, and grinding it through per-item retries would turn a fast
    // batch abort into minutes of useless backoff.
    expect(
      isTransientError(new HttpError(400, 'quota', 'WorkflowLimitExceeded')),
    ).toBe(false)
  })
})

describe('listAssetGroups — flow-control retry', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    useAuthStore.setState({
      assetCreds: {
        accessKeyId: 'AK',
        accessKeySecret: 'SK',
        projectName: 'p',
      },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mockOk(payload: unknown) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => payload,
    })
  }
  function mockErr(status: number, payload: unknown) {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => payload,
    })
  }

  it('retries a flow-control rejection and resolves once upstream recovers', async () => {
    mockErr(400, {
      error: { code: FLOW_LIMIT_CODE, message: FLOW_LIMIT_MESSAGE },
    })
    mockOk({
      Items: [
        {
          Id: 'group-1',
          Name: 'g1',
          GroupType: 'AIGC',
          ProjectName: 'p',
          CreateTime: '2026-08-11T00:00:00Z',
          UpdateTime: '2026-08-11T00:00:00Z',
        },
      ],
      TotalCount: 5881,
      PageNumber: 6,
      PageSize: 100,
    })

    const promise = listAssetGroups({}, { pageNumber: 6, pageSize: 100 })
    // Attach a handler synchronously so a mid-timer rejection surfaces as a
    // test failure, not an unhandled rejection (assetApi.test.ts pattern).
    void promise.catch(() => {})
    // Flush microtasks without advancing the clock: attempt 2 must be parked
    // behind a real backoff timer, not fired back-to-back in a hot loop.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    const out = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(out.items).toHaveLength(1)
    expect(out.items[0].id).toBe('group-1')
    expect(out.page.totalCount).toBe(5881)
    // The retry replays the same paging request, not a reset to page 1.
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(retryBody.PageNumber).toBe(6)
  })

  it('does NOT retry a terminal error (400 InvalidParam)', async () => {
    mockErr(400, { error: { code: 'InvalidParam', message: 'bad' } })

    const promise = listAssetGroups()
    const settled = promise.catch((e: unknown) => e)
    await vi.runAllTimersAsync()
    const err = await settled

    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).code).toBe('InvalidParam')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
