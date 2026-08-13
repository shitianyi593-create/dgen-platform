import { useEffect, useRef } from 'react';
import { useVideoStore, type VideoStoreHook } from '../stores/videoStore';
import { useVideo25Store } from '../stores/video25Store';
import { useAuthStore } from '../stores/authStore';
import { getVideoTask, nextPollInterval } from '../api/video';
import type { TaskStatus, VideoTask, VideoHistoryItem } from '../types';

const TERMINAL: TaskStatus[] = ['succeeded', 'failed', 'cancelled', 'expired'];
const AUTH_PAUSE_MS = 5_000;
const TRANSIENT_ERROR_BACKOFF_MS = 10_000;

/**
 * App-level hook. Mount ONCE (in App.tsx). Watches `activeTaskIds` in both
 * the Seedance 2.0 store and the 2.5 store, and runs an independent polling
 * loop for each taskId regardless of which store it came from.
 *
 * Per-task loop:
 *   - If no apiKey in authStore → sleep AUTH_PAUSE_MS, retry (does NOT
 *     remove the task; user may reset their key and want polling to resume).
 *   - On 401/403 → mark history item orphaned, remove from activeTaskIds,
 *     stop loop. The task was created with different creds.
 *   - On transient network error → sleep TRANSIENT_ERROR_BACKOFF_MS, retry.
 *   - On terminal status (succeeded/failed/cancelled/expired) → write final
 *     fields to history, remove from activeTaskIds, stop loop.
 *   - Otherwise → sleep nextPollInterval(elapsedSinceLastChange), poll again.
 *
 * Dedupe: a Set ref tracks taskIds with active loops. Effect re-runs add new
 * ids without restarting existing loops.
 */
export function useBackgroundPoller(): void {
  const activeTaskIds = useVideoStore((s) => s.activeTaskIds);
  const activeTaskIds25 = useVideo25Store((s) => s.activeTaskIds);
  const polling = useRef<Set<string>>(new Set());

  // MUST mount once at app root — this hook has no cleanup and assumes
  // its lifetime equals the app's. Moving to a route component would
  // leak loops on navigation.
  useEffect(() => {
    spawnLoops(activeTaskIds, useVideoStore, polling.current);
  }, [activeTaskIds]);

  // Seedance 2.5 page store — same loop, different store. taskIds are
  // globally unique (ARK cgt-…), so one dedupe set covers both.
  useEffect(() => {
    spawnLoops(activeTaskIds25, useVideo25Store, polling.current);
  }, [activeTaskIds25]);
}

function spawnLoops(taskIds: string[], useStore: VideoStoreHook, polling: Set<string>): void {
  for (const taskId of taskIds) {
    if (polling.has(taskId)) continue;
    polling.add(taskId);
    void runPolling(taskId, useStore).finally(() => {
      polling.delete(taskId);
    });
  }
}

async function runPolling(taskId: string, useStore: VideoStoreHook): Promise<void> {
  let lastStatus: TaskStatus | null = null;
  let lastChangeMs = Date.now();

  while (true) {
    const apiKey = useAuthStore.getState().apiKey;
    if (!apiKey) {
      await sleep(AUTH_PAUSE_MS);
      continue;
    }

    let task: VideoTask | undefined;
    try {
      task = await getVideoTask(taskId);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        const { updateHistory, removeActiveTask } = useStore.getState();
        updateHistory(taskId, { orphaned: true });
        removeActiveTask(taskId);
        return;
      }
      // Transient — back off and retry.
      await sleep(TRANSIENT_ERROR_BACKOFF_MS);
      continue;
    }

    if (!task) {
      await sleep(TRANSIENT_ERROR_BACKOFF_MS);
      continue;
    }

    // Cancellation race: if the task was removed from activeTaskIds while
    // we were awaiting getVideoTask (e.g. user cancelled via T11 UI), bail
    // out before writing stale history or scheduling the next poll.
    if (!useStore.getState().activeTaskIds.includes(taskId)) {
      return;
    }

    if (task.status !== lastStatus) {
      lastStatus = task.status;
      lastChangeMs = Date.now();
    }

    const { updateHistory, removeActiveTask } = useStore.getState();
    updateHistory(taskId, buildHistoryPatch(task));

    if (TERMINAL.includes(task.status)) {
      removeActiveTask(taskId);
      return;
    }

    await sleep(nextPollInterval(Date.now() - lastChangeMs));
  }
}

function buildHistoryPatch(task: VideoTask): Partial<VideoHistoryItem> {
  const patch: Partial<VideoHistoryItem> = { status: task.status };
  if (task.updated_at) {
    patch.updatedAt = task.updated_at;
  }
  if (task.status === 'succeeded' && task.content?.video_url) {
    patch.videoUrl = task.content.video_url;
    patch.lastFrameUrl = task.content.last_frame_url;
    patch.seed = task.seed;
    patch.resolution = task.resolution;
    patch.fps = task.framespersecond;
  }
  if (task.status === 'failed') {
    patch.error = task.error?.message ?? '未知錯誤';
  }
  return patch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
