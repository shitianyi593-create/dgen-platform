import { describe, it, expect } from 'vitest'
import {
  buildOptimizeRequest,
  parseOptimizeResult,
  computeParamFixes,
  describeParamFixes,
  SD25_SYSTEM_PROMPT,
} from '../utils/sd25PromptOptimizer'

const baseContext = {
  prompt: '一隻貓在打哈欠',
  mode: 'multimodal' as const,
  assets: [
    { label: '@Image1', kind: 'image' as const, role: 'reference_image' as const },
    { label: '@Video1', kind: 'video' as const },
  ],
  duration: -1,
  ratio: 'adaptive',
  generateAudio: true,
}

describe('buildOptimizeRequest', () => {
  it('targets the text endpoint, non-stream, thinking disabled', () => {
    const req = buildOptimizeRequest(baseContext, 'ep-text')
    expect(req.model).toBe('ep-text')
    expect(req.stream).toBe(false)
    expect(req.thinking).toEqual({ type: 'disabled' })
    expect(req.messages[0].role).toBe('system')
    expect(req.messages[0].content).toBe(SD25_SYSTEM_PROMPT)
  })

  it('user message lists asset labels, mode, params and the raw prompt', () => {
    const req = buildOptimizeRequest(baseContext, 'ep-text')
    const user = req.messages[1].content
    expect(req.messages[1].role).toBe('user')
    expect(user).toContain('@Image1')
    expect(user).toContain('@Video1')
    expect(user).toContain('multimodal')
    expect(user).toContain('一隻貓在打哈欠')
  })

  it('empty assets renders 無', () => {
    const req = buildOptimizeRequest({ ...baseContext, assets: [] }, 'ep-text')
    expect(req.messages[1].content).toContain('（無）')
  })
})

describe('parseOptimizeResult', () => {
  it('parses a plain JSON object', () => {
    const r = parseOptimizeResult('{"taskType":"edit","prompt":"優化後"}')
    expect(r).toEqual({ taskType: 'edit', prompt: '優化後' })
  })

  it('strips markdown code fences', () => {
    const r = parseOptimizeResult('```json\n{"taskType":"extend","prompt":"p"}\n```')
    expect(r).toEqual({ taskType: 'extend', prompt: 'p' })
  })

  it('unknown taskType value normalizes to unknown', () => {
    const r = parseOptimizeResult('{"taskType":"whatever","prompt":"p"}')
    expect(r.taskType).toBe('unknown')
    expect(r.prompt).toBe('p')
  })

  it('non-JSON falls back to whole text as prompt', () => {
    const r = parseOptimizeResult('這不是 JSON，但仍是可用的提示詞')
    expect(r).toEqual({ taskType: 'unknown', prompt: '這不是 JSON，但仍是可用的提示詞' })
  })

  it('JSON without prompt string falls back to whole text', () => {
    const r = parseOptimizeResult('{"taskType":"edit"}')
    expect(r.taskType).toBe('unknown')
    expect(r.prompt).toBe('{"taskType":"edit"}')
  })
})

describe('computeParamFixes (spec §3 task-type constraints)', () => {
  it('edit locks BOTH duration -1 and ratio adaptive', () => {
    expect(computeParamFixes('edit', { duration: 10, ratio: '16:9' }))
      .toEqual({ duration: -1, ratio: 'adaptive' })
  })

  it('edit with already-conforming params needs no fixes', () => {
    expect(computeParamFixes('edit', { duration: -1, ratio: 'adaptive' })).toEqual({})
  })

  it('extend locks ratio ONLY — duration stays untouched', () => {
    expect(computeParamFixes('extend', { duration: 10, ratio: '16:9' }))
      .toEqual({ ratio: 'adaptive' })
  })

  it('reference / t2v / frames / unknown need no fixes', () => {
    for (const t of ['reference', 't2v', 'frames', 'unknown'] as const) {
      expect(computeParamFixes(t, { duration: 10, ratio: '16:9' })).toEqual({})
    }
  })
})

describe('describeParamFixes', () => {
  it('returns null for empty fixes', () => {
    expect(describeParamFixes({})).toBeNull()
  })
  it('describes both fixes', () => {
    const s = describeParamFixes({ duration: -1, ratio: 'adaptive' })
    expect(s).toContain('Auto')
    expect(s).toContain('Adaptive')
  })
})
