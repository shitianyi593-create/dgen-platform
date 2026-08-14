import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AssetUploadDialog from '../components/assets/AssetUploadDialog'
import type { AssetGroup } from '../types/asset'

const groups: AssetGroup[] = [
  {
    id: 'g1',
    name: 'my-assets',
    groupType: 'AIGC',
    projectName: 'p',
    createTime: 'x',
    updateTime: 'x',
  },
]

function makeFile(name: string, type: string, size = 1000): File {
  return new File([new Uint8Array(size)], name, { type })
}

function fireFileInput(files: File[]) {
  const input = screen.getByTestId('upload-file-input') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files })
  fireEvent.change(input)
}

describe('AssetUploadDialog v2', () => {
  it('renders group selector and "从电脑选择" button', () => {
    render(
      <AssetUploadDialog
        groups={groups}
        defaultGroupId="g1"
        onClose={vi.fn()}
        onUpload={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('my-assets')).toBeInTheDocument()
    expect(screen.getByText(/从电脑选择/)).toBeInTheDocument()
    expect(screen.getByText(/尚未选择任何文件/)).toBeInTheDocument()
  })

  it('lists picked files with type chip + size', async () => {
    render(
      <AssetUploadDialog
        groups={groups}
        defaultGroupId="g1"
        onClose={vi.fn()}
        onUpload={vi.fn()}
      />,
    )
    fireFileInput([makeFile('cat.jpg', 'image/jpeg', 1024 * 1024)])
    await waitFor(() =>
      expect(screen.getByText('cat.jpg')).toBeInTheDocument(),
    )
    expect(screen.getByText('IMAGE')).toBeInTheDocument()
    expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument()
  })

  it('rejects oversize file with inline error and disables 开始上传', async () => {
    render(
      <AssetUploadDialog
        groups={groups}
        defaultGroupId="g1"
        onClose={vi.fn()}
        onUpload={vi.fn()}
      />,
    )
    const tooBig = makeFile('big.jpg', 'image/jpeg', 31 * 1024 * 1024)
    fireFileInput([tooBig])
    // Validation error string starts with the warning glyph; the supporting
    // hint about limits also mentions "30 MB" so we anchor on the glyph.
    await waitFor(() =>
      expect(screen.getByText(/⚠.*30 MB/)).toBeInTheDocument(),
    )
    // Submit button label includes the count when valid > 0; when 0 it's just "开始上传".
    const submit = screen.getByRole('button', { name: /开始上传/ })
    expect(submit).toBeDisabled()
  })

  it('does not call onUpload when there are no valid files', () => {
    const onUpload = vi.fn(async () => {})
    render(
      <AssetUploadDialog
        groups={groups}
        defaultGroupId="g1"
        onClose={vi.fn()}
        onUpload={onUpload}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /开始上传/ }))
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('hands the entire valid batch to onUpload in one call and closes immediately', async () => {
    const onUpload = vi.fn(async () => {})
    const onClose = vi.fn()
    render(
      <AssetUploadDialog
        groups={groups}
        defaultGroupId="g1"
        onClose={onClose}
        onUpload={onUpload}
      />,
    )
    fireFileInput([
      makeFile('a.jpg', 'image/jpeg'),
      makeFile('b.png', 'image/png'),
    ])
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /开始上传/ }))

    // Single call with the full batch (NOT per-file iteration).
    expect(onUpload).toHaveBeenCalledTimes(1)
    const calls = onUpload.mock.calls as unknown as Array<
      [Array<{ file: File; assetType: string; groupId: string }>]
    >
    expect(calls.length).toBe(1)
    const inputs = calls[0][0]
    expect(inputs).toHaveLength(2)
    expect(inputs.map((i) => i.file.name)).toEqual(['a.jpg', 'b.png'])
    expect(inputs.every((i) => i.groupId === 'g1')).toBe(true)

    // Dialog closed synchronously — no waitFor needed.
    expect(onClose).toHaveBeenCalled()
  })

  it('removes a file when its row ✕ is clicked', async () => {
    render(
      <AssetUploadDialog
        groups={groups}
        defaultGroupId="g1"
        onClose={vi.fn()}
        onUpload={vi.fn()}
      />,
    )
    fireFileInput([makeFile('a.jpg', 'image/jpeg')])
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    await waitFor(() =>
      expect(screen.queryByText('a.jpg')).toBeNull(),
    )
  })
})
