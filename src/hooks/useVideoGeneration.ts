import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useVideoStore } from '../stores/videoStore';
import { useAuthStore } from '../stores/authStore';
import { createVideoTask } from '../api/video';
import { fileToBase64DataUri } from '../api/fileUtils';
import { computeCompatibility } from '../utils/videoMode';
import { useOptionalI18n } from '../i18n/useOptionalI18n';
import type {
  ContentItem,
  ImageUrlContent,
  VideoUrlContent,
  AudioUrlContent,
  VideoHistoryItem,
} from '../types';

/**
 * Hook that encapsulates the full video generation flow.
 * Supports concurrent tasks — each generate() call runs independently
 * without blocking subsequent submissions.
 */
export function useVideoGeneration() {
  const { t } = useOptionalI18n();
  const generate = useCallback(async () => {
    const store = useVideoStore.getState();
    const {
      prompt,
      ratio,
      duration,
      resolution,
      watermark,
      generateAudio,
      returnLastFrame,
      seed,
      executionExpiresAfter,
      referenceImages,
      referenceVideos,
      referenceAudios,
      assetRefs,
      mode,
    } = store;

    const { apiKey, endpoint: ep } = useAuthStore.getState();

    if (!apiKey) {
      toast.error(t('video.block.apiKey'));
      return;
    }
    if (!ep) {
      toast.error(t('video.block.endpoint'));
      return;
    }
    if (!prompt.trim()) {
      toast.error(t('video.block.prompt'));
      return;
    }

    // Snapshot media references before async work (user might change them)
    const imgSnapshot = [...referenceImages];
    const vidSnapshot = [...referenceVideos];
    const audSnapshot = [...referenceAudios];
    const assetSnapshot = [...assetRefs];

    // Refs rehydrated from sessionStorage have no File object — block
    // submission until the user removes + re-attaches.
    if ([...imgSnapshot, ...vidSnapshot, ...audSnapshot].some((m) => m.stale)) {
      toast.error(t('video.toast.staleReferences'));
      return;
    }

    // Seedance only accepts public URLs for reference video/audio (not base64),
    // so we must already have the TOS pre-signed URL by the time the user
    // clicks generate. Block with a clear message instead of silently sending
    // base64 (which the API would reject anyway).
    if (vidSnapshot.some((m) => m.uploading) || audSnapshot.some((m) => m.uploading)) {
      toast.error(t('video.toast.referencesUploading'));
      return;
    }
    if (vidSnapshot.some((m) => !m.uploadedUrl)) {
      toast.error(t('video.toast.videoMissingUrl'));
      return;
    }
    if (audSnapshot.some((m) => !m.uploadedUrl)) {
      toast.error(t('video.toast.audioMissingUrl'));
      return;
    }

    // Mode-mutex guard: refuse submissions whose media composition violates
    // the active generation mode (e.g. wrong image count, mis-roled images,
    // or non-image refs in a frame-only mode). Computed from the snapshots
    // so it stays in sync with what's about to be sent.
    const compat = computeCompatibility(
      mode,
      imgSnapshot,
      vidSnapshot,
      audSnapshot,
      assetSnapshot,
    );
    if (!compat.canGenerate) {
      let reason = t('video.block.incompatible');
      if (!compat.imageCountOK) reason = t('video.block.imageCount');
      else if (!compat.roleSetOK) reason = t('video.block.roleSet');
      else if (compat.incompatibleImageIndexes.length) reason = t('video.block.imageRole');
      else if (compat.incompatibleVideosFlag) reason = t('video.block.videoNotAllowed');
      else if (compat.incompatibleAudiosFlag) reason = t('video.block.audioNotAllowed');
      else if (compat.incompatibleAssetRefIndexes.length) reason = t('video.block.assetRef');
      toast.error(reason);
      return;
    }

    const requestBody = {
      model: ep,
      content: [] as ContentItem[],
      ratio,
      duration,
      resolution,
      watermark,
      generate_audio: generateAudio,
      return_last_frame: returnLastFrame,
      seed,
      execution_expires_after: executionExpiresAfter,
    };

    try {
      // ── Step 1: Build content array with base64 media ──
      const contentItems: ContentItem[] = [
        { type: 'text', text: prompt },
      ];

      // Convert images to base64
      for (const media of imgSnapshot) {
        if (!media.file) continue;
        const dataUri = media.uploadedUrl ?? await fileToBase64DataUri(media.file);
        contentItems.push({
          type: 'image_url',
          image_url: { url: dataUri },
          role: media.role ?? 'reference_image',
        } as ImageUrlContent);
      }

      // Reference videos — always use the pre-signed TOS URL (no base64 fallback)
      for (const media of vidSnapshot) {
        if (!media.uploadedUrl) continue; // already guarded above; defensive
        contentItems.push({
          type: 'video_url',
          video_url: { url: media.uploadedUrl },
          role: 'reference_video',
        } as VideoUrlContent);
      }

      // Reference audios — same: always use the pre-signed TOS URL
      for (const media of audSnapshot) {
        if (!media.uploadedUrl) continue;
        contentItems.push({
          type: 'audio_url',
          audio_url: { url: media.uploadedUrl },
          role: 'reference_audio',
        } as AudioUrlContent);
      }

      // Add asset:// references — type determines image_url / video_url / audio_url.
      // The input field also accepts a plain http(s) URL (e.g. a previously
      // generated `last_frame_url` or `video_url` for chaining a follow-up
      // task); in that case it's passed through unchanged. Otherwise the
      // string is treated as an asset ID and prefixed with `asset://`.
      for (const ref of assetSnapshot) {
        const trimmed = ref.id.trim();
        if (!trimmed) continue;
        let uri: string;
        if (/^https?:\/\//i.test(trimmed)) {
          uri = trimmed;
        } else if (trimmed.startsWith('asset://')) {
          uri = trimmed;
        } else {
          uri = `asset://${trimmed}`;
        }

        if (ref.type === 'image') {
          contentItems.push({
            type: 'image_url',
            image_url: { url: uri },
            role: ref.role ?? 'reference_image',
          } as ImageUrlContent);
        } else if (ref.type === 'video') {
          contentItems.push({
            type: 'video_url',
            video_url: { url: uri },
            role: 'reference_video',
          } as VideoUrlContent);
        } else if (ref.type === 'audio') {
          contentItems.push({
            type: 'audio_url',
            audio_url: { url: uri },
            role: 'reference_audio',
          } as AudioUrlContent);
        }
      }

      // ── Step 2: Create task ──
      toast(t('video.toast.submitting'));

      requestBody.content = contentItems;

      const { id: taskId } = await createVideoTask(requestBody);

      // Register this task as active and write a queued history entry.
      // Polling is owned by useBackgroundPoller (mounted at App level),
      // so we DON'T await here — generate() resolves as soon as the task
      // is registered.
      const { addActiveTask, setCurrentTask, addHistory } = useVideoStore.getState();
      addActiveTask(taskId);
      setCurrentTask(taskId);

      const historyItem: VideoHistoryItem = {
        taskId,
        status: 'queued',
        prompt,
        createdAt: Date.now() / 1000,
        ratio,
        duration,
        requestContent: requestBody,
        executionExpiresAfter,
      };
      addHistory(historyItem);

      toast.success(t('video.toast.taskCreated', { taskId }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Synthetic taskId. Mimics ARK's `cgt-YYYYMMDDhhmmss-xxxxx` shape so
      // existing UI heuristics that key off taskId don't choke, but the
      // `local-failed-` prefix makes it obvious this never reached the server.
      const syntheticTaskId =
        `local-failed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const failedItem: VideoHistoryItem = {
        taskId: syntheticTaskId,
        status: 'failed',
        prompt,
        createdAt: Date.now() / 1000,
        ratio,
        duration,
        requestContent: requestBody,
        executionExpiresAfter,
        error: message,
      };
      useVideoStore.getState().addHistory(failedItem);
      toast.error(t('video.toast.error', { message }));
    }
  }, [t]);

  return { generate };
}
