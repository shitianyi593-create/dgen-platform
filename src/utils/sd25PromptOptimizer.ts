// src/utils/sd25PromptOptimizer.ts
// Seedance 2.5 提示词优化器 — system prompt 蒸馏自官方 Seedance 2.5 提示词指南
// （https://docs.volcengine.com/docs/82379/2607689?lang=zh）与官方 sd25-pe skill
// （npx --yes skills@latest add "https://arkdocs.tos-cn-beijing.volces.com/skills/" --skill sd25-pe）。
// 走既有 Chat API（textEndpoint）。纯函数 + 一个薄的呼叫包装，方便单测。
import { chatCompletion, type ChatCompletionRequest } from '../api/chat'
import type { ImageRole, VideoGenMode } from '../types'

export type Sd25TaskType = 't2v' | 'reference' | 'edit' | 'extend' | 'frames' | 'unknown'

export interface Sd25OptimizeContext {
  prompt: string
  mode: VideoGenMode
  /** 依 content 顺序列出的素材：label 已是 @Image1 / @Video1 / @Audio1 形式。 */
  assets: Array<{ label: string; kind: 'image' | 'video' | 'audio'; role?: ImageRole }>
  duration: number
  ratio: string
  generateAudio: boolean
}

export interface Sd25OptimizeResult {
  taskType: Sd25TaskType
  prompt: string
}

export const SD25_SYSTEM_PROMPT = `你是 Seedance 2.5 视频生成提示词优化专家。依据《Seedance 2.5 提示词指南》改写用户的提示词，让生成结果更稳定、更符合意图。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要输出任何其他文字、说明或 Markdown 代码框：
{"taskType":"<t2v|reference|edit|extend|frames>","prompt":"<优化后的提示词>"}

taskType 判定规则：
- edit：要对参考视频做修改（增加、移除、替换、调整画面或声音）
- extend：要把参考视频向前或向后延长、继续
- frames：素材角色含首帧（first_frame）或尾帧（last_frame）
- reference：有参考素材的一般生成
- t2v：纯文字、无任何素材

## 改写规则
1. 保持用户原本的语言：中文输入就输出中文，英文输入就输出英文，其他语言同理。
2. 依公式组织内容：主体 + 动作或事件 +（场景与环境）+（视觉风格）+（运镜或切镜）+（声音）；用不到的部分省略，不硬凑。
3. 有参考素材时，逐份声明职责：「@Image1用于<主体>的<外貌、服装、结构或材质>，不采用<容易误带入的部分>」。只能引用【可用素材】清单中实际存在的标签，一律使用 @Image1 / @Video1 / @Audio1 形式；把 [Image 1] 这类旧写法改写为 @Image1；不要改用 @图片1。清单中没有的素材绝对不能引用或虚构。
4. 声音表达使用特殊符号：() 包音乐、<> 包音效、{} 包台词、【】包字幕；非中文台词前先标明语言（例：台词语言：美式英语）。
5. 总长控制在 500 中文字或 1000 英文词以内。目标视频事件较多或属长视频时（Seedance 2.5 最长支持 30 秒），用「【阶段一】开始时／主要事件／结束时」的结构组织，每阶段只放一个主要变化，并加【保持一致】段固定人物身份、数量、服装、道具歸属与空间方向。
6. 抽象情绪与小众摄影术语改写为可直接观察的表现（眼神、眉头、嘴角、呼吸、手部动作；镜头作用对象与画面变化）。
7. 不要把任何生成参数写进提示词（--rs、--dur、分辨率、比例、时长数值设置都不写）。
8. taskType 判为 reference 或 t2v 时，避免使用「编辑、修改、移除、替换、延长、继续」等会让模型误判任务类型的字眼。
9. taskType 判为 edit 时，写明唯一编辑母版（如 @Video1 是唯一编辑母版）、编辑目标、编辑范围与保持内容；taskType 判为 extend 时，写明延长方向，先描述与原视频边界画面的衔接状态，再描述新内容。
10. 忠于用户原意：优化是补全结构与职责声明，不是改写故事。用户没提的内容不要自行发明。
11. 有素材未被使用时，在提示词中列出「未使用素材」并注明这些标签不得定义人物、场景、道具、动作或声音，避免模型自行带入未指派的素材。
12. 「镜次45」「素材45」「第45章」「步骤45」等编号默认指该编号本身，不是「45度运镜角度」；除非用户明确写出角度或摄影术语，否则不要把编号改写成运镜参数。
13. 用户在原提示词中明确写出的数字时间范围（如「0-5秒」）属于内容本身要保留；不要只因为填了目标时长就自行发明新的数字时间分段。
14. taskType 为 edit 时，除编辑目标与范围外，加一句封閉范围声明（例如：除上述修改对象外，@Video1其余可见人物、道具与背景维持不变、不得替换或移除），避免被误判为重新生成。
15. taskType 为 extend 时，注明主体为同一连续个体，延长片段不可复制、分裂或替换成新个体，并维持与原片边界画面一致的身体结构与数量。
16. taskType 为 frames 时，用独立句子「@Image1是首帧」／「@Image1是尾帧」明确标记，不要弱化成「仅作首帧参考」等说法；标记句之后再另起一句描述该帧的构图、主体位置、姿态与运镜方向。`

/** 把 context 组成 user message。独立成纯函数供测试。 */
export function buildOptimizeRequest(
  ctx: Sd25OptimizeContext,
  textEndpoint: string,
): ChatCompletionRequest {
  const roleNote = (role?: ImageRole): string =>
    role === 'first_frame' ? '（首帧）' : role === 'last_frame' ? '（尾帧）' : ''
  const assetLines = ctx.assets.length === 0
    ? '（无）'
    : ctx.assets.map((a) => `${a.label}${roleNote(a.role)}`).join('、')

  const durationText = ctx.duration === -1 ? 'Auto（模型自选）' : `${ctx.duration} 秒`
  const user = [
    `【生成模式】${ctx.mode}`,
    `【可用素材】${assetLines}`,
    `【长度设置】${durationText}｜【比例】${ctx.ratio}｜【生成音频】${ctx.generateAudio ? '是' : '否'}`,
    '【用户提示词】',
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

/** 解析 LLM 输出。非 JSON / 形状不对 → 整段当 prompt、taskType=unknown（不挡流程）。 */
export function parseOptimizeResult(content: string): Sd25OptimizeResult {
  const trimmed = content.trim()
  // 容忍 ```json ... ``` 代码框
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

/** spec §3 任务类型约束：edit 锁 duration=-1 + ratio=adaptive；extend 只锁 ratio。
 *  其他任务类型不动（frames 的 ratio 由 UI 锁定，不在此处理）。 */
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

/** 修正说明文字（Modal 提示 + 送出 toast 共用）。无修正 → null。 */
export function describeParamFixes(fixes: ParamFixes): string | null {
  const parts: string[] = []
  if (fixes.duration !== undefined) parts.push('长度已自动改为 Auto（此任务类型锁定）')
  if (fixes.ratio !== undefined) parts.push('比例已自动改为 Adaptive（此任务类型锁定）')
  return parts.length > 0 ? parts.join('；') : null
}

/** 呼叫 LLM 执行优化。丢出的错误由呼叫端（Modal 错误态）处理。 */
export async function optimizePrompt(
  ctx: Sd25OptimizeContext,
  textEndpoint: string,
  signal?: AbortSignal,
): Promise<Sd25OptimizeResult> {
  const req = buildOptimizeRequest(ctx, textEndpoint)
  const result = await chatCompletion(req, signal)
  return parseOptimizeResult(result.content)
}
