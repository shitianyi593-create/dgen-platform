// src/components/chat/TurnDebugPanel.tsx
// 展开后的完整 debug 面板：Token / 延迟（两栏）/ Metadata / 服务器端动作 / Raw。
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { copyWithToast } from '../../utils/clipboard'
import type { ChatTurn } from '../../types/chat'
import { retrieveResponse, retrieveResponseContext, deleteResponse } from '../../api/responses'
import ConfirmModal from '../common/ConfirmModal'

const IMPLICIT_CACHE_MIN_TOKENS = 1024

const actionBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-primary)', fontSize: 12, padding: '4px 10px', cursor: 'pointer',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function KV({ k, v, copyable, mono }: { k: string; v: React.ReactNode; copyable?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, lineHeight: 1.7, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{k}</span>
      <span style={{
        color: 'var(--text-primary)', textAlign: 'right', wordBreak: 'break-all',
        fontVariantNumeric: 'tabular-nums', display: 'inline-flex', gap: 6, alignItems: 'baseline',
        ...(mono ? { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 11 } : null),
      }}>
        {v ?? '—'}
        {copyable && (
          <button
            onClick={() => void copyWithToast(k, copyable)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11, padding: 0 }}
            aria-label={`复制 ${k}`}
          >
            复制
          </button>
        )}
      </span>
    </div>
  )
}

