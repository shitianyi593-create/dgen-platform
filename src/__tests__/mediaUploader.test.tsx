import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, waitFor, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MediaUploader from '../components/video/MediaUploader'
import type { LocalMedia } from '../types'

const ACCEPT = { 'image/*': ['.jpg', '.png'] }

function fireDropzoneInput(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files })
  fireEvent.change(input)
}

describe('MediaUploader pre-flight validation (Seedance)', () => {
  it('rejects oversized image and does NOT call onAdd', async () => {
    const onAdd = vi.fn()
    const { container } = render(
      <MediaUploader
        label="图片"
        accept={ACCEPT}
        items={[]}
        maxItems={9}
        onAdd={onAdd}
        onRemove={vi.fn()}
      />,
    )
    const tooBig = new File([new Uint8Array(31 * 1024 * 1024)], 'big.jpg', {
      type: 'image/jpeg',
    })
    fireDropzoneInput(container, [tooBig])
    // dropzone may run async; wait briefly
    await new Promise((r) => setTimeout(r, 50))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('accepts a small JPEG and calls onAdd', async () => {
    const onAdd = vi.fn()
    const { container } = render(
      <MediaUploader
        label="图片"
        accept={ACCEPT}
        items={[]}
        maxItems={9}
        onAdd={onAdd}
        onRemove={vi.fn()}
      />,
    )
    const ok = new File([new Uint8Array(1024)], 'a.jpg', { type: 'image/jpeg' })
    fireDropzoneInput(container, [ok])
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
  })
})

describe('MediaUploader — onLabelClick', () => {
  it('renders the badge as a non-interactive div when onLabelClick is NOT provided', () => {
    const items: LocalMedia[] = [{
      file: new File(['x'], 'x.png', { type: 'image/png' }),
      preview: 'blob:mock',
      uploading: false,
    }]
    render(
      <MediaUploader
        label="t"
        accept={{ 'image/*': ['.png'] }}
        items={items}
        maxItems={9}
        onAdd={() => {}}
        onRemove={() => {}}
        labels={['[Image 1]']}
      />,
    )
    expect(screen.queryByRole('button', { name: /插入到提示词/ })).toBeNull()
    expect(screen.getByTestId('media-label-badge')).toBeInTheDocument()
  })

  it('renders the badge as a button + fires onLabelClick when provided', async () => {
    const user = userEvent.setup()
    const onLabelClick = vi.fn()
    const items: LocalMedia[] = [{
      file: new File(['x'], 'x.png', { type: 'image/png' }),
      preview: 'blob:mock',
      uploading: false,
    }]
    render(
      <MediaUploader
        label="t"
        accept={{ 'image/*': ['.png'] }}
        items={items}
        maxItems={9}
        onAdd={() => {}}
        onRemove={() => {}}
        labels={['[Image 1]']}
        onLabelClick={onLabelClick}
      />,
    )
    const btn = screen.getByRole('button', { name: /插入到提示词/ })
    await user.click(btn)
    expect(onLabelClick).toHaveBeenCalledWith('[Image 1]')
  })
})

describe('stale rehydrated items', () => {
  const staleItem: LocalMedia = {
    file: undefined as unknown as File,
    preview: '',
    uploading: false,
    filename: 'cat.png',
    stale: true,
  }

  it('renders filename and 已失效 hint when stale', () => {
    render(
      <MediaUploader
        label="参考图"
        accept={{ 'image/*': [] }}
        items={[staleItem]}
        maxItems={4}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByText(/cat\.png/)).toBeInTheDocument()
    expect(screen.getByText(/已失效/)).toBeInTheDocument()
  })

  it('does not render <img> or <video> for stale items', () => {
    const { container } = render(
      <MediaUploader
        label="x" accept={{}} items={[staleItem]} maxItems={4}
        onAdd={vi.fn()} onRemove={vi.fn()}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })

  it('still allows removal of stale items', () => {
    const onRemove = vi.fn()
    render(
      <MediaUploader
        label="x" accept={{}} items={[staleItem]} maxItems={4}
        onAdd={vi.fn()} onRemove={onRemove}
      />,
    )
    fireEvent.click(screen.getByLabelText('移除'))
    expect(onRemove).toHaveBeenCalledWith(0)
  })
})

describe('MediaUploader — role badges + incompatible + role dropdown (T17)', () => {
  it('shows role badge on thumb when provided', () => {
    render(
      <MediaUploader
        label="x" accept={{}} items={[{ preview: 'b', uploading: false, role: 'first_frame' } as LocalMedia]}
        maxItems={9} onAdd={vi.fn()} onRemove={vi.fn()}
        roleBadges={['1ST']}
      />,
    )
    expect(screen.getByText('1ST')).toBeInTheDocument()
  })

  it('shows incompatible style when index is in incompatibleIdx', () => {
    render(
      <MediaUploader
        label="x" accept={{}} items={[{ preview: 'b', uploading: false } as LocalMedia]}
        maxItems={9} onAdd={vi.fn()} onRemove={vi.fn()}
        incompatibleIdx={[0]}
      />,
    )
    expect(screen.getByTestId('thumb-0')).toHaveAttribute('data-incompat', 'true')
  })

  it('shows role dropdown when enabled and fires callback', async () => {
    const onRoleChange = vi.fn()
    render(
      <MediaUploader
        label="x" accept={{}}
        items={[{ preview: 'b', uploading: false, role: 'first_frame' } as LocalMedia]}
        maxItems={2} onAdd={vi.fn()} onRemove={vi.fn()}
        showRoleDropdown
        roleChoices={['first_frame', 'last_frame']}
        onRoleChange={onRoleChange}
      />,
    )
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, 'last_frame')
    expect(onRoleChange).toHaveBeenCalledWith(0, 'last_frame')
  })
})

describe('MediaUploader — locked overlay (T19)', () => {
  it('renders lock overlay when locked prop is true', () => {
    render(
      <MediaUploader
        label="x" accept={{}} items={[]} maxItems={3}
        onAdd={vi.fn()} onRemove={vi.fn()}
        locked
        lockedHint="此模式不支持"
      />,
    )
    expect(screen.getByText(/此模式不支持/)).toBeInTheDocument()
    expect(screen.getByTestId('lock-overlay')).toBeInTheDocument()
  })
})
