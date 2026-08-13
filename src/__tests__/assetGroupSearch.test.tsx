import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AssetGroupSidebar from '../components/assets/AssetGroupSidebar'
import type { AssetGroup } from '../types/asset'

function g(id: string, name: string): AssetGroup {
  return { id, name, groupType: 'AIGC', projectName: 'default', createTime: '', updateTime: '' }
}

const baseProps = {
  selectedId: null,
  onSelect: vi.fn(),
  onCreate: vi.fn(async () => {}),
  onRename: vi.fn(async () => {}),
  onDelete: vi.fn(),
  onBatchDelete: vi.fn(async () => null),
  // 這個檔案測的是過濾，不是分頁 —— 清單當作已全載完（footer 不顯示）。
  onLoadMore: vi.fn(),
  hasMore: false,
  loadingMore: false,
  loadMoreError: null,
  totalCount: 3,
}

describe('AssetGroupSidebar search', () => {
  const groups = [g('a', '人物素材'), g('b', '場景素材'), g('c', 'Products')]

  it('filters by case-insensitive substring', () => {
    render(<AssetGroupSidebar {...baseProps} groups={groups} />)
    fireEvent.change(screen.getByLabelText('搜尋群組'), { target: { value: 'prod' } })
    expect(screen.getByTestId('group-row-c')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-a')).not.toBeInTheDocument()
    expect(screen.queryByTestId('group-row-b')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when nothing matches', () => {
    render(<AssetGroupSidebar {...baseProps} groups={groups} />)
    fireEvent.change(screen.getByLabelText('搜尋群組'), { target: { value: 'zzz' } })
    expect(screen.getByText('無符合群組')).toBeInTheDocument()
  })

  it('clearing the query restores the full list', () => {
    render(<AssetGroupSidebar {...baseProps} groups={groups} />)
    const input = screen.getByLabelText('搜尋群組')
    fireEvent.change(input, { target: { value: 'prod' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('group-row-a')).toBeInTheDocument()
    expect(screen.getByTestId('group-row-b')).toBeInTheDocument()
    expect(screen.getByTestId('group-row-c')).toBeInTheDocument()
  })

  it('reports the query via onQueryChange, and disableClientFilter keeps all rows', () => {
    const onQueryChange = vi.fn()
    render(
      <AssetGroupSidebar
        {...baseProps}
        groups={groups}
        onQueryChange={onQueryChange}
        disableClientFilter
      />,
    )
    fireEvent.change(screen.getByLabelText('搜尋群組'), { target: { value: 'prod' } })
    expect(onQueryChange).toHaveBeenCalledWith('prod')
    // 伺服器端模式：清單由 props.groups 決定，前端不再過濾
    expect(screen.getByTestId('group-row-a')).toBeInTheDocument()
  })
})
