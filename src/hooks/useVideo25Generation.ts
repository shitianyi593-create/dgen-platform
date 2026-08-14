// Seedance 2.5 生成 hook — copy-fork 自 useVideoGeneration.ts。
// 差异：model = videoEndpoint25 || SEEDANCE_25_MODEL_ID（不要求 2.0 endpoint）、
// 2.5 素材上限、frame 模式 ratio 强制 adaptive、prepare/submit 拆分以承接优化流程。
// TODO(tech-debt): seedanceModels 能力表合并
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useVideo25Store } from '../stores/video25Store';
import { useAuthStore } from '../stores/authStore';
import { createVideoTask } from '../api/video';
import { fileToBase64DataUri } from '../api/fileUtils';
import { computeCompatibility } from '../utils/videoMode';
import { SEEDANCE_25_MODEL_ID } from '../types';
import { useOptionalI18n } from '../i18n/useOptionalI18n';
import type {
  ContentItem,
  ImageUrlContent,
  VideoUrlContent,
  AudioUrlContent,
  CreateVideoTaskRequest,
  LocalMedia,
  AssetRef,
  VideoHistoryItem,
  VideoGenMode,
} from '../types';

/** Seedance 2.5 多模态图片上限（官方 01 文件）。 */
export const SD25_MAX_MULTIMODAL_IMAGES = 30;

export interface PreparedSubmit {
  model: string;
  prompt: string;
  /** 按下生成当下的生成模式。快照的一部分 — 呼叫端（优化流程重试）不得改读 live store，
   *  否则会用新 mode 搭配旧素材快照组出不存在的组合。 */
  mode: VideoGenMode;
  ratioToSend: string;
  duration: number;
  resolution: string;
  watermark: boolean;
  generateAudio: boolean;
  returnLastFrame: boolean;
  seed: number;
  executionExpiresAfter: number;
  imgSnapshot: LocalMedia[];
  vidSnapshot: LocalMedia[];
  audSnapshot: LocalMedia[];
  assetSnapshot: AssetRef[];
}

export interface SubmitOverrides {
  /** 优化流程送出的原始提示词（写入 history.originalPrompt）。 */
  originalPrompt?: string;
  /** 任务类型修正（computeParamFixes）覆盖值。 */
  duration?: number;
  ratio?: string;
}

