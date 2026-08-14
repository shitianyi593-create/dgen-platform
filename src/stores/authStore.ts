import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { verifyAssetCreds, verifyTosCreds } from '../api/verify'
import type { CredKey, CredStatus } from '../components/credentials/schema'
import type { EnvCredsPartial } from '../components/credentials/envImport'
import { parseBucketAndPrefix } from '../utils/tosBucket'

/** BytePlus ARK credentials for asset operations (NOT TOS object-storage keys). */
export interface AssetCreds {
  /** ARK access key ID. */
  accessKeyId: string
  /** ARK access key secret. */
  accessKeySecret: string
  /** ARK project name (BytePlus tenancy scope). */
  projectName: string
}

/** BytePlus TOS object-storage credentials (NOT BytePlus ARK keys). */
export interface TosCreds {
  /** TOS access key ID. */
  accessKeyId: string
  /** TOS access key secret. */
  accessKeySecret: string
  /** TOS bucket region (e.g. ap-southeast-1). The endpoint is derived
   *  server-side via tos-{region}.bytepluses.com. */
  region: string
  /** TOS bucket name. */
  bucket: string
}

export interface VerifyEntry {
  status: CredStatus
  message: string
  lastTestedAt?: number
}

export interface VerifyState {
  inference: VerifyEntry
  asset: VerifyEntry
  tos: VerifyEntry
}

interface AuthState {
  apiKey: string
  endpoint: string
  /** Seedream 图片生成接入点。与视频的 `endpoint` 平行；API Key 共用。 */
  imageEndpoint: string
  /** Seed 文字生成接入点。与视频 `endpoint`、图片 `imageEndpoint` 平行；API Key 共用。 */
  textEndpoint: string
  /** Seedance 2.5 视频生成接入点。选填：留空时直接以 Model ID 呼叫。 */
  videoEndpoint25: string
  assetCreds: AssetCreds
  tosCreds: TosCreds
  verifyState: VerifyState
  setApiKey: (key: string) => void
  setEndpoint: (ep: string) => void
  setImageEndpoint: (ep: string) => void
  setTextEndpoint: (ep: string) => void
  setVideoEndpoint25: (ep: string) => void
  setAssetCreds: (creds: Partial<AssetCreds>) => void
  setTosCreds: (creds: Partial<TosCreds>) => void
  setField: (credKey: CredKey, fieldKey: string, value: string) => void
  verify: (credKey: CredKey) => Promise<void>
  applyImportedEnv: (parts: EnvCredsPartial) => void
}

const EMPTY_ASSET_CREDS: AssetCreds = {
  accessKeyId: '', accessKeySecret: '',
  // ARK Asset console creates a 'default' project automatically for every
  // tenant — pre-fill so most users don't have to look it up. Existing
  // sessions keep whatever the user typed; this only seeds fresh state.
  projectName: 'default',
}

const EMPTY_TOS_CREDS: TosCreds = {
  accessKeyId: '', accessKeySecret: '',
  region: 'ap-southeast-1',
  bucket: '',
}

const PEND_ENTRY: VerifyEntry = { status: 'pend', message: '尚未验证' }
/** Sentinel message set on a credential's verifyState while a network test is in flight. */
export const PENDING_TEST_MSG = '验证中…'
const PENDING_TEST_ENTRY: VerifyEntry = { status: 'pend', message: PENDING_TEST_MSG }

const EMPTY_VERIFY_STATE: VerifyState = {
  inference: { ...PEND_ENTRY },
  asset: { ...PEND_ENTRY },
  tos: { ...PEND_ENTRY },
}

// One-time cleanup: any leftover v3 entry in localStorage from the previous
// release MUST be removed so creds saved by another user of the same browser
// don't leak in. The new home is sessionStorage (per-tab).
if (typeof window !== 'undefined') {
  try { window.localStorage.removeItem('ai-gen-auth') } catch { /* best effort */ }
}

