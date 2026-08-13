/**
 * Frontend client for /local-api/asset/* — the Vite middleware that signs
 * BytePlus ARK Open API requests with the user-supplied AK/SK and forwards them.
 *
 * The browser never sees AK/SK. ProjectName and Moderation.Strategy are
 * applied server-side in vite-plugin-asset.ts.
 */
import type {
  Asset,
  AssetFilter,
  AssetGroup,
  AssetSortBy,
  AssetStatus,
  AssetTypeApi,
  PageInfo,
  SortOrder,
} from '../types/asset'
import { useAuthStore } from '../stores/authStore'
import { ARK_REGION, ARK_SERVICE, ARK_OPEN_API_HOST } from './arkConstants'

// ── Low-level transport ─────────────────────────────────────

interface UpstreamErrorPayload {
  error?: { code?: string; message?: string; requestId?: string }
}

/**
 * Structured error preserving HTTP status + upstream error code so the
 * retry layer can decide on rate-limit vs. terminal failures. Subclass
 * of Error so existing `catch`/`.message` consumers are unaffected.
 */
export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

/**
 * Transient = worth retrying with the same input: HTTP 429, any
 * throttle/ratelimit/flow-control-coded non-2xx, HTTP ≥500, or a
 * non-HttpError rejection (fetch network failure / timeout). Used by the
 * batch-delete orchestrator — a flow-control hit must retry the item, not
 * abort the whole batch. Non-transient (400/403) and 404 are handled by
 * callers.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof HttpError) {
    return (
      err.status === 429 ||
      err.status >= 500 ||
      /throttl|ratelimit/i.test(err.code ?? '') ||
      // FlowLimit: BytePlus `AccountFlowLimitExceeded` ("request speed …
      // beyond the current flow control limit") — matched on code because
      // its HTTP status is undocumented, so 429 alone can't be relied on.
      // Case-sensitive: the CamelCase boundary keeps quota-style
      // `WorkflowLimit*` codes (permanent, lowercase `f`) from matching.
      /FlowLimit/.test(err.code ?? '')
    )
  }
  return err instanceof Error
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const { assetCreds } = useAuthStore.getState()
  // Wrap with user creds from store. The server requires them and will 400
  // if absent (the UI gates the Asset Library page on assetCreds, so the
  // no-creds path here is the should-never-happen case).
  const hasUserCreds =
    assetCreds.accessKeyId !== '' ||
    assetCreds.accessKeySecret !== '' ||
    assetCreds.projectName !== ''
  const wrapped = hasUserCreds
    ? {
        ...(typeof body === 'object' && body !== null ? body : {}),
        creds: {
          accessKeyId: assetCreds.accessKeyId,
          accessKeySecret: assetCreds.accessKeySecret,
          region: ARK_REGION,
          service: ARK_SERVICE,
          host: ARK_OPEN_API_HOST,
          projectName: assetCreds.projectName,
        },
      }
    : (body ?? {})
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wrapped),
  })
  if (!res.ok) {
    let payload: UpstreamErrorPayload = {}
    try {
      payload = await res.json()
    } catch {
      // ignore — fall through to status-only message
    }
    const code = payload.error?.code
    const msg = payload.error?.message ?? `HTTP ${res.status}`
    throw new HttpError(res.status, code ? `${code}: ${msg}` : msg, code)
  }
  return (await res.json()) as T
}

/**
 * Retries `fn` when ARK returns a rate-limit signal. Triggers on HTTP
 * 429 or any non-2xx whose error code matches /throttl|ratelimit/i or
 * /FlowLimit/ — BytePlus follows the AWS convention of sending 400 +
 * ThrottlingException for some throttling cases. 4 attempts total:
 * initial + 3 backoffs at 500ms, 1000ms, 2000ms with +0-50% jitter to
 * avoid synchronised retry storms when N parallel uploads all hit the limit
 * at once.
 */
async function retryOnRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [500, 1000, 2000]
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const isRateLimited =
        err instanceof HttpError &&
        // FlowLimit: BytePlus `AccountFlowLimitExceeded` ("request speed …
        // beyond the current flow control limit") — matched on code because
        // its HTTP status is undocumented, so 429 alone can't be relied on.
        // Case-sensitive: keeps quota-style `WorkflowLimit*` codes out.
        (err.status === 429 ||
          /throttl|ratelimit/i.test(err.code ?? '') ||
          /FlowLimit/.test(err.code ?? ''))
      if (!isRateLimited || i >= delays.length) throw err
      const base = delays[i]
      const jittered = base + Math.random() * base * 0.5
      await new Promise((r) => setTimeout(r, jittered))
    }
  }
}

// ── Wire types ──────────────────────────────────────────────

export interface PageReq {
  pageNumber: number
  pageSize: number
}
export interface SortReq {
  sortBy?: AssetSortBy
  sortOrder?: SortOrder
}

