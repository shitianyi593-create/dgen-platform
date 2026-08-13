// ============================================================
// API Types — Seedance 2.0 / BytePlus ModelArk
// ============================================================

/** Content item types for the generation request */
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageUrlContent {
  type: 'image_url';
  image_url: { url: string };
  role: ImageRole;
}

export interface VideoUrlContent {
  type: 'video_url';
  video_url: { url: string };
  role: 'reference_video';
}

export interface AudioUrlContent {
  type: 'audio_url';
  audio_url: { url: string };
  role: 'reference_audio';
}

export type ContentItem = TextContent | ImageUrlContent | VideoUrlContent | AudioUrlContent;

/** Request body for creating a video generation task */
export interface CreateVideoTaskRequest {
  model: string;
  content: ContentItem[];
  ratio?: string;
  duration?: number;
  resolution?: string;
  watermark?: boolean;
  generate_audio?: boolean;
  /** Integer in [-1, 2^32-1]. -1 = random (default). Same seed + same
   *  request → similar (not necessarily identical) output. */
  seed?: number;
  /** When true, the response's `content.last_frame_url` will be populated
   *  with the PNG of the final frame — useful for chaining a follow-up
   *  generation with that frame as the next clip's first frame. */
  return_last_frame?: boolean;
  /** Task expiration threshold in seconds, calculated from created_at.
   *  ARK valid range: [3600, 259200]. ARK default: 172800 (48h).
   *  We default this to 3600 (1h) for tighter feedback loops. */
  execution_expires_after?: number;
}

/** Response from creating a video generation task */
export interface CreateVideoTaskResponse {
  id: string;
}

/** Task status values */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

/** Response from retrieving a video generation task */
export interface VideoTask {
  id: string;
  model: string;
  status: TaskStatus;
  content?: {
    video_url?: string;
    /** Returned only if the create request had `return_last_frame: true`.
     *  PNG, same dimensions as the video, no watermark, valid for 24h. */
    last_frame_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
  created_at: number;
  updated_at?: number;
  seed?: number;
  resolution?: string;
  ratio?: string;
  duration?: number;
  framespersecond?: number;
  service_tier?: string;
  execution_expires_after?: number;
  generate_audio?: boolean;
  draft?: boolean;
}

/** File upload response */
export interface UploadedFile {
  object: 'file';
  id: string;
  purpose: string;
  filename: string;
  bytes: number;
  mime_type: string;
  created_at: number;
  expire_at: number;
  status: 'processing' | 'active' | 'error';
}

// ============================================================
// UI / Store Types
// ============================================================

/** Asset reference entry — an asset:// URI with a user-chosen type */
export type AssetType = 'image' | 'video' | 'audio';

export interface AssetRef {
  id: string;       // raw ID, e.g. "asset-20260224213258-pnqkh"
  type: AssetType;  // determines whether to send as image_url / video_url / audio_url
  role?: ImageRole;
}

/** Local reference media (before/after upload) */
export interface LocalMedia {
  /** Stable client-generated id so async uploads can locate the item even if
   *  the array order changes (e.g. user removes/re-adds while uploading). */
  id?: string;
  /** Optional because rehydrated stale stubs (from sessionStorage) have
   *  no File — the user must remove + re-attach to use them. */
  file?: File;
  preview: string;        // local object URL for preview
  uploadedFileId?: string; // after Files API upload (legacy / images)
  uploadedUrl?: string;    // resolved URL for API (TOS pre-signed GET URL for video/audio)
  /** TOS object key for video/audio references; lets us re-sign or delete later. */
  tosKey?: string;
  uploading: boolean;
  error?: string;
  /** Original filename — preserved separately from `file.name` so that
   *  rehydrated stubs (which have no File) still display a name. */
  filename?: string;
  role?: ImageRole;
  /** True for items rehydrated from sessionStorage — they have no File
   *  and cannot be submitted. UI renders them greyed-out; user must
   *  remove + re-attach to use. */
  stale?: boolean;
}

/** A video generation history entry */
export interface VideoHistoryItem {
  taskId: string;
  status: TaskStatus;
  prompt: string;
  videoUrl?: string;
  /** Object URL for an imported task's mp4 (Blob-backed, in-memory only —
   *  dies on page reload). Replaces the old server-side `localVideoPath`. */
  objectUrl?: string;
  /** PNG of the last frame, returned by Seedance when `return_last_frame=true`. */
  lastFrameUrl?: string;
  /** Object URL for an imported task's last-frame PNG. Lives only in memory. */
  frameObjectUrl?: string;
  thumbnailUrl?: string;
  createdAt: number;
  updatedAt?: number;
  seed?: number;
  resolution?: string;
  ratio?: string;
  duration?: number;
  fps?: number;
  error?: string;
  /** Full request body sent to the API (saved for export) */
  requestContent?: CreateVideoTaskRequest;
  /** True when this item came from an imported JSON rather than a live
   *  generation in this session — bypasses the "recent 2 hours" UI filter. */
  imported?: boolean;
  /** 實際送出的 model 字串（endpoint ID 或 Model ID）。2.5 頁寫入，匯出溯源用。 */
  model?: string;
  /** 提示詞優化開啟時的使用者原文；`prompt` 一律是實際送出的版本。 */
  originalPrompt?: string;
  /** The execution_expires_after value (seconds) sent at create time. */
  executionExpiresAfter?: number;
  /** True when polling failed with 401/403 — the task was created with
   *  different credentials than the current session and cannot be queried. */
  orphaned?: boolean;
}

/** Available output resolutions for Seedance 2.0.
 *  Default is 720p per official spec. 1080p is supported by Seedance 2.0 but
 *  NOT by Seedance 2.0 fast. */
export const RESOLUTION_OPTIONS = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
] as const;