export function useVideo25Generation() {
  const { t } = useOptionalI18n();
  /** 前置验证 + 参数快照。任何 block 条件以 toast 呈现并返回 null。 */
  const prepare = useCallback((): PreparedSubmit | null => {
    const store = useVideo25Store.getState();
    const {
      prompt, ratio, duration, resolution, watermark, generateAudio,
      returnLastFrame, seed, executionExpiresAfter,
      referenceImages, referenceVideos, referenceAudios, assetRefs, mode,
    } = store;

    const { apiKey, videoEndpoint25 } = useAuthStore.getState();

    if (!apiKey) {
      toast.error(t('video.block.apiKey'));
      return null;
    }
    if (!prompt.trim()) {
      toast.error(t('video.block.prompt'));
      return null;
    }

    const imgSnapshot = [...referenceImages];
    const vidSnapshot = [...referenceVideos];
    const audSnapshot = [...referenceAudios];
    const assetSnapshot = [...assetRefs];

    if ([...imgSnapshot, ...vidSnapshot, ...audSnapshot].some((m) => m.stale)) {
      toast.error(t('video.toast.staleReferences'));
      return null;
    }
    if (vidSnapshot.some((m) => m.uploading) || audSnapshot.some((m) => m.uploading)) {
      toast.error(t('video.toast.referencesUploading'));
      return null;
    }
    if (vidSnapshot.some((m) => !m.uploadedUrl)) {
      toast.error(t('video.toast.videoMissingUrl'));
      return null;
    }
    if (audSnapshot.some((m) => !m.uploadedUrl)) {
      toast.error(t('video.toast.audioMissingUrl'));
      return null;
    }

    const compat = computeCompatibility(
      mode, imgSnapshot, vidSnapshot, audSnapshot, assetSnapshot,
      { maxMultimodalImages: SD25_MAX_MULTIMODAL_IMAGES },
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
      return null;
    }

    // 2.5：首帧 / 首尾帧任务 ratio 锁 adaptive（官方 05 任务类型约束）
    const ratioToSend = mode === 'multimodal' ? ratio : 'adaptive';
    const model = videoEndpoint25.trim() || SEEDANCE_25_MODEL_ID;

    return {
      model, prompt, mode, ratioToSend, duration, resolution, watermark,
      generateAudio, returnLastFrame, seed, executionExpiresAfter,
      imgSnapshot, vidSnapshot, audSnapshot, assetSnapshot,
    };
  }, [t]);

  /** 创建任务。finalPrompt 为实际送出的提示词（可能是优化/编辑后版本）。 */
  const submit = useCallback(async (
    prepared: PreparedSubmit,
    finalPrompt: string,
    overrides: SubmitOverrides = {},
  ): Promise<void> => {
    const requestBody: CreateVideoTaskRequest = {
      model: prepared.model,
      content: [] as ContentItem[],
      ratio: overrides.ratio ?? prepared.ratioToSend,
      duration: overrides.duration ?? prepared.duration,
      resolution: prepared.resolution,
      watermark: prepared.watermark,
      generate_audio: prepared.generateAudio,
      return_last_frame: prepared.returnLastFrame,
      seed: prepared.seed,
      execution_expires_after: prepared.executionExpiresAfter,
    };

    try {
      const contentItems: ContentItem[] = [
        { type: 'text', text: finalPrompt },
      ];

      for (const media of prepared.imgSnapshot) {
        if (!media.file) continue;
        const dataUri = media.uploadedUrl ?? await fileToBase64DataUri(media.file);
        contentItems.push({
          type: 'image_url',
          image_url: { url: dataUri },
          role: media.role ?? 'reference_image',
        } as ImageUrlContent);
      }
      for (const media of prepared.vidSnapshot) {
        if (!media.uploadedUrl) continue;
        contentItems.push({
          type: 'video_url',
          video_url: { url: media.uploadedUrl },
          role: 'reference_video',
        } as VideoUrlContent);
      }
      for (const media of prepared.audSnapshot) {
        if (!media.uploadedUrl) continue;
        contentItems.push({
          type: 'audio_url',
          audio_url: { url: media.uploadedUrl },
          role: 'reference_audio',
        } as AudioUrlContent);
      }
      for (const ref of prepared.assetSnapshot) {
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
            type: 'image_url', image_url: { url: uri },
            role: ref.role ?? 'reference_image',
          } as ImageUrlContent);
        } else if (ref.type === 'video') {
          contentItems.push({
            type: 'video_url', video_url: { url: uri },
            role: 'reference_video',
          } as VideoUrlContent);
        } else if (ref.type === 'audio') {
          contentItems.push({
            type: 'audio_url', audio_url: { url: uri },
            role: 'reference_audio',
          } as AudioUrlContent);
        }
      }

      toast(t('video.toast.submitting'));
      requestBody.content = contentItems;

      const { id: taskId } = await createVideoTask(requestBody);

      const { addActiveTask, setCurrentTask, addHistory } = useVideo25Store.getState();
      addActiveTask(taskId);
      setCurrentTask(taskId);

      const historyItem: VideoHistoryItem = {
        taskId,
        status: 'queued',
        prompt: finalPrompt,
        originalPrompt: overrides.originalPrompt,
        model: prepared.model,
        createdAt: Date.now() / 1000,
        ratio: requestBody.ratio,
        duration: requestBody.duration,
        requestContent: requestBody,
        executionExpiresAfter: prepared.executionExpiresAfter,
      };
      addHistory(historyItem);

      toast.success(t('video.toast.taskCreated', { taskId }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const syntheticTaskId =
        `local-failed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const failedItem: VideoHistoryItem = {
        taskId: syntheticTaskId,
        status: 'failed',
        prompt: finalPrompt,
        originalPrompt: overrides.originalPrompt,
        model: prepared.model,
        createdAt: Date.now() / 1000,
        ratio: requestBody.ratio,
        duration: requestBody.duration,
        requestContent: requestBody,
        executionExpiresAfter: prepared.executionExpiresAfter,
        error: message,
      };
      useVideo25Store.getState().addHistory(failedItem);
      toast.error(t('video.toast.error', { message }));
    }
  }, [t]);

  /** 直送（开关 OFF 或 2.0 同型流程）。 */
  const generate = useCallback(async () => {
    const prepared = prepare();
    if (!prepared) return;
    await submit(prepared, prepared.prompt);
  }, [prepare, submit]);

  return { prepare, submit, generate };
}
