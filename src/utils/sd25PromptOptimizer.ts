// src/utils/sd25PromptOptimizer.ts
// Seedance 2.5 提示詞優化器 — system prompt 蒸餾自官方 Seedance 2.5 提示詞指南
// （https://docs.volcengine.com/docs/82379/2607689?lang=zh）與官方 sd25-pe skill
// （npx --yes skills@latest add "https://arkdocs.tos-cn-beijing.volces.com/skills/" --skill sd25-pe）。
// 走既有 Chat API（textEndpoint）。純函式 + 一個薄的呼叫包裝，方便單測。
import { chatCompletion, type ChatCompletionRequest } from '../api/chat'
import type { ImageRole, VideoGenMode } from '../types'

export type Sd25TaskType = 't2v' | 'reference' | 'edit' | 'extend' | 'frames' | 'unknown'

export interface Sd25OptimizeContext {
  prompt: string
  mode: VideoGenMode
  /** 依 content 順序列出的素材：label 已是 @Image1 / @Video1 / @Audio1 形式。 */
  assets: Array<{ label: string; kind: 'image' | 'video' | 'audio'; role?: ImageRole }>
  duration: number
  ratio: string
  generateAudio: boolean
}

export interface Sd25OptimizeResult {
  taskType: Sd25TaskType
  prompt: string
}

export const SD25_SYSTEM_PROMPT = `你是 Seedance 2.5 影片生成提示詞優化專家。依據《Seedance 2.5 提示詞指南》改寫使用者的提示詞，讓生成結果更穩定、更符合意圖。

## 輸出格式（嚴格遵守）
只輸出一個 JSON 物件，不要輸出任何其他文字、說明或 Markdown 代碼框：
{"taskType":"<t2v|reference|edit|extend|frames>","prompt":"<優化後的提示詞>"}

taskType 判定規則：
- edit：要對參考影片做修改（增加、移除、替換、調整畫面或聲音）
- extend：要把參考影片向前或向後延長、繼續
- frames：素材角色含首幀（first_frame）或尾幀（last_frame）
- reference：有參考素材的一般生成
- t2v：純文字、無任何素材

## 改寫規則
1. 保持使用者原本的語言：中文輸入就輸出中文，英文輸入就輸出英文，其他語言同理。
2. 依公式組織內容：主體 + 動作或事件 +（場景與環境）+（視覺風格）+（運鏡或切鏡）+（聲音）；用不到的部分省略，不硬湊。
3. 有參考素材時，逐份聲明職責：「@Image1用於<主體>的<外貌、服裝、結構或材質>，不採用<容易誤帶入的部分>」。只能引用【可用素材】清單中實際存在的標籤，一律使用 @Image1 / @Video1 / @Audio1 形式；把 [Image 1] 這類舊寫法改寫為 @Image1；不要改用 @图片1。清單中沒有的素材絕對不能引用或虛構。
4. 聲音表達使用特殊符號：() 包音樂、<> 包音效、{} 包台詞、【】包字幕；非中文台詞前先標明語言（例：台詞語言：美式英語）。
5. 總長控制在 500 中文字或 1000 英文詞以內。目標影片事件較多或屬長視頻時（Seedance 2.5 最長支援 30 秒），用「【階段一】開始時／主要事件／結束時」的結構組織，每階段只放一個主要變化，並加【保持一致】段固定人物身份、數量、服裝、道具歸屬與空間方向。
6. 抽象情緒與小眾攝影術語改寫為可直接觀察的表現（眼神、眉頭、嘴角、呼吸、手部動作；鏡頭作用對象與畫面變化）。
7. 不要把任何生成參數寫進提示詞（--rs、--dur、解析度、比例、時長數值設定都不寫）。
8. taskType 判為 reference 或 t2v 時，避免使用「編輯、修改、移除、替換、延長、繼續」等會讓模型誤判任務類型的字眼。
9. taskType 判為 edit 時，寫明唯一編輯母版（如 @Video1 是唯一編輯母版）、編輯目標、編輯範圍與保持內容；taskType 判為 extend 時，寫明延長方向，先描述與原影片邊界畫面的銜接狀態，再描述新內容。
10. 忠於使用者原意：優化是補全結構與職責聲明，不是改寫故事。使用者沒提的內容不要自行發明。
11. 有素材未被使用時，在提示詞中列出「未使用素材」並註明這些標籤不得定義人物、場景、道具、動作或聲音，避免模型自行帶入未指派的素材。
12. 「鏡次45」「素材45」「第45章」「步驟45」等編號預設指該編號本身，不是「45度運鏡角度」；除非使用者明確寫出角度或攝影術語，否則不要把編號改寫成運鏡參數。
13. 使用者在原提示詞中明確寫出的數字時間範圍（如「0-5秒」）屬於內容本身要保留；不要只因為填了目標時長就自行發明新的數字時間分段。
14. taskType 為 edit 時，除編輯目標與範圍外，加一句封閉範圍聲明（例如：除上述修改對象外，@Video1其餘可見人物、道具與背景維持不變、不得替換或移除），避免被誤判為重新生成。
15. taskType 為 extend 時，註明主體為同一連續個體，延長片段不可複製、分裂或替換成新個體，並維持與原片邊界畫面一致的身體結構與數量。
16. taskType 為 frames 時，用獨立句子「@Image1是首幀」／「@Image1是尾幀」明確標記，不要弱化成「僅作首幀參考」等說法；標記句之後再另起一句描述該幀的構圖、主體位置、姿態與運鏡方向。`

