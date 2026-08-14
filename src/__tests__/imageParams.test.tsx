import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import toast from 'react-hot-toast'
import ImageParams from '../components/image/ImageParams'
import { useImageStore } from '../stores/imageStore'
import { useAuthStore } from '../stores/authStore'
import { useCredentialsUiStore } from '../components/credentials/uiStore'

vi.mock('../hooks/useImageGeneration', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../hooks/useImageGeneration')>()
  return { ...orig, useImageGeneration: () => ({ generate: vi.fn() }) }
})
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const VALID_KEY = '12345678-1234-1234-1234-123456789012'
const IMG_EP = 'ep-20260202000000-bbbbb'

beforeEach(() => {
  vi.clearAllMocks()
  useImageStore.setState(useImageStore.getInitialState(), true)
  useAuthStore.setState({ apiKey: VALID_KEY, imageEndpoint: IMG_EP })
})

describe('ImageParams', () => {
  it('renders model select defaulting to 5.0 Pro', () => {
    render(<ImageParams width={320} />)
    const select = screen.getByLabelText('模型版本') as HTMLSelectElement
    expect(select.value).toBe('seedream-5-0-pro')
  })

  it('5.0 Pro: sequential toggle disabled with reason; size levels only 1K/2K', () => {
    render(<ImageParams width={320} />)
    expect(screen.getByLabelText('组图输出')).toBeDisabled()
    expect(screen.getByText(/不支持组图输出/)).toBeInTheDocument()
    const level = screen.getByLabelText('分辨率档位') as HTMLSelectElement
    expect(Array.from(level.options).map((o) => o.value)).toEqual(['1K', '2K'])
  })

  it('switching to 4.5 locks output format to jpeg and re-gates size levels', () => {
    render(<ImageParams width={320} />)
    fireEvent.change(screen.getByLabelText('模型版本'), {
      target: { value: 'seedream-4-5' },
    })
    const fmt = screen.getByLabelText('输出格式') as HTMLSelectElement
    expect(fmt).toBeDisabled()
    expect(useImageStore.getState().outputFormat).toBe('jpeg')
    const level = screen.getByLabelText('分辨率档位') as HTMLSelectElement
    expect(Array.from(level.options).map((o) => o.value)).toEqual(['2K', '4K'])
    expect(screen.getByLabelText('组图输出')).not.toBeDisabled()
  })

  it('custom size mode shows width/height inputs and inline validation error', () => {
    render(<ImageParams width={320} />)
    fireEvent.click(screen.getByLabelText('自定义像素'))
    fireEvent.change(screen.getByLabelText('宽 (px)'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('高 (px)'), { target: { value: '100' } })
    expect(screen.getByText(/总像素/)).toBeInTheDocument()
  })

  it('generate button disabled with reason when prompt is empty', () => {
    render(<ImageParams width={320} />)
    const btn = screen.getByRole('button', { name: /生成/ })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/请输入提示词/)).toBeInTheDocument()
  })

  it('generate button enabled when prompt present and creds ok', () => {
    useImageStore.getState().setPrompt('a cat')
    render(<ImageParams width={320} />)
    expect(screen.getByRole('button', { name: /生成/ })).not.toBeDisabled()
  })

  it('URL ref rows: add, edit, remove', () => {
    render(<ImageParams width={320} />)
    fireEvent.click(screen.getByRole('button', { name: '+ 图片 URL' }))
    const input = screen.getByPlaceholderText('https://…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://a/b.png' } })
    expect(useImageStore.getState().refUrls).toEqual(['https://a/b.png'])
    fireEvent.click(screen.getByRole('button', { name: '移除 URL 1' }))
    expect(useImageStore.getState().refUrls).toEqual([])
  })

  it('shows length warning for a 601-CJK-character prompt, not for a short one', () => {
    useImageStore.getState().setPrompt('貓'.repeat(601))
    render(<ImageParams width={320} />)
    expect(screen.getByText(/超过约 600 词/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('提示词'), {
      target: { value: '一隻貓' },
    })
    expect(screen.queryByText(/超过约 600 词/)).not.toBeInTheDocument()
  })

  it('dropzone rejects an invalid file with a toast and leaves refImages empty', async () => {
    render(<ImageParams width={320} />)
    const input = screen.getByLabelText('上传参考图') as HTMLInputElement
    const bad = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [bad] } })
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled())
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/不支持的文件格式/)
    expect(useImageStore.getState().refImages).toEqual([])
  })

  it('re-enables generate when credentials are entered after mount (authStore subscription)', () => {
    useAuthStore.setState({ apiKey: '', imageEndpoint: '' })
    useImageStore.getState().setPrompt('a cat')
    render(<ImageParams width={320} />)
    expect(screen.getByRole('button', { name: /生成/ })).toBeDisabled()

    // 在凭证抽屜输入密钥 + 图片接入点 → ImageParams 必须即时重渲染解锁按钮
    act(() => {
      useAuthStore.getState().setApiKey(VALID_KEY)
      useAuthStore.getState().setImageEndpoint(IMG_EP)
    })
    expect(screen.getByRole('button', { name: /生成/ })).not.toBeDisabled()
  })

  it('credential block reasons render an open-drawer shortcut; other reasons do not', () => {
    useAuthStore.setState({ apiKey: '', imageEndpoint: '' })
    useImageStore.getState().setPrompt('a cat')
    render(<ImageParams width={320} />)

    fireEvent.click(screen.getByRole('button', { name: '打开凭证设置' }))
    const ui = useCredentialsUiStore.getState()
    expect(ui.drawerOpen).toBe(true)
    expect(ui.drawerTarget).toBe('inference')

    // 非凭证原因（提示词为空）不显示快捷方式
    act(() => {
      useAuthStore.getState().setApiKey(VALID_KEY)
      useAuthStore.getState().setImageEndpoint(IMG_EP)
      useImageStore.getState().setPrompt('')
    })
    expect(screen.getByText(/请输入提示词/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开凭证设置' })).not.toBeInTheDocument()
  })

  it('insert buttons number uploads first, then non-empty URL rows', () => {
    useImageStore.setState({
      refImages: [
        { id: 'a', preview: '', filename: 'a.png' },
        { id: 'b', preview: '', filename: 'b.png' },
      ],
      refUrls: ['https://a/1.png'],
    })
    render(<ImageParams width={320} />)
    expect(screen.getByRole('button', { name: 'image 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'image 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'image 3' })).toBeInTheDocument()
  })

  it('an empty URL row between filled rows does not consume a number', () => {
    useImageStore.setState({
      refImages: [],
      refUrls: ['https://a/1.png', '', 'https://a/2.png'],
    })
    render(<ImageParams width={320} />)
    expect(screen.getByRole('button', { name: 'image 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'image 2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'image 3' })).not.toBeInTheDocument()
  })

  it('clicking an insert button inserts image N at the cursor position', () => {
    useImageStore.setState({ prompt: 'a  b', refUrls: ['https://a/1.png'] })
    render(<ImageParams width={320} />)
    const ta = screen.getByLabelText('提示词') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(2, 2)
    fireEvent.select(ta)
    fireEvent.click(screen.getByRole('button', { name: 'image 1' }))
    // 游标两侧已是空白 → 不再补空白
    expect(useImageStore.getState().prompt).toBe('a image 1 b')
  })

  it('mid-word insertion pads both sides with exactly one space', () => {
    useImageStore.setState({ prompt: 'redcar', refUrls: ['https://a/1.png'] })
    render(<ImageParams width={320} />)
    const ta = screen.getByLabelText('提示词') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(3, 3)
    fireEvent.select(ta)
    fireEvent.click(screen.getByRole('button', { name: 'image 1' }))
    expect(useImageStore.getState().prompt).toBe('red image 1 car')
  })

  it('with no recorded cursor, appends with a single leading space', () => {
    useImageStore.setState({ prompt: 'a cat', refUrls: ['https://a/1.png'] })
    render(<ImageParams width={320} />)
    // 不触碰 textarea（selectionRef 为 null）→ 走 append 分支
    fireEvent.click(screen.getByRole('button', { name: 'image 1' }))
    expect(useImageStore.getState().prompt).toBe('a cat image 1')
  })

  it('stale ref image blocks generate with a re-upload reason', () => {
    useImageStore.setState({
      prompt: 'a cat',
      refImages: [{ id: 'r1', preview: '', filename: 'x.png', stale: true }],
    })
    render(<ImageParams width={320} />)
    expect(screen.getByRole('button', { name: /生成/ })).toBeDisabled()
    expect(screen.getByText(/请移除后重新上传/)).toBeInTheDocument()
  })
})
