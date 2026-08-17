import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useVideo25Store } from '../stores/video25Store'

let _seq = 0
const freshStore = () => import('../stores/video25Store?t=' + Date.now() + '_' + ++_seq)

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
    const raw = sessionStorage.getItem('dgen-platform-video25')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.prompt).toBe('hello 25')
    expect(parsed.state.promptOptimize).toBe(true)
    // 不污染 2.0 的 key
    expect(sessionStorage.getItem('dgen-platform-video')).toBeNull()
  })

  it('migrates the legacy BytePlus video25 storage key', async () => {
    sessionStorage.removeItem('dgen-platform-video25')
    sessionStorage.setItem('byteplus-ai-gen-platform-video25', JSON.stringify({
      version: 1,
      state: { prompt: 'legacy 25', promptOptimize: true, history: [] },
    }))

    vi.resetModules()
    const mod = await freshStore()
    expect(mod.useVideo25Store.getState().prompt).toBe('legacy 25')
    expect(mod.useVideo25Store.getState().promptOptimize).toBe(true)
    mod.useVideo25Store.getState().setPrompt('new 25')

    const raw = sessionStorage.getItem('dgen-platform-video25')
    expect(raw).not.toBeNull()
    expect(sessionStorage.getItem('byteplus-ai-gen-platform-video25')).toBeNull()
    expect(JSON.parse(raw as string).state.prompt).toBe('new 25')
  })
})
