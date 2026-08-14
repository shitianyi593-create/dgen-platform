import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AssetGroupSidebar from '../components/assets/AssetGroupSidebar'
import type { AssetGroup } from '../types/asset'

const groups: AssetGroup[] = [
  {
    id: 'group-20260224213258-pnqkh',
    name: '品牌素材',
    groupType: 'AIGC',
    projectName: 'p',
    createTime: 'x',
    updateTime: 'x',
  },
  {
    id: 'group-20260218104411-aaaaa',
    name: '人物角色',
    groupType: 'AIGC',
    projectName: 'p',
    createTime: 'x',
    updateTime: 'x',
  },
]

/**
 * 这个文件测的是侧栏的基本渲染，与分页无关 —— 清单一律当作已全载完
 * （底部加载列不显示）。无限滚动本身有自己的文件（assetGroupInfiniteScroll）。
 */
const baseProps = {
  groups,
  selectedId: null as string | null,
  onSelect: vi.fn(),
  onCreate: vi.fn(async () => {}),
  onRename: vi.fn(async () => {}),
  onDelete: vi.fn(),
  onBatchDelete: vi.fn(async () => null as { failedIds: string[] } | null),
  onLoadMore: vi.fn(),
  hasMore: false,
  loadingMore: false,
  loadMoreError: null as string | null,
  totalCount: groups.length,
}

describe('AssetGroupSidebar v2', () => {
  it('renders 素材群组 heading + each group name (group id hidden)', () => {
    render(
      <AssetGroupSidebar
        {...baseProps}
        selectedId="group-20260224213258-pnqkh"
      />,
    )
    expect(screen.getByText('素材群组')).toBeInTheDocument()
    expect(screen.getByText('DGEN')).toBeInTheDocument()
    expect(screen.getByText('品牌素材')).toBeInTheDocument()
    // Group IDs are no longer rendered in the sidebar rows.
    expect(
      screen.queryByText('group-20260224213258-pnqkh'),
    ).toBeNull()
  })

  it('marks the selected row with aria-selected=true', () => {
    render(
      <AssetGroupSidebar
        {...baseProps}
        selectedId="group-20260218104411-aaaaa"
      />,
    )
    expect(
      screen.getByTestId('group-row-group-20260218104411-aaaaa'),
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('opens overflow menu and dispatches delete', () => {
    const onDelete = vi.fn()
    render(
      <AssetGroupSidebar
        {...baseProps}
        selectedId="group-20260224213258-pnqkh"
        onDelete={onDelete}
      />,
    )
    fireEvent.click(
      screen.getByTestId('group-overflow-group-20260224213258-pnqkh'),
    )
    fireEvent.click(screen.getByText('删除'))
    expect(onDelete).toHaveBeenCalledWith(groups[0])
  })

  it('opens inline create form via the dashed CTA and submits', async () => {
    const onCreate = vi.fn(async () => {})
    render(<AssetGroupSidebar {...baseProps} onCreate={onCreate} />)
    fireEvent.click(screen.getByText(/创建新群组/))
    fireEvent.change(screen.getByPlaceholderText(/群组名称/), {
      target: { value: 'new-group' },
    })
    fireEvent.click(screen.getByText(/^创建$/))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'new-group',
        description: undefined,
      }),
    )
  })
})
