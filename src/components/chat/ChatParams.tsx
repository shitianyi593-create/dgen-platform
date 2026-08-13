// src/components/chat/ChatParams.tsx
// 左欄參數面板。空字串 = 不送該參數（用 API 端預設）。分三組：連線 / 取樣 / 推理與輸出。
import { useChatStore } from '../../stores/chatStore'
import { Icon } from '../common/icons'
import type { GenParams, SystemPromptMode } from '../../types/chat'

export const CHAT_PARAMS_DEFAULT_WIDTH = 300

const THINKING_OPTIONS = [
  { value: '', label: '預設（不送）' },
  { value: 'enabled', label: 'enabled — 總是先推理' },
  { value: 'disabled', label: 'disabled — 直接回答' },
  { value: 'auto', label: 'auto — 模型自行判斷' },
] as const

const EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

// lock icon + 文字（handoff §D-2）；可見文字保持「對話進行中鎖定」（測試以 regex 匹配）。
const LOCK_HINT = (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Icon name="lock" size={11} />對話進行中鎖定
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
      {/* ── 連線設定 ── */}
      <GroupTitle>連線設定</GroupTitle>

      {/* fieldset/legend = 程式化 radio 群組（a11y）；視覺為 segmented control */}
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
          {locked ? LOCK_HINT : 'Chat：每輪送完整歷史。Responses：previous_response_id 串多輪'}
        </div>
      </fieldset>

      <Field
        label="系統提示（system prompt）"
        hint={locked ? LOCK_HINT : '對話的第一則 system 訊息（穩定前綴，有利隱性 cache）'}
        htmlFor="chat-system-prompt-input"
        title="將作為對話的第一則 system 訊息（穩定前綴，有利隱性 cache）"
      >
        <textarea
          id="chat-system-prompt-input"
          className="input-field"
          value={systemPrompt}
          disabled={locked}
          rows={4}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="留空 = 不送系統提示"
          style={{ width: '100%', resize: 'vertical' }}
        />
      </Field>

      {apiMode === 'responses' && (
        <Field
          label="系統提示注入方式"
          hint="system message 與 cache 友善；instructions 每輪送出且與 cache 互斥"
          htmlFor="chat-system-prompt-mode-select"
          title="system message 隨伺服器端串接保留；instructions 每輪送出但與 cache 互斥"
        >
          <select
            id="chat-system-prompt-mode-select"
            className="select-field"
            value={systemPromptMode}
            disabled={locked || systemPrompt.trim() === ''}
            onChange={(e) => setSystemPromptMode(e.target.value as SystemPromptMode)}
            style={{ width: '100%' }}
          >
            <option value="system">system message（預設，cache 友善）</option>
            <option value="instructions">instructions 參數（每輪送出；與 cache 互斥，可觀察 cached_tokens 歸零）</option>
          </select>
        </Field>
      )}

      {/* ── 取樣參數 ── */}
      <GroupTitle>取樣參數</GroupTitle>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="temperature" hint="[0, 2]，留空預設 1" htmlFor="chat-temperature-input" title="[0, 2]，留空用預設 1。與 top_p 擇一調整（部分模型鎖定 1）">
          {num('temperature', '預設 1', 'chat-temperature-input')}
        </Field>
        <Field label="top_p" hint="[0, 1]，留空預設 0.7" htmlFor="chat-top-p-input" title="[0, 1]，留空用預設 0.7（部分模型鎖定 0.95）">
          {num('topP', '預設 0.7', 'chat-top-p-input')}
        </Field>
      </div>
      <Field
        label="max tokens"
        hint={apiMode === 'chat' ? '送 max_tokens；留空預設 4096' : '送 max_output_tokens（含思維鏈）；留空用模型預設'}
        htmlFor="chat-max-tokens-input"
        title={apiMode === 'chat' ? '送 max_tokens；留空用預設 4096' : '送 max_output_tokens（含思維鏈）；留空用模型預設（例 32768）'}
      >
        {num('maxTokens', apiMode === 'chat' ? '預設 4096' : '預設依模型', 'chat-max-tokens-input')}
      </Field>

      {/* ── 推理與輸出 ── */}
      <GroupTitle>推理與輸出</GroupTitle>

      <Field label="thinking（深度推理）" hint="預設值依模型而定" htmlFor="chat-thinking-select">
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

      <Field label="reasoning effort" hint="思維鏈長度控制；部分檔位僅特定模型支援" htmlFor="chat-effort-select">
        <select
          id="chat-effort-select"
          className="select-field"
          value={params.reasoningEffort}
          onChange={(e) => setParam('reasoningEffort', e.target.value as GenParams['reasoningEffort'])}
          style={{ width: '100%' }}
        >
          {EFFORT_OPTIONS.map((o) => <option key={o} value={o}>{o === '' ? '預設（不送）' : o}</option>)}
        </select>
      </Field>

      {apiMode === 'chat' && (
        <Field
          label="service_tier（推論模式）"
          hint="僅 Chat API 支援；實際模式顯示於每輪 debug"
          htmlFor="chat-service-tier-select"
          title="僅 Chat API 支援；回應的實際模式顯示於每輪 debug 的 service_tier"
        >
          <select
            id="chat-service-tier-select"
            className="select-field"
            value={params.serviceTier}
            onChange={(e) => setParam('serviceTier', e.target.value as GenParams['serviceTier'])}
            style={{ width: '100%' }}
          >
            <option value="">預設（auto）</option>
            <option value="fast">fast — 低延遲優先</option>
            <option value="auto">auto — TPM 保障優先</option>
            <option value="default">default — 僅一般模式</option>
          </select>
        </Field>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }} title="串流可量測 TTFT；非串流回應一次回來">
        <div>
          <div className="label" style={{ marginBottom: 2 }}>串流輸出</div>
          <div className="hint">串流可量測 TTFT（SSE）</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={params.stream}
          aria-label="串流輸出"
          className={`toggle${params.stream ? ' active' : ''}`}
          onClick={() => setParam('stream', !params.stream)}
        />
      </div>
    </div>
  )
}