function RawBlock({ title, value }: { title: string; value: unknown }) {
  const json = useMemo(() => (typeof value === 'string' ? value : JSON.stringify(value, null, 2)), [value])
  return (
    <details style={{ marginBottom: 10 }}>
      <summary style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', cursor: 'pointer', marginBottom: 4 }}>
        {title}
      </summary>
      <div style={{ marginTop: 6 }}>
        <button
          onClick={() => void copyWithToast(title, json)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, padding: 0, marginBottom: 4 }}
        >
          复制 JSON
        </button>
        <pre style={{
          margin: 0, padding: 8, background: 'var(--bg-primary)', borderRadius: 6,
          fontSize: 11, lineHeight: 1.5, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {json}
        </pre>
      </div>
    </details>
  )
}

/** 服务器端动作：取回上下文 / 查看 response / 删除（仅 responses 模式且有 responseId）。 */
function ServerActions({ responseId }: { responseId: string }) {
  const [busy, setBusy] = useState<null | 'context' | 'response' | 'delete'>(null)
  const [result, setResult] = useState<{ title: string; value: unknown } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // 删除成功后锁定全部动作：服务器端对象已不存在，再查询必然失败。
  const [deleted, setDeleted] = useState(false)
  // 全域忙碌锁：同时只允许一个进行中的动作，避免并发响应競写 result。
  const locked = busy !== null || deleted

  const run = async (
    kind: 'context' | 'response',
    fn: (id: string) => Promise<unknown>,
    title: string,
  ) => {
    setBusy(kind)
    try {
      const data = await fn(responseId)
      setResult({ title, value: data })
    } catch (e) {
      const err = e as Error & { body?: unknown }
      setResult({ title: '动作失败', value: err.body ?? err.message ?? String(e) })
    } finally {
      setBusy(null)
    }
  }

  const confirmDelete = async () => {
    setConfirmOpen(false)
    setBusy('delete')
    try {
      const data = await deleteResponse(responseId)
      setResult({ title: '删除结果', value: data })
      if (data.deleted) {
        setDeleted(true)
        toast.success('已删除服务器端 response')
      }
    } catch (e) {
      const err = e as Error & { body?: unknown }
      setResult({ title: '动作失败', value: err.body ?? err.message ?? String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="服务器端动作">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: result ? 8 : 0 }}>
        <button
          style={{ ...actionBtnStyle, opacity: locked ? 0.5 : 1 }}
          disabled={locked}
          onClick={() => void run('context', retrieveResponseContext, '服务器上下文（input_items）')}
        >
          查看服务器上下文
        </button>
        <button
          style={{ ...actionBtnStyle, opacity: locked ? 0.5 : 1 }}
          disabled={locked}
          onClick={() => void run('response', retrieveResponse, '服务器端 response')}
        >
          查看 response
        </button>
        <button
          style={{ ...actionBtnStyle, color: 'var(--danger)', borderColor: 'var(--danger)', opacity: locked ? 0.5 : 1 }}
          disabled={locked}
          onClick={() => setConfirmOpen(true)}
        >
          删除 response
        </button>
      </div>
      {result && <RawBlock title={result.title} value={result.value} />}
      <ConfirmModal
        open={confirmOpen}
        title="删除服务器端 response？"
        subtitle="此操作无法恢复。之后以 previous_response_id 串接此 id 的请求将失败。"
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </Section>
  )
}

export default function TurnDebugPanel({ turn }: { turn: ChatTurn }) {
  const u = turn.usage
  const cacheHit = (u?.cachedTokens ?? 0) > 0
  const belowThreshold = u != null && !cacheHit && u.promptTokens < IMPLICIT_CACHE_MIN_TOKENS

  const latency = (
    <>
      {turn.timing.ttftMs != null && <KV k="TTFT" v={`${(turn.timing.ttftMs / 1000).toFixed(2)}s`} />}
      <KV k="总耗时" v={`${(turn.timing.totalMs / 1000).toFixed(2)}s`} />
      {turn.timing.tokensPerSec != null && <KV k="tokens/sec" v={turn.timing.tokensPerSec.toFixed(1)} />}
      <KV k="送出时间" v={turn.timing.requestAt} />
    </>
  )

  return (
    <div style={{
      marginTop: 6, padding: 10, borderRadius: 8,
      border: '1px solid var(--border)', background: 'var(--bg-secondary)',
    }}>
      {u ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Section title="Token">
            <KV k="prompt_tokens" v={u.promptTokens.toLocaleString()} />
            <KV k="completion_tokens" v={u.completionTokens.toLocaleString()} />
            <KV k="reasoning_tokens" v={u.reasoningTokens.toLocaleString()} />
            <KV k="total_tokens" v={u.totalTokens.toLocaleString()} />
            <KV
              k="cached_tokens"
              v={
                <>
                  {u.cachedTokens.toLocaleString()}
                  <span style={{ color: cacheHit ? 'var(--success)' : 'var(--text-secondary)', fontWeight: 600 }}>
                    {cacheHit ? 'HIT' : 'MISS'}
                  </span>
                </>
              }
            />
            {belowThreshold && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                ⚠ prompt 未达隐性 cache 最低门槛（1024 tokens），不可能命中
              </div>
            )}
          </Section>
          <Section title="延迟">{latency}</Section>
        </div>
      ) : (
        <Section title="延迟">{latency}</Section>
      )}
      {turn.meta && (
        <Section title="Metadata">
          <KV k="request id" v={turn.meta.requestId} copyable={turn.meta.requestId} mono />
          <KV k="model" v={turn.meta.model} />
          <KV k="service_tier" v={turn.meta.serviceTier} />
          <KV k="finish_reason" v={turn.meta.finishReason} />
          {turn.apiMode === 'responses' && (
            <>
              <KV k="response id" v={turn.meta.responseId} copyable={turn.meta.responseId} mono />
              {turn.meta.incompleteReason && <KV k="incomplete_reason" v={turn.meta.incompleteReason} />}
              <KV k="expire_at" v={turn.meta.expireAt != null
                ? `${turn.meta.expireAt}（${new Date(turn.meta.expireAt * 1000).toLocaleString()}）`
                : undefined} />
            </>
          )}
          {turn.previousResponseId && <KV k="previous_response_id" v={turn.previousResponseId} mono />}
        </Section>
      )}
      {turn.apiMode === 'responses' && turn.meta?.responseId && (
        <ServerActions responseId={turn.meta.responseId} />
      )}
      {turn.error && <RawBlock title="Error body" value={turn.error.body} />}
      <RawBlock title="Raw request" value={turn.requestBody} />
      {turn.rawResponse != null && <RawBlock title="Raw response" value={turn.rawResponse} />}
      {turn.sseChunks && <RawBlock title={`SSE chunk log（${turn.sseChunks.length}）`} value={turn.sseChunks.join('\n')} />}
    </div>
  )
}
