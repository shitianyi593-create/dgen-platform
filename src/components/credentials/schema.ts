import { TOS_REGIONS } from '../../utils/tosRegions'
import type { MessageKey } from '../../i18n/locales'

export type CredKey = 'inference' | 'asset' | 'tos'
export type CredStatus = 'ok' | 'warn' | 'pend'

export interface CredentialFieldText {
  key: string
  labelKey: MessageKey
  secret: boolean
  /** When omitted, treated as 'text'. */
  kind?: 'text'
  /** Optional placeholder shown inside an empty input. Use a template
   *  shape (e.g. 'ark-xxxx-xxxx') rather than a real value. */
  placeholderKey?: MessageKey
  /** Optional explainer text rendered as a small grey block below the
   *  input. Use for fields whose accepted formats / behaviors aren't
   *  obvious from the label alone. Plain text — no JSX. */
  hintKey?: MessageKey
}

export interface CredentialFieldSelect {
  key: string
  labelKey: MessageKey
  secret: false
  kind: 'select'
  /** Options offered as <datalist> suggestions; user can still type any value. */
  options: readonly string[]
  /** Optional per-field hint, same role as on text fields. */
  hintKey?: MessageKey
}

export type CredentialField = CredentialFieldText | CredentialFieldSelect

export interface CredentialDef {
  key: CredKey
  labelKey: MessageKey
  pillLabelKey: MessageKey
  hintKey: MessageKey
  fields: CredentialField[]
}

export const CREDENTIALS: CredentialDef[] = [
  {
    key: 'inference',
    labelKey: 'credentials.inference.label',
    pillLabelKey: 'credentials.inference.pill',
    hintKey: 'credentials.inference.hint',
    fields: [
      {
        key: 'apiKey',
        labelKey: 'credentials.field.apiKey',
        secret: true,
        placeholderKey: 'credentials.placeholder.apiKey',
      },
      {
        key: 'endpoint',
        labelKey: 'credentials.field.videoEndpoint',
        secret: false,
        placeholderKey: 'credentials.placeholder.endpoint',
        hintKey: 'credentials.hint.videoEndpoint',
      },
      {
        key: 'videoEndpoint25',
        labelKey: 'credentials.field.videoEndpoint25',
        secret: false,
        placeholderKey: 'credentials.placeholder.endpointOptional',
        hintKey: 'credentials.hint.videoEndpoint25',
      },
      {
        key: 'imageEndpoint',
        labelKey: 'credentials.field.imageEndpoint',
        secret: false,
        placeholderKey: 'credentials.placeholder.endpoint',
        hintKey: 'credentials.hint.imageEndpoint',
      },
      {
        key: 'textEndpoint',
        labelKey: 'credentials.field.textEndpoint',
        secret: false,
        placeholderKey: 'credentials.placeholder.endpoint',
        hintKey: 'credentials.hint.textEndpoint',
      },
    ],
  },
  {
    key: 'asset',
    labelKey: 'credentials.asset.label',
    pillLabelKey: 'credentials.asset.pill',
    hintKey: 'credentials.asset.hint',
    fields: [
      { key: 'accessKeyId', labelKey: 'credentials.field.accessKeyId', secret: true },
      { key: 'accessKeySecret', labelKey: 'credentials.field.accessKeySecret', secret: true },
      { key: 'projectName', labelKey: 'credentials.field.projectName', secret: false },
    ],
  },
  {
    key: 'tos',
    labelKey: 'credentials.storage.label',
    pillLabelKey: 'credentials.storage.pill',
    hintKey: 'credentials.storage.hint',
    fields: [
      { key: 'accessKeyId', labelKey: 'credentials.field.accessKeyId', secret: true },
      { key: 'accessKeySecret', labelKey: 'credentials.field.accessKeySecret', secret: true },
      {
        key: 'region',
        labelKey: 'credentials.field.region',
        secret: false,
        kind: 'select',
        options: TOS_REGIONS,
      },
      {
        key: 'bucket',
        labelKey: 'credentials.field.bucket',
        secret: false,
        // Accepts plain bucket name OR bucket/prefix. The placeholder shows
        // both forms; the per-field hint walks a beginner through both
        // cases so they can pick without reading docs.
        placeholderKey: 'credentials.placeholder.bucket',
        hintKey: 'credentials.hint.bucket',
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

export const STATUS_TEXT_KEYS: Record<CredStatus, MessageKey> = {
  ok: 'credentials.status.ok',
  warn: 'credentials.status.warn',
  pend: 'credentials.status.pend',
}
