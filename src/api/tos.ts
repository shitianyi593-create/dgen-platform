/**
 * Frontend client for TOS pre-signed URL endpoints exposed by
 * vite-plugin-tos. The browser never sees the AK/SK — it asks the dev
 * server to sign URLs and uploads via those.
 */
import { useAuthStore } from '../stores/authStore'
import { parseBucketAndPrefix } from '../utils/tosBucket'

export interface SignPutResp {
  url: string
  key: string
  expiresAt: number
}

export interface SignGetResp {
  url: string
  expiresAt: number
}

export interface UploadResult {
  key: string
  /** GET pre-signed URL valid until expiresAt (Unix seconds). */
  viewUrl: string
  expiresAt: number
}

export interface UploadOptions {
  /** Override the default GET URL TTL (in seconds). */
  expiresSec?: number
  /** Allow the caller to abort an in-flight upload. */
  signal?: AbortSignal
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const { tosCreds } = useAuthStore.getState()
  // Wrap with user creds from store. The server requires them and will 400
  // if absent (the UI gates upload buttons until tosCreds are filled, so
  // the no-creds path here is the should-never-happen case).
  const hasUserCreds =
    tosCreds.accessKeyId !== '' ||
    tosCreds.accessKeySecret !== '' ||
    tosCreds.bucket !== ''
  const wrapped = hasUserCreds
    ? (() => {
        const { bucket, keyPrefix } = parseBucketAndPrefix(tosCreds.bucket)
        return {
          ...(typeof body === 'object' && body !== null ? body : {}),
          creds: {
            accessKeyId: tosCreds.accessKeyId,
            accessKeySecret: tosCreds.accessKeySecret,
            region: tosCreds.region,
            bucket,
            keyPrefix,
            defaultGetTtlSeconds: 10800,
          },
        }
      })()
    : (body ?? {})
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wrapped),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // ignore — fall back to status
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

/** Ask the dev server for a short-lived PUT URL we can stream the file to. */
export async function signPutUrl(
  filename: string,
  contentType?: string,
  sizeBytes?: number,
): Promise<SignPutResp> {
  return postJson<SignPutResp>('/local-api/tos/sign-put', {
    filename,
    contentType,
    sizeBytes,
  })
}

/** Ask the dev server for a GET URL valid for `expiresSec` (default 3 hours). */
export async function signGetUrl(
  key: string,
  expiresSec?: number,
): Promise<SignGetResp> {
  return postJson<SignGetResp>('/local-api/tos/sign-get', {
    key,
    expiresSec,
  })
}

/**
 * Full upload flow: sign-put → PUT to TOS → sign-get.
 * The returned `viewUrl` is what we hand to Seedance as `video_url.url` /
 * `audio_url.url`.
 */
export async function uploadToTos(
  file: File,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const contentType = file.type || 'application/octet-stream'
  const put = await signPutUrl(file.name, contentType, file.size)

  const putRes = await fetch(put.url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
    signal: opts.signal,
  })
  if (!putRes.ok) {
    throw new Error(`TOS upload failed: HTTP ${putRes.status}`)
  }

  const get = await signGetUrl(put.key, opts.expiresSec)
  return { key: put.key, viewUrl: get.url, expiresAt: get.expiresAt }
}