// Inference credential format checks. Patterns derived from real BytePlus
// values; see docs at https://docs.byteplus.com/ for canonical specs. We
// keep two API-key forms (raw UUID + ark-prefixed) because both appear in
// the wild from different ARK consoles.
const ENDPOINT_PATTERN = /^ep-\d{14}-[a-z0-9]{5}$/i
const API_KEY_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const API_KEY_ARK_PATTERN =
  /^ark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{5}$/i

const isValidApiKey = (s: string): boolean =>
  API_KEY_UUID_PATTERN.test(s) || API_KEY_ARK_PATTERN.test(s)

const validateInference = (
  apiKey: string,
  endpoint: string,
  imageEndpoint: string,
  textEndpoint: string,
  videoEndpoint25: string,
): VerifyEntry => {
  const apiKeyTrimmed = apiKey.trim()
  const epTrimmed = endpoint.trim()
  const imgEpTrimmed = imageEndpoint.trim()
  const txtEpTrimmed = textEndpoint.trim()
  const ep25Trimmed = videoEndpoint25.trim()
  // All blank → user hasn't started filling this section yet.
  if (!apiKeyTrimmed && !epTrimmed && !imgEpTrimmed && !txtEpTrimmed && !ep25Trimmed) {
    return { ...PEND_ENTRY }
  }
  if (!isValidApiKey(apiKeyTrimmed)) {
    return {
      status: 'warn',
      message: 'API 密钥格式不符（UUID 或 ark-{UUID}-{5字符}）',
      lastTestedAt: Date.now(),
    }
  }
  if (!epTrimmed && !imgEpTrimmed && !txtEpTrimmed && !ep25Trimmed) {
    return {
      status: 'warn',
      message: '至少需填一个接入点（视频、图片或文字生成）',
      lastTestedAt: Date.now(),
    }
  }
  if (epTrimmed && !ENDPOINT_PATTERN.test(epTrimmed)) {
    return {
      status: 'warn',
      message: '视频生成接入点格式不符（应为 ep-YYYYMMDDHHMMSS-XXXXX）',
      lastTestedAt: Date.now(),
    }
  }
  if (imgEpTrimmed && !ENDPOINT_PATTERN.test(imgEpTrimmed)) {
    return {
      status: 'warn',
      message: '图片生成接入点格式不符（应为 ep-YYYYMMDDHHMMSS-XXXXX）',
      lastTestedAt: Date.now(),
    }
  }
  if (txtEpTrimmed && !ENDPOINT_PATTERN.test(txtEpTrimmed)) {
    return {
      status: 'warn',
      message: '文字生成接入点格式不符（应为 ep-YYYYMMDDHHMMSS-XXXXX）',
      lastTestedAt: Date.now(),
    }
  }
  if (ep25Trimmed && !ENDPOINT_PATTERN.test(ep25Trimmed)) {
    return {
      status: 'warn',
      message: '2.5 视频生成接入点格式不符（应为 ep-YYYYMMDDHHMMSS-XXXXX；选填）',
      lastTestedAt: Date.now(),
    }
  }
  return { status: 'ok', message: '格式检查通过', lastTestedAt: Date.now() }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      apiKey: '',
      endpoint: '',
      imageEndpoint: '',
      textEndpoint: '',
      videoEndpoint25: '',
      assetCreds: { ...EMPTY_ASSET_CREDS },
      tosCreds: { ...EMPTY_TOS_CREDS },
      verifyState: { ...EMPTY_VERIFY_STATE },
      setApiKey: (apiKey) => set((s) => ({
        apiKey,
        verifyState: {
          ...s.verifyState,
          inference: validateInference(apiKey, s.endpoint, s.imageEndpoint, s.textEndpoint, s.videoEndpoint25),
        },
      })),
      setEndpoint: (endpoint) => set((s) => ({
        endpoint,
        verifyState: {
          ...s.verifyState,
          inference: validateInference(s.apiKey, endpoint, s.imageEndpoint, s.textEndpoint, s.videoEndpoint25),
        },
      })),
      setImageEndpoint: (imageEndpoint) => set((s) => ({
        imageEndpoint,
        verifyState: {
          ...s.verifyState,
          inference: validateInference(s.apiKey, s.endpoint, imageEndpoint, s.textEndpoint, s.videoEndpoint25),
        },
      })),
      setTextEndpoint: (textEndpoint) => set((s) => ({
        textEndpoint,
        verifyState: {
          ...s.verifyState,
          inference: validateInference(s.apiKey, s.endpoint, s.imageEndpoint, textEndpoint, s.videoEndpoint25),
        },
      })),
      setVideoEndpoint25: (videoEndpoint25) => set((s) => ({
        videoEndpoint25,
        verifyState: {
          ...s.verifyState,
          inference: validateInference(s.apiKey, s.endpoint, s.imageEndpoint, s.textEndpoint, videoEndpoint25),
        },
      })),
      setAssetCreds: (partial) => set((s) => ({
        assetCreds: { ...s.assetCreds, ...partial },
        verifyState: { ...s.verifyState, asset: { ...PEND_ENTRY } },
      })),
      setTosCreds: (partial) => set((s) => ({
        tosCreds: { ...s.tosCreds, ...partial },
        verifyState: { ...s.verifyState, tos: { ...PEND_ENTRY } },
      })),
      // setField: generic dispatcher used by the schema-driven CredentialForm.
      // CONTRACT: callers MUST pass a fieldKey defined on the matching
      // CredentialDef in src/components/credentials/schema.ts. Unknown keys
      // for 'inference' are silently dropped; unknown keys for 'asset'/'tos'
      // would be unsafely spread into the creds object via Partial<...>
      // (typed as `Partial<X>` but TypeScript cannot verify the runtime key
      // is actually a property of X). The schema-driven UI flow guarantees
      // valid keys; this comment exists so a future caller writing a
      // string-literal call site knows what they're touching.
      setField: (credKey, fieldKey, value) => {
        if (credKey === 'inference') {
          if (fieldKey === 'apiKey') get().setApiKey(value)
          else if (fieldKey === 'endpoint') get().setEndpoint(value)
          else if (fieldKey === 'imageEndpoint') get().setImageEndpoint(value)
          else if (fieldKey === 'textEndpoint') get().setTextEndpoint(value)
          else if (fieldKey === 'videoEndpoint25') get().setVideoEndpoint25(value)
        } else if (credKey === 'asset') {
          get().setAssetCreds({ [fieldKey]: value } as Partial<AssetCreds>)
        } else if (credKey === 'tos') {
          get().setTosCreds({ [fieldKey]: value } as Partial<TosCreds>)
        }
      },
      verify: async (credKey) => {
        if (credKey === 'inference') {
          const { apiKey, endpoint, imageEndpoint, textEndpoint, videoEndpoint25 } = get()
          const result = validateInference(apiKey, endpoint, imageEndpoint, textEndpoint, videoEndpoint25)
          set((s) => ({ verifyState: { ...s.verifyState, inference: result } }))
          return
        }
        // Mark pending
        set((s) => ({
          verifyState: { ...s.verifyState, [credKey]: { ...PENDING_TEST_ENTRY } },
        }))
        try {
          if (credKey === 'asset') {
            const r = await verifyAssetCreds(get().assetCreds)
            const entry: VerifyEntry = r.ok
              ? { status: 'ok', message: `proj: ${r.projectName}`, lastTestedAt: Date.now() }
              : { status: 'warn', message: r.message, lastTestedAt: Date.now() }
            set((s) => ({ verifyState: { ...s.verifyState, asset: entry } }))
          } else {
            const tosState = get().tosCreds
            const { bucket } = parseBucketAndPrefix(tosState.bucket)
            const r = await verifyTosCreds({
              accessKeyId: tosState.accessKeyId,
              accessKeySecret: tosState.accessKeySecret,
              region: tosState.region,
              bucket,
            })
            const entry: VerifyEntry = r.ok
              ? { status: 'ok', message: r.detail ?? '验证通过', lastTestedAt: Date.now() }
              : { status: 'warn', message: r.message, lastTestedAt: Date.now() }
            set((s) => ({ verifyState: { ...s.verifyState, tos: entry } }))
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : '验证异常'
          set((s) => ({
            verifyState: {
              ...s.verifyState,
              [credKey]: { status: 'warn', message, lastTestedAt: Date.now() },
            },
          }))
        }
      },
      applyImportedEnv: (parts) => {
        const touched: CredKey[] = []
        if (parts.inference && Object.keys(parts.inference).length > 0) touched.push('inference')
        if (parts.asset && Object.keys(parts.asset).length > 0) touched.push('asset')
        if (parts.tos && Object.keys(parts.tos).length > 0) touched.push('tos')
        if (touched.length === 0) return

        set((s) => {
          const nextApiKey   = parts.inference?.apiKey   ?? s.apiKey
          const nextEndpoint = parts.inference?.endpoint ?? s.endpoint
          const nextImageEndpoint = parts.inference?.imageEndpoint ?? s.imageEndpoint
          const nextTextEndpoint = parts.inference?.textEndpoint ?? s.textEndpoint
          const nextVideoEndpoint25 = parts.inference?.videoEndpoint25 ?? s.videoEndpoint25
          const nextAsset    = parts.asset ? { ...s.assetCreds, ...parts.asset } : s.assetCreds
          const nextTos      = parts.tos   ? { ...s.tosCreds,   ...parts.tos   } : s.tosCreds
          const nextVerify   = { ...s.verifyState }
          if (touched.includes('inference')) {
            nextVerify.inference = validateInference(nextApiKey, nextEndpoint, nextImageEndpoint, nextTextEndpoint, nextVideoEndpoint25)
          }
          if (touched.includes('asset')) nextVerify.asset = { ...PEND_ENTRY }
          if (touched.includes('tos'))   nextVerify.tos   = { ...PEND_ENTRY }
          return {
            apiKey: nextApiKey,
            endpoint: nextEndpoint,
            imageEndpoint: nextImageEndpoint,
            textEndpoint: nextTextEndpoint,
            videoEndpoint25: nextVideoEndpoint25,
            assetCreds: nextAsset,
            tosCreds: nextTos,
            verifyState: nextVerify,
          }
        })

        for (const k of touched) {
          if (k === 'inference') continue  // local-only; already settled above
          void get().verify(k)
        }
      },
    }),
    {
      name: 'byteplus-ai-gen-platform-auth',
      // sessionStorage = per-tab. Refreshes within a tab keep credentials;
      // closing the tab / opening a new tab starts fresh so a previous user's
      // keys do not leak to the next person opening the browser.
      storage: createJSONStorage(() => sessionStorage),
      version: 8,
      migrate: (persistedState: unknown, fromVersion: number) => {
        const s = (persistedState ?? {}) as Partial<AuthState>
        const next: Partial<AuthState> = { ...s }
        if (fromVersion < 2) next.assetCreds = { ...EMPTY_ASSET_CREDS }
        if (fromVersion < 3) next.tosCreds = { ...EMPTY_TOS_CREDS }
        if (fromVersion < 4) next.verifyState = { ...EMPTY_VERIFY_STATE }
        if (fromVersion < 5) {
          // Strip the legacy `endpoint` field from persisted tosCreds. Endpoint
          // is now derived server-side from region (Tasks 2 & 3).
          const t = (next.tosCreds ?? {}) as Record<string, unknown>
          delete t.endpoint
          next.tosCreds = {
            ...EMPTY_TOS_CREDS,
            ...(t as Partial<TosCreds>),
          }
        }
        if (fromVersion < 6) {
          next.imageEndpoint = ''
        }
        if (fromVersion < 7) {
          next.textEndpoint = ''
        }
        if (fromVersion < 8) {
          next.videoEndpoint25 = ''
        }
        return next as AuthState
      },
    },
  ),
)
