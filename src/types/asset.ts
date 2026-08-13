// ============================================================
// API Types — BytePlus ARK Asset Library
// ============================================================

/** Capitalised values as used on the wire. */
export type AssetTypeApi = 'Image' | 'Video' | 'Audio'
export type AssetStatus = 'Active' | 'Processing' | 'Failed'
export type GroupTypeApi = 'AIGC' | 'LivenessFace'

/** Lowercase values used in the UI; matches existing `AssetRef.type`. */
export type AssetTypeUi = 'image' | 'video' | 'audio'

const API_TO_UI: Record<AssetTypeApi, AssetTypeUi> = {
  Image: 'image',
  Video: 'video',
  Audio: 'audio',
}
const UI_TO_API: Record<AssetTypeUi, AssetTypeApi> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}

export const toApiAssetType = (t: AssetTypeUi): AssetTypeApi => UI_TO_API[t]
export const toUiAssetType = (t: AssetTypeApi): AssetTypeUi => API_TO_UI[t]

// ── asset:// URI helpers ────────────────────────────────────

const ASSET_URI = /^asset:\/\/(asset-[A-Za-z0-9-]+)$/

/** Returns the bare asset id ("asset-...") or null for any non-conforming input. */
export function parseAssetUri(uri: string): string | null {
  const m = ASSET_URI.exec(uri.trim())
  return m ? m[1] : null
}

/** Wrap an asset id in the canonical asset:// URI form. */
export function formatAssetUri(id: string): string {
  return `asset://${id}`
}

// ── Domain types ────────────────────────────────────────────

export interface AssetGroup {
  id: string
  name: string
  description?: string
  groupType: GroupTypeApi
  projectName: string
  /** ISO 8601 — comes from ARK as e.g. "2026-03-18T03:33:32Z" */
  createTime: string
  updateTime: string
}

export interface Asset {
  id: string
  name: string
  /** Pre-signed download URL valid for 12 hours from creation. */
  url: string
  groupId: string
  assetType: AssetTypeApi
  status: AssetStatus
  /** Populated when status === 'Failed'. */
  error?: { code?: string; message?: string }
  projectName: string
  createTime: string
  updateTime: string
}

export interface PageInfo {
  pageNumber: number
  pageSize: number
  totalCount: number
}

// ── Filter / sort types ─────────────────────────────────────

export interface AssetFilter {
  /** Fuzzy match against Asset.Name. */
  name?: string
  types?: AssetTypeApi[]
  statuses?: AssetStatus[]
  groupId?: string
}

export type AssetSortBy = 'CreateTime' | 'UpdateTime' | 'GroupId'
export type SortOrder = 'Asc' | 'Desc'
