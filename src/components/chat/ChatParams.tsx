// src/components/chat/ChatParams.tsx
// 左栏参数面板。空字符串 = 不送该参数（用 API 端默认）。分三组：连接 / 采样 / 推理与输出。
import { useChatStore } from '../../stores/chatStore'
import { Icon } from '../common/icons'
import type { GenParams, SystemPromptMode } from '../../types/chat'

export const CHAT_PARAMS_DEFAULT_WIDTH = 300

const THINKING_OPTIONS = [
  { value: '', label: '默认（不送）' },
  { value: 'enabled', label: 'enabled — 总是先推理' },
  { value: 'disabled', label: 'disabled — 直接回答' },
  { value: 'auto', label: 'auto — 模型自行判断' },
] as const

const EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

// lock icon + 文字（handoff §D-2）；可见文字保持「对话进行中锁定」（测试以 regex 匹配）。
const LOCK_HINT = (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Icon name="lock" size={11} />对话进行中锁定
  </span>
)

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
      margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  )
}

function Field({ label, hint, htmlFor, title, children }: {
  label: string
  hint?: React.ReactNode
  htmlFor?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="label" htmlFor={htmlFor} title={title} style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div className="hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export default function ChatParams({ width }: { width: number }) {
  const apiMode = useChatStore((s) => s.apiMode)
  const setApiMode = useChatStore((s) => s.setApiMode)
  const params = useChatStore((s) => s.params)
  const setParam = useChatStore((s) => s.setParam)
  const systemPrompt = useChatStore((s) => s.systemPrompt)
  const setSystemPrompt = useChatStore((s) => s.setSystemPrompt)
  const systemPromptMode = useChatStore((s) => s.systemPromptMode)
  const setSystemPromptMode = useChatStore((s) => s.setSystemPromptMode)
  const locked = useChatStore((s) => s.turns.length > 0)

  const num = (key: 'temperature' | 'topP' | 'maxTokens', placeholder: string, id: string) => (
    <input
      id={id}
      className="input-field"
      inputMode="decimal"
      value={params[key]}
      placeholder={placeholder}
      onChange={(e) => setParam(key, e.target.value)}
      style={{ width: '100%' }}
    />
  )

  return (
    <div style={{
      width, flexShrink: 0, overflowY: 'auto', padding: 16,
      borderRight: '1px solid var(--border)', background: 'var(--bg-secondary)',
    }}>
      {/* ── 连接设置 ── */}
      <GroupTitle>连接设置</GroupTitle>

      {/* fieldset/legend = 程式化 radio 群组（a11y）；视觉为 segmented control */}
      <fieldset style={{ border: 'none', margin: '0 0 14px', padding: 0, minWidth: 0 }}>
        <legend className="label" style={{ display: 'block', padding: 0, marginBottom: 4 }}>API 模式</legend>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-input)', borderRadius: 8, padding: 3 }}>
          {([
            { value: 'chat', label: 'Chat API（/chat/completions）', short: 'Chat API' },
            { value: 'responses', label: 'Responses API（/responses）', short: 'Responses API' },
          ] as const).map((opt) => {
            const selected = apiMode === opt.value
            return (
              <label
                key={opt.value}
                className="segmented-option"
                style={{
                  flex: 1, textAlign: 'center', fontSize: 12, padding: '6px 8px', borderRadius: 6,
                  cursor: locked ? 'not-allowed' : 'pointer',
                  background: selected ? 'var(--border)' : 'transparent',
                  color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  opacity: locked ? 0.6 : 1, transition: 'background 0.15s, color 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="apiMode"
                  value={opt.value}
                  checked={selected}
                  disabled={locked}
                  onChange={() => setApiMode(opt.value)}
                  aria-label={opt.label}
                  className="sr-only"
                />
                {opt.short}
              </label>
            )
          })}
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          {locked ? LOCK_HINT : 'Chat：每轮送完整历史。Responses：previous_response_id 串多轮'}
        </div>
      </fieldset>

      <Field
        label="系统提示（system prompt）"
        hint={locked ? LOCK_HINT : '对话的第一则 system 消息（稳定前缀，有利隐性 cache）'}
        htmlFor="chat-system-prompt-input"
        title="将作为对话的第一则 system 消息（稳定前缀，有利隐性 cache）"
      >
        <textarea
          id="chat-system-prompt-input"
          className="input-field"
          value={systemPrompt}
          disabled={locked}
          rows={4}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="留空 = 不送系统提示"
          style={{ width: '100%', resize: 'vertical' }}
        />
      </Field>

      {apiMode === 'responses' && (
        <Field
          label="系统提示注入方式"
          hint="system message 与 cache 友好；instructions 每轮送出且与 cache 互斥"
          htmlFor="chat-system-prompt-mode-select"
          title="system message 随服务器端串接保留；instructions 每轮送出但与 cache 互斥"
        >
          <select
            id="chat-system-prompt-mode-select"
            className="select-field"
            value={systemPromptMode}
            disabled={locked || systemPrompt.trim() === ''}
            onChange={(e) => setSystemPromptMode(e.target.value as SystemPromptMode)}
            style={{ width: '100%' }}
          >
            <option value="system">system message（默认，cache 友好）</option>
            <option value="instructions">instructions 参数（每轮送出；与 cache 互斥，可观察 cached_tokens 归零）</option>
          </select>
        </Field>
      )}

      {/* ── 采样参数 ── */}
      <GroupTitle>采样参数</GroupTitle>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="temperature" hint="[0, 2]，留空默认 1" htmlFor="chat-temperature-input" title="[0, 2]，留空用默认 1。与 top_p 择一调整（部分模型锁定 1）">
          {num('temperature', '默认 1', 'chat-temperature-input')}
        </Field>
        <Field label="top_p" hint="[0, 1]，留空默认 0.7" htmlFor="chat-top-p-input" title="[0, 1]，留空用默认 0.7（部分模型锁定 0.95）">
          {num('topP', '默认 0.7', 'chat-top-p-input')}
        </Field>
      </div>
      <Field
        label="max tokens"
        hint={apiMode === 'chat' ? '送 max_tokens；留空默认 4096' : '送 max_output_tokens（含思维链）；留空用模型默认'}
        htmlFor="chat-max-tokens-input"
        title={apiMode === 'chat' ? '送 max_tokens；留空用默认 4096' : '送 max_output_tokens（含思维链）；留空用模型默认（例 32768）'}
      >
        {num('maxTokens', apiMode === 'chat' ? '默认 4096' : '默认依模型', 'chat-max-tokens-input')}
      </Field>

      {/* ── 推理与输出 ── */}
      <GroupTitle>推理与输出</GroupTitle>

      <Field label="thinking（深度推理）" hint="默认值依模型而定" htmlFor="chat-thinking-select">
        <select
          id="chat-thinking-select"
          className="select-field"
          value={params.thinkingType}
          onChange={(e) => setParam('thinkingType', e.target.value as GenParams['thinkingType'])}
          style={{ width: '100%' }}
        >
          {THINKING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="reasoning effort" hint="思维链长度控制；部分档位仅特定模型支持" htmlFor="chat-effort-select">
        <select
          id="chat-effort-select"
          className="select-field"
          value={params.reasoningEffort}
          onChange={(e) => setParam('reasoningEffort', e.target.value as GenParams['reasoningEffort'])}
          style={{ width: '100%' }}
        >
          {EFFORT_OPTIONS.map((o) => <option key={o} value={o}>{o === '' ? '默认（不送）' : o}</option>)}
        </select>
      </Field>

      {apiMode === 'chat' && (
        <Field
          label="service_tier（推理模式）"
          hint="仅 Chat API 支持；实际模式显示于每轮 debug"
          htmlFor="chat-service-tier-select"
          title="仅 Chat API 支持；响应的实际模式显示于每轮 debug 的 service_tier"
        >
          <select
            id="chat-service-tier-select"
            className="select-field"
            value={params.serviceTier}
            onChange={(e) => setParam('serviceTier', e.target.value as GenParams['serviceTier'])}
            style={{ width: '100%' }}
          >
            <option value="">默认（auto）</option>
            <option value="fast">fast — 低延迟优先</option>
            <option value="auto">auto — TPM 保障优先</option>
            <option value="default">default — 仅一般模式</option>
          </select>
        </Field>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }} title="流式可测量 TTFT；非流式响应一次回来">
        <div>
          <div className="label" style={{ marginBottom: 2 }}>流式输出</div>
          <div className="hint">流式可测量 TTFT（SSE）</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={params.stream}
          aria-label="流式输出"
          className={`toggle${params.stream ? ' active' : ''}`}
          onClick={() => setParam('stream', !params.stream)}
        />
      </div>
    </div>
  )
}
