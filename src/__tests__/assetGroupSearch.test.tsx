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
  // 这个文件测的是过滤，不是分页 —— 清单当作已全载完（footer 不显示）。
  onLoadMore: vi.fn(),
  hasMore: false,
  loadingMore: false,
  loadMoreError: null,
  totalCount: 3,
}

describe('AssetGroupSidebar search', () => {
  const groups = [g('a', '人物素材'), g('b', '场景素材'), g('c', 'Products')]

  it('filters by case-insensitive substring', () => {
    render(<AssetGroupSidebar {...baseProps} groups={groups} />)
    fireEvent.change(screen.getByLabelText('搜索群组'), { target: { value: 'prod' } })
    expect(screen.getByTestId('group-row-c')).toBeInTheDocument()
    expect(screen.queryByTestId('group-row-a')).not.toBeInTheDocument()
    expect(screen.queryByTestId('group-row-b')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when nothing matches', () => {
    render(<AssetGroupSidebar {...baseProps} groups={groups} />)
    fireEvent.change(screen.getByLabelText('搜索群组'), { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的群组')).toBeInTheDocument()
  })

  it('clearing the query restores the full list', () => {
    render(<AssetGroupSidebar {...baseProps} groups={groups} />)
    const input = screen.getByLabelText('搜索群组')
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
    fireEvent.change(screen.getByLabelText('搜索群组'), { target: { value: 'prod' } })
    expect(onQueryChange).toHaveBeenCalledWith('prod')
    // 服务器端模式：清单由 props.groups 决定，前端不再过滤
    expect(screen.getByTestId('group-row-a')).toBeInTheDocument()
  })
})