/** Seedance 2.5 Model ID — `model` 欄位在 videoEndpoint25 留空時的 fallback。 */
export const SEEDANCE_25_MODEL_ID = 'dreamina-seedance-2-5-260628';

/** Seedance 2.5 只支援 480p / 720p（官方 01 文件）。
 *  // TODO(tech-debt): seedanceModels 能力表合併 */
export const RESOLUTION_OPTIONS_25 = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
] as const;

/** Seedance 2.5 長度：-1 = Auto（官方預設），或 4–30 秒整數。 */
export const DURATION_OPTIONS_25: ReadonlyArray<{ value: number; label: string }> = [
  { value: -1, label: 'Auto（模型自選）' },
  ...Array.from({ length: 27 }, (_, i) => ({ value: i + 4, label: `${i + 4} 秒` })),
];

/** Available aspect ratios — 'adaptive' is Seedance 2.0's default and lets
 *  the model auto-select the best ratio based on the inputs. */
export const RATIO_OPTIONS = [
  { value: 'adaptive', label: 'Adaptive（自動依輸入選擇）' },
  { value: '16:9', label: '16:9 (橫向)' },
  { value: '9:16', label: '9:16 (直向)' },
  { value: '1:1', label: '1:1 (方形)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9 (超寬)' },
] as const;

/** Available duration options.
 *
 *  Seedance 2.0 & 2.0 fast accept any integer in [4, 15] (seconds), or `-1`
 *  for "auto — model picks the best length within the valid range". The
 *  legacy default is 5s; we keep that as the initial value but expose every
 *  valid option in the UI. */
export const DURATION_OPTIONS = [
  { value: -1, label: 'Auto（模型自選）' },
  { value: 4, label: '4 秒' },
  { value: 5, label: '5 秒' },
  { value: 6, label: '6 秒' },
  { value: 7, label: '7 秒' },
  { value: 8, label: '8 秒' },
  { value: 9, label: '9 秒' },
  { value: 10, label: '10 秒' },
  { value: 11, label: '11 秒' },
  { value: 12, label: '12 秒' },
  { value: 13, label: '13 秒' },
  { value: 14, label: '14 秒' },
  { value: 15, label: '15 秒' },
] as const;

/** Task expiration threshold options. Values are seconds.
 *  ARK valid range: [3600, 259200] (1hr ~ 72hr). */
export const EXECUTION_EXPIRES_OPTIONS = [
  { value: 3600,   label: '1 小時 (預設)' },
  { value: 7200,   label: '2 小時' },
  { value: 14400,  label: '4 小時' },
  { value: 28800,  label: '8 小時' },
  { value: 86400,  label: '24 小時' },
  { value: 172800, label: '48 小時' },
  { value: 259200, label: '72 小時 (最長)' },
] as const;

// ============================================================
// Video generation mode + image role (Seedance 2.0 三模式互斥)
// ============================================================

export type ImageRole = 'first_frame' | 'last_frame' | 'reference_image';
export type VideoGenMode = 'first_frame' | 'first_last_frame' | 'multimodal';