/** 把 context 組成 user message。獨立成純函式供測試。 */
export function buildOptimizeRequest(
  ctx: Sd25OptimizeContext,
  textEndpoint: string,
): ChatCompletionRequest {
  const roleNote = (role?: ImageRole): string =>
    role === 'first_frame' ? '（首幀）' : role === 'last_frame' ? '（尾幀）' : ''
  const assetLines = ctx.assets.length === 0
    ? '（無）'
    : ctx.assets.map((a) => `${a.label}${roleNote(a.role)}`).join('、')

  const durationText = ctx.duration === -1 ? 'Auto（模型自選）' : `${ctx.duration} 秒`
  const user = [
    `【生成模式】${ctx.mode}`,
    `【可用素材】${assetLines}`,
    `【長度設定】${durationText}｜【比例】${ctx.ratio}｜【生成音訊】${ctx.generateAudio ? '是' : '否'}`,
    '【使用者提示詞】',
    ctx.prompt,
  ].join('\n')

  return {
    model: textEndpoint,
    stream: false,
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: SD25_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
  }
}

const TASK_TYPES: readonly Sd25TaskType[] = ['t2v', 'reference', 'edit', 'extend', 'frames']

/** 解析 LLM 輸出。非 JSON / 形狀不對 → 整段當 prompt、taskType=unknown（不擋流程）。 */
export function parseOptimizeResult(content: string): Sd25OptimizeResult {
  const trimmed = content.trim()
  // 容忍 ```json ... ``` 代碼框
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = fenced ? fenced[1] : trimmed
  try {
    const obj = JSON.parse(candidate) as { taskType?: unknown; prompt?: unknown }
    if (typeof obj.prompt === 'string' && obj.prompt.trim() !== '') {
      const taskType = TASK_TYPES.includes(obj.taskType as Sd25TaskType)
        ? (obj.taskType as Sd25TaskType)
        : 'unknown'
      return { taskType, prompt: obj.prompt }
    }
  } catch {
    // fallthrough to fallback
  }
  return { taskType: 'unknown', prompt: trimmed }
}

export interface ParamFixes {
  duration?: number
  ratio?: string
}

/** spec §3 任務類型約束：edit 鎖 duration=-1 + ratio=adaptive；extend 只鎖 ratio。
 *  其他任務類型不動（frames 的 ratio 由 UI 鎖定，不在此處理）。 */
export function computeParamFixes(
  taskType: Sd25TaskType,
  current: { duration: number; ratio: string },
): ParamFixes {
  const fixes: ParamFixes = {}
  if (taskType === 'edit') {
    if (current.duration !== -1) fixes.duration = -1
    if (current.ratio !== 'adaptive') fixes.ratio = 'adaptive'
  } else if (taskType === 'extend') {
    if (current.ratio !== 'adaptive') fixes.ratio = 'adaptive'
  }
  return fixes
}

/** 修正說明文字（Modal 提示 + 送出 toast 共用）。無修正 → null。 */
export function describeParamFixes(fixes: ParamFixes): string | null {
  const parts: string[] = []
  if (fixes.duration !== undefined) parts.push('長度已自動改為 Auto（此任務類型鎖定）')
  if (fixes.ratio !== undefined) parts.push('比例已自動改為 Adaptive（此任務類型鎖定）')
  return parts.length > 0 ? parts.join('；') : null
}

/** 呼叫 LLM 執行優化。丟出的錯誤由呼叫端（Modal 錯誤態）處理。 */
export async function optimizePrompt(
  ctx: Sd25OptimizeContext,
  textEndpoint: string,
  signal?: AbortSignal,
): Promise<Sd25OptimizeResult> {
  const req = buildOptimizeRequest(ctx, textEndpoint)
  const result = await chatCompletion(req, signal)
  return parseOptimizeResult(result.content)
}