interface ApiGroupItem {
  Id: string
  Name: string
  Description?: string
  GroupType: 'AIGC' | 'LivenessFace'
  ProjectName: string
  CreateTime: string
  UpdateTime: string
}
interface ApiAssetItem {
  Id: string
  Name: string
  URL: string
  GroupId: string
  AssetType: AssetTypeApi
  Status: AssetStatus
  Error?: { Code?: string; Message?: string }
  ProjectName: string
  CreateTime: string
  UpdateTime: string
}
interface ApiPagedResp<T> {
  Items: T[]
  TotalCount: number
  PageNumber: number
  PageSize: number
}

// ── Mappers ─────────────────────────────────────────────────

function mapGroup(g: ApiGroupItem): AssetGroup {
  return {
    id: g.Id,
    name: g.Name,
    description: g.Description,
    groupType: g.GroupType,
    projectName: g.ProjectName,
    createTime: g.CreateTime,
    updateTime: g.UpdateTime,
  }
}
function mapAsset(a: ApiAssetItem): Asset {
  return {
    id: a.Id,
    name: a.Name,
    url: a.URL,
    groupId: a.GroupId,
    assetType: a.AssetType,
    status: a.Status,
    error: a.Error
      ? { code: a.Error.Code, message: a.Error.Message }
      : undefined,
    projectName: a.ProjectName,
    createTime: a.CreateTime,
    updateTime: a.UpdateTime,
  }
}
function mapPage<T>(r: ApiPagedResp<T>): PageInfo {
  return {
    pageNumber: r.PageNumber,
    pageSize: r.PageSize,
    totalCount: r.TotalCount,
  }
}

// ── Group endpoints ─────────────────────────────────────────

export async function listAssetGroups(
  filter: { name?: string; groupIds?: string[] } = {},
  page: PageReq = { pageNumber: 1, pageSize: 50 },
  sort: SortReq = {},
): Promise<{ items: AssetGroup[]; page: PageInfo }> {
  const body = {
    Filter: {
      ...(filter.name ? { Name: filter.name } : {}),
      ...(filter.groupIds ? { GroupIds: filter.groupIds } : {}),
    },
    PageNumber: page.pageNumber,
    PageSize: page.pageSize,
    ...(sort.sortBy ? { SortBy: sort.sortBy } : {}),
    ...(sort.sortOrder ? { SortOrder: sort.sortOrder } : {}),
  }
  // Wrapped in retryOnRateLimit at the lowest level so every caller is
  // covered — initial load, load-more paging and server-side name search.
  // A 5,881-group account tripped AccountFlowLimitExceeded mid-paging and,
  // with the bare postJson, the list failed outright with zero retries.
  const resp = await retryOnRateLimit(() =>
    postJson<ApiPagedResp<ApiGroupItem>>('/local-api/asset/group/list', body),
  )
  return { items: resp.Items.map(mapGroup), page: mapPage(resp) }
}

/**
 * ListAssetGroups PageSize 的 API 上限 — 無限捲動每一頁都照這個大小抓，
 * 讓「一頁」在初載與載更多之間是同一個單位（分頁位移的前提）。
 */
export const GROUP_PAGE_SIZE_MAX = 100

export async function createAssetGroup(input: {
  name: string
  description?: string
}): Promise<{ id: string }> {
  const body = {
    Name: input.name,
    Description: input.description ?? '',
    GroupType: 'AIGC' as const,
  }
  const resp = await postJson<{ Id: string }>(
    '/local-api/asset/group/create',
    body,
  )
  return { id: resp.Id }
}

export async function getAssetGroup(id: string): Promise<AssetGroup> {
  const resp = await postJson<ApiGroupItem>('/local-api/asset/group/get', {
    Id: id,
  })
  return mapGroup(resp)
}

export async function updateAssetGroup(
  id: string,
  patch: { name?: string; description?: string },
): Promise<{ id: string }> {
  const body = {
    Id: id,
    ...(patch.name !== undefined ? { Name: patch.name } : {}),
    ...(patch.description !== undefined
      ? { Description: patch.description }
      : {}),
  }
  const resp = await postJson<{ Id: string }>(
    '/local-api/asset/group/update',
    body,
  )
  return { id: resp.Id }
}

export async function deleteAssetGroup(id: string): Promise<void> {
  await postJson<unknown>('/local-api/asset/group/delete', { Id: id })
}

// ── Asset endpoints ─────────────────────────────────────────

export async function listAssets(
  filter: AssetFilter = {},
  page: PageReq = { pageNumber: 1, pageSize: 24 },
  sort: SortReq = {},
): Promise<{ items: Asset[]; page: PageInfo }> {
  // Per ListAssets API: Filter accepts GroupIds / GroupType / Statuses /
  // Name only. AssetType is NOT a server-side filter; for type filtering
  // we narrow client-side after the response. See list-assets.md spec.
  const body = {
    Filter: {
      ...(filter.groupId ? { GroupIds: [filter.groupId] } : {}),
      ...(filter.statuses?.length ? { Statuses: filter.statuses } : {}),
      ...(filter.name ? { Name: filter.name } : {}),
    },
    PageNumber: page.pageNumber,
    PageSize: page.pageSize,
    ...(sort.sortBy ? { SortBy: sort.sortBy } : {}),
    ...(sort.sortOrder ? { SortOrder: sort.sortOrder } : {}),
  }
  const resp = await postJson<ApiPagedResp<ApiAssetItem>>(
    '/local-api/asset/list',
    body,
  )
  return { items: resp.Items.map(mapAsset), page: mapPage(resp) }
}

