import { apiClient } from './client';
import type {
  CreateVideoTaskRequest,
  CreateVideoTaskResponse,
  VideoTask,
  UploadedFile,
  TaskStatus,
} from '../types';

const TASKS_PATH = '/api/v3/contents/generations/tasks';
const FILES_PATH = '/api/v3/files';

// ── Task CRUD ───────────────────────────────────────────────

/** Create a video generation task */
export async function createVideoTask(
  body: CreateVideoTaskRequest,
): Promise<CreateVideoTaskResponse> {
  const { data } = await apiClient.post<CreateVideoTaskResponse>(TASKS_PATH, body);
  return data;
}

/** Retrieve a single task by ID */
export async function getVideoTask(taskId: string): Promise<VideoTask> {
  const { data } = await apiClient.get<VideoTask>(`${TASKS_PATH}/${taskId}`);
  return data;
}

/** List recent tasks */
export async function listVideoTasks(): Promise<VideoTask[]> {
  const { data } = await apiClient.get<{ data?: VideoTask[] }>(TASKS_PATH);
  return data.data ?? [];
}

/** Cancel / delete a task */
export async function deleteVideoTask(taskId: string): Promise<void> {
  await apiClient.delete(`${TASKS_PATH}/${taskId}`);
}

// ── File Upload ─────────────────────────────────────────────

/** Upload a file via the Files API and return the file object */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', 'user_data');

  const { data } = await apiClient.post<UploadedFile>(FILES_PATH, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000, // allow longer for large files
  });
  return data;
}

/** Check the status of an uploaded file */
export async function getFile(fileId: string): Promise<UploadedFile> {
  const { data } = await apiClient.get<UploadedFile>(`${FILES_PATH}/${fileId}`);
  return data;
}

/**
 * Upload a file and wait until it becomes active.
 * Returns the file ID that can be referenced in generation requests.
 */
export async function uploadFileAndWait(
  file: File,
  maxWaitMs = 30_000,
  intervalMs = 1_000,
): Promise<UploadedFile> {
  const uploaded = await uploadFile(file);

  if (uploaded.status === 'active') return uploaded;

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const current = await getFile(uploaded.id);
    if (current.status === 'active') return current;
    if (current.status === 'error') {
      throw new Error(`File processing failed: ${uploaded.id}`);
    }
  }
  throw new Error(`File processing timed out: ${uploaded.id}`);
}

// ── Task Polling ────────────────────────────────────────────

/**
 * Backoff schedule (3-tier):
 *   - 0–30s since last status change: poll every 3s (catch quick state shifts)
 *   - 30s–5min:                       poll every 10s (typical generation window)
 *   - 5min+:                          poll every 20s (long queue / long task)
 *
 * `elapsedSinceChangeMs` is reset by callers when status changes.
 */
export function nextPollInterval(elapsedSinceChangeMs: number): number {
  if (elapsedSinceChangeMs < 30_000) return 3_000;
  if (elapsedSinceChangeMs < 5 * 60_000) return 10_000;
  return 20_000;
}

export interface PollOptions {
  /** Initial poll interval. Default uses the 3-tier backoff schedule. */
  intervalMs?: number;
  /** Hard cap on total wall-clock time. On timeout, `pollTaskUntilDone`
   *  performs one final getVideoTask() and returns its result rather
   *  than throwing — this lets server-marked `expired` propagate. */
  maxWaitMs?: number;
  onProgress?: (task: VideoTask) => void;
}

/**
 * Poll a task until it reaches a terminal state (succeeded / failed /
 * cancelled / expired) or `maxWaitMs` elapses.
 *
 * On timeout: does ONE final getVideoTask() to surface the latest server
 * state (commonly `expired`) and returns it. Does NOT throw.
 *
 * Polling cadence follows `nextPollInterval`, reset on status change.
 * Pass `intervalMs` to override (used by tests).
 */
export async function pollTaskUntilDone(
  taskId: string,
  opts: PollOptions = {},
): Promise<VideoTask> {
  const { intervalMs, maxWaitMs = 600_000, onProgress } = opts;
  const deadline = Date.now() + maxWaitMs;
  let lastStatus: TaskStatus | null = null;
  let lastChangeMs = Date.now();

  while (Date.now() < deadline) {
    const task = await getVideoTask(taskId);
    onProgress?.(task);

    if (task.status !== lastStatus) {
      lastStatus = task.status;
      lastChangeMs = Date.now();
    }

    if (
      task.status === 'succeeded' ||
      task.status === 'failed' ||
      task.status === 'cancelled' ||
      task.status === 'expired'
    ) {
      return task;
    }

    const wait = intervalMs ?? nextPollInterval(Date.now() - lastChangeMs);
    await new Promise((r) => setTimeout(r, wait));
  }

  // Timeout: do one final sync. Server may have marked expired by now.
  const finalTask = await getVideoTask(taskId);
  onProgress?.(finalTask);
  return finalTask;
}
