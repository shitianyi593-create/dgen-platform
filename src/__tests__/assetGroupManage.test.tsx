import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AssetGroupSidebar from '../components/assets/AssetGroupSidebar'
import type { AssetGroup } from '../types/asset'

function g(id: string, name: string): AssetGroup {
  return {
    id,
    name,
    groupType: 'AIGC',
    projectName: 'default',
    createTime: '',
    updateTime: '',
  }
}
const groups = [g('a', '甲'), g('b', '乙'), g('c', '丙')]

function makeProps(
  overrides: Partial<Parameters<typeof AssetGroupSidebar>[0]> = {},
) {
  return {
    groups,
    selectedId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(async () => {}),
    onRename: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onBatchDelete: vi.fn(async () => null as { failedIds: string[] } | null),
    // 管理模式的测试与分页无关 —— 清单当作已全载完（底部只剩操作列）。
    onLoadMore: vi.fn(),
    hasMore: false,
    loadingMore: false,
    loadMoreError: null,
    totalCount: groups.length,
    ...overrides,
  }
}

describe('AssetGroupSidebar manage mode', () => {
  it('管理 toggles the mode: checkboxes appear, create button and row menus hide', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByText('创建新群组')).not.toBeInTheDocument()
    expect(screen.queryByTestId('group-overflow-a')).not.toBeInTheDocument()
    // 完成离开管理模式
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('创建新群组')).toBeInTheDocument()
  })

  it('entering manage mode closes an in-progress rename form', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByTestId('group-overflow-a'))
    fireEvent.click(screen.getByText('重新命名'))
    expect(screen.getByRole('button', { name: '存储' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    // 编辑中的列不会渲染 checkbox，但 id 仍会被「全选」收进去 —
    // 进管理模式时关掉编辑表单，让每一列都选得到也看得见。
    expect(screen.queryByRole('button', { name: '存储' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('row click toggles the checkbox instead of selecting the group', () => {
    const props = makeProps()
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('全选 checks all visible rows; 清除 empties; delete disabled at 0', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    const deleteBtn = () =>
      screen.getByRole('button', { name: /删除选择/ }) as HTMLButtonElement
    expect(deleteBtn().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(
      screen.getByRole('button', { name: /删除选择 \(3\)/ }),
    ).toBeInTheDocument()
    expect(deleteBtn().disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(deleteBtn().disabled).toBe(true)
  })

  it('全选 under a search filter only absorbs the VISIBLE rows', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.change(screen.getByLabelText('搜索群组'), { target: { value: '乙' } })
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    // 只有被过滤出的「乙」被收进勾选 — 看不见的列不得被全选吸入
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('search filtering does NOT clear existing checks', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    fireEvent.change(screen.getByLabelText('搜索群组'), {
      target: { value: '乙' },
    })
    // a 被过滤隐藏但仍在勾选集合
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('onBatchDelete resolving [] clears checks and exits manage mode', async () => {
    const props = makeProps({ onBatchDelete: vi.fn(async () => ({ failedIds: [] })) })
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(1\)/ }))
    expect(props.onBatchDelete).toHaveBeenCalledWith(['a'])
    await waitFor(() => {
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument() // 已退出管理模式
    })
  })

  it('failed ids stay checked', async () => {
    const props = makeProps({
      onBatchDelete: vi.fn(async () => ({ failedIds: ['b'] })),
    })
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    fireEvent.click(screen.getByTestId('group-row-b'))
    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(2\)/ }))
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /删除选择 \(1\)/ }),
      ).toBeInTheDocument()
    })
    // 留在管理模式让用户重试失败项
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(
      screen.getByRole('checkbox', { name: '选择 乙' }),
    ).toBeChecked()
  })

  it('null (cancelled) keeps the checks and stays in manage mode', async () => {
    const props = makeProps({ onBatchDelete: vi.fn(async () => null) })
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    fireEvent.click(screen.getByRole('button', { name: /删除选择 \(1\)/ }))
    await waitFor(() => expect(props.onBatchDelete).toHaveBeenCalledWith(['a']))
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('prunes checks for groups that vanish from the list', () => {
    const props = makeProps()
    const { rerender } = render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(
      screen.getByRole('button', { name: /删除选择 \(3\)/ }),
    ).toBeInTheDocument()
    // 群组被别的路径删掉（单笔删除、其他分页的刷新）→ 勾选必须跟著修剪，
    // 否则计数虚胖，而且那些列已不在画面上、用户无从个别取消勾选。
    rerender(<AssetGroupSidebar {...props} groups={[g('a', '甲')]} />)
    expect(
      screen.getByRole('button', { name: /删除选择 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('server-search mode swaps the list WITHOUT pruning checks', () => {
    const props = makeProps({ disableClientFilter: true })
    const { rerender } = render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    // disableClientFilter = 服务器端搜索（>1000 群组）：props.groups 是整批
    // 抽换的「可见清单」而非现存群组全集，照修会把搜索前的勾选全清掉。
    rerender(<AssetGroupSidebar {...props} groups={[g('z', '搜索结果')]} />)
    expect(
      screen.getByRole('button', { name: /删除选择 \(3\)/ }),
    ).toBeInTheDocument()
  })

  it('double-clicking the delete button only fires onBatchDelete once', async () => {
    let settle: ((r: { failedIds: string[] } | null) => void) | undefined
    const onBatchDelete = vi.fn(
      () =>
        new Promise<{ failedIds: string[] } | null>((resolve) => {
          settle = resolve
        }),
    )
    render(<AssetGroupSidebar {...makeProps({ onBatchDelete })} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    const btn = screen.getByRole('button', { name: /删除选择 \(1\)/ })
    // deleteBusy 由父层的 job 状态驱动，翻真前的视窗内连点会开两个 Modal。
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onBatchDelete).toHaveBeenCalledTimes(1)
    // guard 在结果回来后释放 — 不是一次性锁死
    settle?.({ failedIds: [] })
    await waitFor(() =>
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(),
    )
  })

  it('deleteBusy disables the delete button', () => {
    render(<AssetGroupSidebar {...makeProps({ deleteBusy: true })} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    expect(
      (screen.getByRole('button', { name: /删除选择/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
