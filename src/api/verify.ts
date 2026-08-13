import { ARK_REGION, ARK_SERVICE, ARK_OPEN_API_HOST } from './arkConstants'

export interface AssetVerifyOk {
  ok: true
  projectName: string
}
export interface AssetVerifyErr {
  ok: false
  code?: string
  message: string
  status?: number
  requestId?: string
}
export type AssetVerifyResult = AssetVerifyOk | AssetVerifyErr

export async function verifyAssetCreds(creds: {
  accessKeyId: string
  accessKeySecret: string
  projectName: string
}): Promise<AssetVerifyResult> {
  // Server fills in region/service/host from defaults — we send only what the
  // user typed.
  const res = await fetch('/local-api/asset/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creds: {
        ...creds,
        region: ARK_REGION,
        service: ARK_SERVICE,
        host: ARK_OPEN_API_HOST,
      },
    }),
  })
  if (res.status >= 400) {
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      /* fall through with default message */
    }
    return { ok: false, message, status: res.status }
  }
  return (await res.json()) as AssetVerifyResult
}

export interface TosVerifyOk {
  ok: true
  steps: { headBucket: string; cors: string; roundTrip: string }
  detail?: string
}
export interface TosVerifyErr {
  ok: false
  failingStep: string
  message: string
  steps?: Record<string, string>
}
export type TosVerifyResult = TosVerifyOk | TosVerifyErr

export async function verifyTosCreds(creds: {
  accessKeyId: string
  accessKeySecret: string
  region: string
  bucket: string
}): Promise<TosVerifyResult> {
  const res = await fetch('/local-api/tos/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creds }),
  })
  if (res.status >= 400) {
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      /* fall through with default message */
    }
    return { ok: false, failingStep: 'http', message }
  }
  const result = (await res.json()) as TosVerifyResult
  if (result.ok) {
    return { ...result, detail: `bucket: ${creds.bucket}` }
  }
  return result
}
