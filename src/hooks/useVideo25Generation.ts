// Seedance 2.5 生成 hook — copy-fork 自 useVideoGeneration.ts。
// 差異：model = videoEndpoint25 || SEEDANCE_25_MODEL_ID（不要求 2.0 endpoint）、
// 2.5 素材上限、frame 模式 ratio 強制 adaptive、prepare/submit 拆分以承接優化流程。
// TODO(tech-debt): seedanceModels 能力表合併
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useVideo25Store } from '../stores/video25Store';
import { useAuthStore } from '../stores/authStore';
import { createVideoTask } from '../api/video';
import { fileToBase64DataUri } from '../api/fileUtils';
import { computeCompatibility } from '../utils/videoMode';
import { SEEDANCE_25_MODEL_ID } from '../types';
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

/** Seedance 2.5 多模態圖片上限（官方 01 文件）。 */
export const SD25_MAX_MULTIMODAL_IMAGES = 30;

export interface PreparedSubmit {
  model: string;
  prompt: string;
  /** 按下生成當下的生成模式。快照的一部分 — 呼叫端（優化流程重試）不得改讀 live store，
   *  否則會用新 mode 搭配舊素材快照組出不存在的組合。 */
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
  /** 優化流程送出的原始提示詞（寫入 history.originalPrompt）。 */
  originalPrompt?: string;
  /** 任務類型修正（computeParamFixes）覆蓋值。 */
  duration?: number;
  ratio?: string;
}

export function useVideo25Generation() {
  /** 前置驗證 + 參數快照。任何 block 條件以 toast 呈現並回傳 null。 */
  const prepare = useCallback((): PreparedSubmit | null => {
    const store = useVideo25Store.getState();
    const {
      prompt, ratio, duration, resolution, watermark, generateAudio,
      returnLastFrame, seed, executionExpiresAfter,
      referenceImages, referenceVideos, referenceAudios, assetRefs, mode,
    } = store;

    const { apiKey, videoEndpoint25 } = useAuthStore.getState();

    if (!apiKey) {
      toast.error('請先輸入 API 金鑰');
      return null;
    }
    if (!prompt.trim()) {
      toast.error('請輸入提示詞');
      return null;
    }

    const imgSnapshot = [...referenceImages];
    const vidSnapshot = [...referenceVideos];
    const audSnapshot = [...referenceAudios];
    const assetSnapshot = [...assetRefs];

    if ([...imgSnapshot, ...vidSnapshot, ...audSnapshot].some((m) => m.stale)) {
      toast.error('部分參考檔案因頁面重整失效，請移除後重新上傳');
      return null;
    }
    if (vidSnapshot.some((m) => m.uploading) || audSnapshot.some((m) => m.uploading)) {
      toast.error('參考影片/音訊仍在上傳中，請稍候');
      return null;
    }
    if (vidSnapshot.some((m) => !m.uploadedUrl)) {
      toast.error('參考影片尚未取得 URL，請重新上傳');
      return null;
    }
    if (audSnapshot.some((m) => !m.uploadedUrl)) {
      toast.error('參考音訊尚未取得 URL，請重新上傳');
      return null;
    }

    const compat = computeCompatibility(
      mode, imgSnapshot, vidSnapshot, audSnapshot, assetSnapshot,
      { maxMultimodalImages: SD25_MAX_MULTIMODAL_IMAGES },
    );
    if (!compat.canGenerate) {
      let reason = '存在與目前模式不相容的項目';
      if (!compat.imageCountOK) reason = '圖片數量與模式不符';
      else if (!compat.roleSetOK) reason = '首尾幀模式需要恰好一張首幀與一張尾幀';
      else if (compat.incompatibleImageIndexes.length) reason = '部分圖片 role 與模式不符';
      else if (compat.incompatibleVideosFlag) reason = '此模式不允許參考影片';
      else if (compat.incompatibleAudiosFlag) reason = '此模式不允許參考音訊';
      else if (compat.incompatibleAssetRefIndexes.length) reason = '部分 asset 參考與模式不符';
      toast.error(reason);
      return null;
    }

    // 2.5：首幀 / 首尾幀任務 ratio 鎖 adaptive（官方 05 任務類型約束）
    const ratioToSend = mode === 'multimodal' ? ratio : 'adaptive';
    const model = videoEndpoint25.trim() || SEEDANCE_25_MODEL_ID;

    return {
      model, prompt, mode, ratioToSend, duration, resolution, watermark,
      generateAudio, returnLastFrame, seed, executionExpiresAfter,
      imgSnapshot, vidSnapshot, audSnapshot, assetSnapshot,
    };
  }, []);

  /** 建立任務。finalPrompt 為實際送出的提示詞（可能是優化/編輯後版本）。 */
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

      toast('正在提交生成任務...');
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

      toast.success(`任務已建立: ${taskId}`);
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
      toast.error(`錯誤: ${message}`);
    }
  }, []);

  /** 直送（開關 OFF 或 2.0 同型流程）。 */
  const generate = useCallback(async () => {
    const prepared = prepare();
    if (!prepared) return;
    await submit(prepared, prepared.prompt);
  }, [prepare, submit]);

  return { prepare, submit, generate };
}
