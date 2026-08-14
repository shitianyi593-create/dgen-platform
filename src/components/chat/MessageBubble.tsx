// src/components/chat/MessageBubble.tsx
// 一轮对话 = user 泡泡 + assistant 泡泡。阅读性优先：debug 默认收起，
// 摘要胶囊带关键数字，点击展开 TurnDebugPanel。用户/响应动作 hover 浮现。
import { useState } from 'react'
import TurnDebugPanel from './TurnDebugPanel'
import ConfirmModal from '../common/ConfirmModal'
import { Icon } from '../common/icons'
import { copyWithToast } from '../../utils/clipboard'
import { useTurnActions } from './useTurnActions'
import type { ChatTurn } from '../../types/chat'

interface Props {
  turn: ChatTurn
  isLast: boolean
  expandAll: boolean
  onResend: () => void
  resendDisabled: boolean
}

// .chat-ghost-btn 本身不 flex；icon+文字并排需要 inline-flex 对齐（handoff §D-1）。
const iconBtnLayout: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 }

function badgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: 11, padding: '1px 6px', borderRadius: 4,
    border: `1px solid ${color}`, color, whiteSpace: 'nowrap',
  }
}

export default function MessageBubble({ turn, isLast, expandAll, onResend, resendDisabled }: Props) {
  const [expanded, setExpanded] = useState(expandAll)
  // master 开关切换时同步；之后仍可个别开合。
  // 用 render 期衍生状态（React 官方「adjusting state on prop change」模式），
  // 避免在 effect 内 setState 造成的串接 render。
  const [prevExpandAll, setPrevExpandAll] = useState(expandAll)
  if (expandAll !== prevExpandAll) {
    setPrevExpandAll(expandAll)
    setExpanded(expandAll)
  }

  // 「自此轮回溯」动作（S5）：确认状态、N 计算与 store 操作抽在 useTurnActions。
  const { turnsFromHere, confirmAction, setConfirmAction, handleConfirm } = useTurnActions(turn.id)

  const u = turn.usage
  const cacheHit = (u?.cachedTokens ?? 0) > 0
  const hasContent = turn.assistant.content.length > 0

  // 动作列 hover/focus 浮现：纯 CSS（.chat-turn:hover / :focus-within → .chat-reveal），
  // 用 opacity 而非 display:none，元素恒可点击、可聚焦，且 tab 切换子元素不闪烁。
  return (
    <div className="chat-turn" style={{ marginBottom: 16 }}>
      {/* user 泡泡（靠右）+ hover 浮现动作列 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 6 }}>
        <div style={{
          maxWidth: '70%', padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
          background: 'var(--accent)', color: '#fff', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
        }}>
          {turn.userText}
        </div>
        <div className="chat-reveal" style={{ display: 'flex', gap: 2, marginTop: 4 }}>
          <button
            className="chat-ghost-btn"
            onClick={() => setConfirmAction('edit')}
            disabled={resendDisabled}
            aria-label="编辑并自此轮重送"
            title="移除此轮与之后所有轮，并把原输入回填到输入框"
            style={iconBtnLayout}
          >
            <Icon name="edit" size={12} />
            编辑重送
          </button>
          <button
            className="chat-ghost-btn danger"
            onClick={() => setConfirmAction('delete')}
            disabled={resendDisabled}
            aria-label="删除此轮及之后"
            title="移除此轮与之后所有轮"
            style={iconBtnLayout}
          >
            <Icon name="trash" size={12} />
            删除
          </button>
          <button
            className="chat-ghost-btn"
            onClick={() => void copyWithToast('用户消息', turn.userText)}
            aria-label="复制用户消息"
            title="复制用户消息"
            style={iconBtnLayout}
          >
            <Icon name="copy" size={12} />
            复制
          </button>
          {isLast && (
            <button
              className="chat-ghost-btn"
              onClick={onResend}
              disabled={resendDisabled}
              aria-label="重送"
              title="以同样历史重送（验证隐性 cache 第二次是否 HIT）"
              style={iconBtnLayout}
            >
              <Icon name="refresh-cw" size={12} />
              重送
            </button>
          )}
        </div>
      </div>

      {/* assistant 泡泡（靠左） */}
      <div style={{ maxWidth: '85%' }}>
        {turn.assistant.reasoning && (
          <details style={{ marginBottom: 4 }}>
            <summary style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              思维链（reasoning_content）
            </summary>
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
              padding: '6px 10px', borderLeft: '2px solid var(--border)', margin: '4px 0',
            }}>
              {turn.assistant.reasoning}
            </div>
          </details>
        )}
        <div style={{
          padding: '12px 16px', borderRadius: '4px 14px 14px 14px',
          background: 'var(--bg-secondary)', border: '1px solid var(--bg-input)',
          color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap',
        }}>
          {turn.error
            ? <span style={{ color: 'var(--danger)' }}>生成失败{turn.error.status ? `（HTTP ${turn.error.status}）` : ''}</span>
            : turn.assistant.content || (turn.pending ? '…' : turn.aborted ? '（已中止）' : '（空响应）')}
        </div>

        {/* debug 摘要胶囊 + 状态徽章 + hover 浮现的「复制响应」 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={`${expanded ? '收起' : '展开'} debug 信息`}
            aria-expanded={expanded}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              borderRadius: 999, border: '1px solid var(--border)', padding: '3px 10px',
              background: 'none', cursor: 'pointer', fontSize: 11,
              color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ display: 'inline-flex', transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'none' }}>
              <Icon name="chevron-right" size={10} />
            </span>
            <span>{(turn.timing.totalMs / 1000).toFixed(1)}s</span>
            {u && <span style={{ color: 'var(--border)' }}>·</span>}
            {u && <span>{u.totalTokens.toLocaleString()} tokens</span>}
            {u && <span style={{ color: 'var(--border)' }}>·</span>}
            {u && (
              <span style={{ color: cacheHit ? 'var(--success)' : 'var(--text-secondary)' }}>
                {cacheHit ? `cache HIT ${u.cachedTokens.toLocaleString()}` : 'cache MISS'}
              </span>
            )}
          </button>
          {turn.aborted && <span style={badgeStyle('var(--warning)')}>已中止</span>}
          {turn.error && <span style={badgeStyle('var(--danger)')}>错误</span>}
          {hasContent && (
            <button
              className="chat-ghost-btn chat-reveal"
              onClick={() => void copyWithToast('响应内容', turn.assistant.content)}
              aria-label="复制响应内容"
              title="复制响应内容"
              style={iconBtnLayout}
            >
              <Icon name="copy" size={12} />
              复制响应
            </button>
          )}
        </div>

        {expanded && <TurnDebugPanel turn={turn} />}
      </div>

      <ConfirmModal
        open={confirmAction === 'edit'}
        title="编辑并自此轮重送？"
        subtitle={`此轮与之后共 ${turnsFromHere} 轮将被移除，原输入会回填到输入框（debug 数据将丢失，可先下载 JSON）`}
        confirmLabel="移除并回填"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmModal
        open={confirmAction === 'delete'}
        title="删除此轮及之后？"
        subtitle={`此轮与之后共 ${turnsFromHere} 轮将被移除（debug 数据将丢失，可先下载 JSON）`}
        confirmLabel="删除"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
