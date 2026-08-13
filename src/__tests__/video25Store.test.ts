import { describe, it, expect, beforeEach } from 'vitest'
import { useVideo25Store } from '../stores/video25Store'

describe('video25Store', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useVideo25Store.setState(useVideo25Store.getInitialState())
  })

  it('has Seedance 2.5 defaults: duration Auto(-1), 720p, adaptive, optimize off', () => {
    const s = useVideo25Store.getState()
    expect(s.duration).toBe(-1)
    expect(s.resolution).toBe('720p')
    expect(s.ratio).toBe('adaptive')
    expect(s.promptOptimize).toBe(false)
    expect(s.mode).toBe('multimodal')
  })

  it('setPromptOptimize toggles the flag', () => {
    useVideo25Store.getState().setPromptOptimize(true)
    expect(useVideo25Store.getState().promptOptimize).toBe(true)
  })

  it('persists under its own sessionStorage key, including promptOptimize', async () => {
    useVideo25Store.getState().setPrompt('hello 25')
    useVideo25Store.getState().setPromptOptimize(true)
    // zustand persist writes synchronously for sessionStorage JSON storage
    const raw = sessionStorage.getItem('byteplus-ai-gen-platform-video25')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.prompt).toBe('hello 25')
    expect(parsed.state.promptOptimize).toBe(true)
    // 不污染 2.0 的 key
    expect(sessionStorage.getItem('byteplus-ai-gen-platform-video')).toBeNull()
  })
})
