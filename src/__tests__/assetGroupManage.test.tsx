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
    // 管理模式的測試與分頁無關 —— 清單當作已全載完（底部只剩操作列）。
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
    expect(screen.queryByText('建立新 Group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('group-overflow-a')).not.toBeInTheDocument()
    // 完成離開管理模式
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('建立新 Group')).toBeInTheDocument()
  })

  it('entering manage mode closes an in-progress rename form', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByTestId('group-overflow-a'))
    fireEvent.click(screen.getByText('重新命名'))
    expect(screen.getByRole('button', { name: '儲存' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    // 編輯中的列不會渲染 checkbox，但 id 仍會被「全選」收進去 —
    // 進管理模式時關掉編輯表單，讓每一列都選得到也看得見。
    expect(screen.queryByRole('button', { name: '儲存' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('row click toggles the checkbox instead of selecting the group', () => {
    const props = makeProps()
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('全選 checks all visible rows; 清除 empties; delete disabled at 0', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    const deleteBtn = () =>
      screen.getByRole('button', { name: /刪除選取/ }) as HTMLButtonElement
    expect(deleteBtn().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '全選' }))
    expect(
      screen.getByRole('button', { name: /刪除選取 \(3\)/ }),
    ).toBeInTheDocument()
    expect(deleteBtn().disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(deleteBtn().disabled).toBe(true)
  })

  it('全選 under a search filter only absorbs the VISIBLE rows', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.change(screen.getByLabelText('搜尋群組'), { target: { value: '乙' } })
    fireEvent.click(screen.getByRole('button', { name: '全選' }))
    // 只有被過濾出的「乙」被收進勾選 — 看不見的列不得被全選吸入
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('search filtering does NOT clear existing checks', () => {
    render(<AssetGroupSidebar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    fireEvent.change(screen.getByLabelText('搜尋群組'), {
      target: { value: '乙' },
    })
    // a 被過濾隱藏但仍在勾選集合
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('onBatchDelete resolving [] clears checks and exits manage mode', async () => {
    const props = makeProps({ onBatchDelete: vi.fn(async () => ({ failedIds: [] })) })
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(1\)/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(2\)/ }))
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
      ).toBeInTheDocument()
    })
    // 留在管理模式讓使用者重試失敗項
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(
      screen.getByRole('checkbox', { name: '選取 乙' }),
    ).toBeChecked()
  })

  it('null (cancelled) keeps the checks and stays in manage mode', async () => {
    const props = makeProps({ onBatchDelete: vi.fn(async () => null) })
    render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByTestId('group-row-a'))
    fireEvent.click(screen.getByRole('button', { name: /刪除選取 \(1\)/ }))
    await waitFor(() => expect(props.onBatchDelete).toHaveBeenCalledWith(['a']))
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('prunes checks for groups that vanish from the list', () => {
    const props = makeProps()
    const { rerender } = render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '全選' }))
    expect(
      screen.getByRole('button', { name: /刪除選取 \(3\)/ }),
    ).toBeInTheDocument()
    // 群組被別的路徑刪掉（單筆刪除、其他分頁的重新整理）→ 勾選必須跟著修剪，
    // 否則計數虛胖，而且那些列已不在畫面上、使用者無從個別取消勾選。
    rerender(<AssetGroupSidebar {...props} groups={[g('a', '甲')]} />)
    expect(
      screen.getByRole('button', { name: /刪除選取 \(1\)/ }),
    ).toBeInTheDocument()
  })

  it('server-search mode swaps the list WITHOUT pruning checks', () => {
    const props = makeProps({ disableClientFilter: true })
    const { rerender } = render(<AssetGroupSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '全選' }))
    // disableClientFilter = 伺服器端搜尋（>1000 群組）：props.groups 是整批
    // 抽換的「可見清單」而非現存群組全集，照修會把搜尋前的勾選全清掉。
    rerender(<AssetGroupSidebar {...props} groups={[g('z', '搜尋結果')]} />)
    expect(
      screen.getByRole('button', { name: /刪除選取 \(3\)/ }),
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
    const btn = screen.getByRole('button', { name: /刪除選取 \(1\)/ })
    // deleteBusy 由父層的 job 狀態驅動，翻真前的視窗內連點會開兩個 Modal。
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onBatchDelete).toHaveBeenCalledTimes(1)
    // guard 在結果回來後釋放 — 不是一次性鎖死
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
      (screen.getByRole('button', { name: /刪除選取/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
