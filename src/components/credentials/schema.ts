import { TOS_REGIONS } from '../../utils/tosRegions'

export type CredKey = 'inference' | 'asset' | 'tos'
export type CredStatus = 'ok' | 'warn' | 'pend'

export interface CredentialFieldText {
  key: string
  label: string
  secret: boolean
  /** When omitted, treated as 'text'. */
  kind?: 'text'
  /** Optional placeholder shown inside an empty input. Use a template
   *  shape (e.g. 'ark-xxxx-xxxx') rather than a real value. */
  placeholder?: string
  /** Optional explainer text rendered as a small grey block below the
   *  input. Use for fields whose accepted formats / behaviors aren't
   *  obvious from the label alone. Plain text — no JSX. */
  hint?: string
}

export interface CredentialFieldSelect {
  key: string
  label: string
  secret: false
  kind: 'select'
  /** Options offered as <datalist> suggestions; user can still type any value. */
  options: readonly string[]
  /** Optional per-field hint, same role as on text fields. */
  hint?: string
}

export type CredentialField = CredentialFieldText | CredentialFieldSelect

export interface CredentialDef {
  key: CredKey
  label: string       // long Chinese label, e.g. '推論憑證'
  pillLabel: string   // short label for the header pill, e.g. '推論'
  hint: string        // sub-text shown under the title
  fields: CredentialField[]
}

export const CREDENTIALS: CredentialDef[] = [
  {
    key: 'inference',
    label: '推論憑證',
    pillLabel: '推論',
    hint: 'ModelArk API Key（共用）+ Seedance / Seedream / Seed Endpoint ID',
    fields: [
      {
        key: 'apiKey',
        label: 'API 金鑰',
        secret: true,
        placeholder: 'ark-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-xxxxx',
      },
      {
        key: 'endpoint',
        label: '影片生成接入點',
        secret: false,
        placeholder: 'ep-YYYYMMDDHHMMSS-xxxxx',
        hint: 'Seedance 影片生成模型的 Endpoint ID',
      },
      {
        key: 'videoEndpoint25',
        label: '影片生成接入點 (Seedance 2.5)',
        secret: false,
        placeholder: 'ep-YYYYMMDDHHMMSS-xxxxx（選填）',
        hint: '選填；留空則直接以 Model ID dreamina-seedance-2-5-260628 呼叫 Seedance 2.5',
      },
      {
        key: 'imageEndpoint',
        label: '圖片生成接入點',
        secret: false,
        placeholder: 'ep-YYYYMMDDHHMMSS-xxxxx',
        hint: 'Seedream 圖片生成模型的 Endpoint ID。至少需填影片、圖片或文字其中一個接入點',
      },
      {
        key: 'textEndpoint',
        label: '文字生成接入點',
        secret: false,
        placeholder: 'ep-YYYYMMDDHHMMSS-xxxxx',
        hint: 'Seed 文字生成（LLM）模型的 Endpoint ID。至少需填影片、圖片或文字其中一個接入點',
      },
    ],
  },
  {
    key: 'asset',
    label: '私有素材庫憑證',
    pillLabel: '素材庫',
    hint: 'BytePlus ARK AKSK + Project Name',
    fields: [
      { key: 'accessKeyId', label: 'Access Key ID', secret: true },
      { key: 'accessKeySecret', label: 'Secret Access Key', secret: true },
      { key: 'projectName', label: 'Project Name', secret: false },
    ],
  },
  {
    key: 'tos',
    label: '物件儲存憑證',
    pillLabel: 'TOS',
    hint: 'TOS bucket — AKSK + Region + Bucket。Bucket 寫法詳見下方欄位說明。',
    fields: [
      { key: 'accessKeyId', label: 'Access Key ID', secret: true },
      { key: 'accessKeySecret', label: 'Secret Access Key', secret: true },
      {
        key: 'region',
        label: 'Region',
        secret: false,
        kind: 'select',
        options: TOS_REGIONS,
      },
      {
        key: 'bucket',
        label: 'Bucket',
        secret: false,
        // Accepts plain bucket name OR bucket/prefix. The placeholder shows
        // both forms; the per-field hint walks a beginner through both
        // cases so they can pick without reading docs.
        placeholder: 'mybucket 或 mybucket/myprefix',
        hint:
          '兩種寫法擇一：\n' +
          '• 只填 bucket 名稱（例：mybucket）→ 系統會把所有素材自動放進 mybucket/seedance-2-0/ 前綴底下，避免污染既有資料\n' +
          '\n' +
          '• 填 bucket/自訂前綴（例：mybucket/team-a）→ 用你指定的前綴 team-a/ 取代預設的 seedance-2-0/',
      },
    ],
  },
]

// Index of CREDENTIALS by key for O(1) lookup.
// NOTE: callers assume exhaustive coverage of CredKey. If you add a new
// member to the CredKey union, also add a matching entry to the CREDENTIALS
// array — there is no compile-time check that all keys are present.
export const CREDENTIALS_BY_KEY: Record<CredKey, CredentialDef> = Object.fromEntries(
  CREDENTIALS.map((c) => [c.key, c]),
) as Record<CredKey, CredentialDef>

export const STATUS_TEXT: Record<CredStatus, string> = {
  ok: '已驗證',
  warn: '失敗',
  pend: '未驗證',
}