export async function createAsset(input: {
  groupId: string
  url: string
  assetType: AssetTypeApi
  name?: string
}): Promise<{ id: string }> {
  const body = {
    GroupId: input.groupId,
    URL: input.url,
    AssetType: input.assetType,
    ...(input.name !== undefined ? { Name: input.name } : {}),
  }
  // Wrapped in retryOnRateLimit because Premium tier QPM (300/min ≈ 5
  // QPS) is the binding constraint on batch upload concurrency; brief
  // bursts above that surface as 429 and would otherwise fail the user.
  const resp = await retryOnRateLimit(() =>
    postJson<{ Id: string }>('/local-api/asset/create', body),
  )
  return { id: resp.Id }
}

export async function getAsset(id: string): Promise<Asset> {
  const resp = await postJson<ApiAssetItem>('/local-api/asset/get', { Id: id })
  return mapAsset(resp)
}

export async function updateAsset(
  id: string,
  patch: { name: string },
): Promise<{ id: string }> {
  const resp = await postJson<{ Id: string }>('/local-api/asset/update', {
    Id: id,
    Name: patch.name,
  })
  return { id: resp.Id }
}

export async function deleteAsset(id: string): Promise<void> {
  await postJson<unknown>('/local-api/asset/delete', { Id: id })
}

// ── Cheap counters ──────────────────────────────────────────

/**
 * Returns just the TotalCount for assets in a group, without paying for
 * the full payload. PageSize=1 still fills in TotalCount on ARK's side.
 * Used to populate the sidebar's per-group counts in parallel.
 *
 * Wrapped in retryOnRateLimit because the caller's concurrency cap is not
 * a rate cap: 5 in-flight counts at ~100ms RTT is ~50 rps, so a big
 * account can still trip the QPM. The caller swallows failures into a '—'
 * placeholder, which would make that throttling silently indistinguishable
 * from an empty group.
 */
export async function countAssetsInGroup(groupId: string): Promise<number> {
  const { page } = await retryOnRateLimit(() =>
    listAssets({ groupId }, { pageNumber: 1, pageSize: 1 }),
  )
  return page.totalCount
}

// ── Polling helper ──────────────────────────────────────────

export interface PollOptions {
  intervalMs?: number
  maxWaitMs?: number
  onTick?: (a: Asset) => void
}

/**
 * Poll GetAsset until status is Active or Failed (or maxWaitMs elapses).
 * CreateAsset is asynchronous on the ARK side; videos commonly take a
 * minute or more.
 */
export async function pollAssetUntilDone(
  id: string,
  opts: PollOptions = {},
): Promise<Asset> {
  const intervalMs = opts.intervalMs ?? 30_000
  const maxWaitMs = opts.maxWaitMs ?? 600_000
  const deadline = Date.now() + maxWaitMs

  while (Date.now() < deadline) {
    const a = await getAsset(id)
    opts.onTick?.(a)
    if (a.status === 'Active' || a.status === 'Failed') return a
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Asset polling timed out after ${maxWaitMs / 1000}s: ${id}`)
}

// ── Cancellable polling helper ──────────────────────────────

export interface CancellablePollOptions {
  intervalMs?: number
  /** Defaults to `getAsset` — override for tests. */
  fetcher?: (id: string) => Promise<Asset>
  onTick?: (a: Asset) => void
}

export interface CancellablePoll {
  /** Resolves with the terminal Asset (Active or Failed) or rejects on cancel. */
  promise: Promise<Asset>
  cancel: () => void
}

/**
 * Like `pollAssetUntilDone` but cancellable. The poller checks the cancel
 * flag after every `getAsset` call AND after every `setTimeout` wakeup, so
 * `cancel()` causes the next loop iteration to reject promptly.
 */
export function pollUntilCancelled(
  id: string,
  opts: CancellablePollOptions = {},
): CancellablePoll {
  const intervalMs = opts.intervalMs ?? 5_000
  const fetch = opts.fetcher ?? getAsset
  let cancelled = false
  let wakeUp: (() => void) | null = null
  const cancel = () => {
    cancelled = true
    wakeUp?.()
  }

  const promise = (async () => {
    while (!cancelled) {
      const a = await fetch(id)
      if (cancelled) throw new Error('poll cancelled')
      opts.onTick?.(a)
      if (a.status === 'Active' || a.status === 'Failed') return a
      await new Promise<void>((r) => {
        wakeUp = r
        setTimeout(r, intervalMs)
      })
      wakeUp = null
    }
    throw new Error('poll cancelled')
  })()

  return { promise, cancel }
}
