import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import AssetLibraryPage from '../components/assets/AssetLibraryPage'
import { useAssetStore } from '../stores/assetStore'
import { useAuthStore } from '../stores/authStore'
import type { BatchDeleteOptions } from '../api/batchDelete'

vi.mock('../api/batchDelete', () => ({
  batchDelete: vi.fn(async (ids: string[], opts: BatchDeleteOptions) => {
    for (const id of ids) opts.onRemoved?.(id)
    const p = {
      total: ids.length,
      succeeded: ids.length,
      failed: [],
      status: 'done' as const,
    }
    opts.onProgress?.(p)
    return p
  }),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useAssetStore.setState(useAssetStore.getInitialState())
  useAuthStore.setState({
    assetCreds: { accessKeyId: 'AK', accessKeySecret: 'SK', projectName: 'p' },
  })
})
afterEach(() => vi.unstubAllGlobals())

function mockOk(payload: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => payload,
  })
}

/**
 * Order of fetch calls on a fresh mount:
 *   1) ListAssetGroups (page 1 only — the eager walk is gone)
 *   2) ListAssets for the auto-selected group (PageSize=100)
 *   3) ListAssets PageSize=1 — the auto-selected group's count, for the
 *      header's 「N 個素材」(spec §4.3). One call, for one group.
 *
 * 中間那一段「每個群組一發 countAssetsInGroup」的扇出已隨無限捲動刪除
 *（spec §3）：群組上千時它就是打爆 ListAssets QPM 的那半邊。
 *
 * 只有斷言標題數字的測試會餵第 3 個 mock；其餘的讓它落空（count 是
 * best-effort，失敗被吞掉只留 '—'），這樣加一發 count 不會把每個 mock
 * 佇列都推移一格。
 */

describe('AssetLibraryPage v2', () => {
  it('shows the gate message when assetCreds are empty', () => {
    useAuthStore.setState({
      assetCreds: { accessKeyId: '', accessKeySecret: '', projectName: '' },
    })
    render(<AssetLibraryPage />)
    expect(screen.getByText(/請先.*私有素材庫憑證/)).toBeInTheDocument()
    // The inner component should NOT render
    expect(screen.queryByText('私有素材庫管理')).not.toBeInTheDocument()
  })

  it('renders 上傳素材 header button and no legacy page-title block', async () => {
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 50 })

    render(<AssetLibraryPage />)
    expect(
      await screen.findByRole('button', { name: /上傳素材/ }),
    ).toBeInTheDocument()
    // Legacy title block (私有素材庫管理 + subtitle) is gone.
    expect(screen.queryByText('私有素材庫管理')).toBeNull()
    expect(screen.queryByText(/管理 BytePlus ModelArk Asset/)).toBeNull()
    // 原設計（2026-05-06 spec）：素材工具列不做搜尋框。側欄的「群組」搜尋
    // 是後來刻意加的，所以斷言收斂到 <main>（素材區）內沒有搜尋輸入 ——
    // 語意與原斷言一致，且不與側欄的 placeholder 文案耦合。
    expect(
      within(screen.getByRole('main')).queryByPlaceholderText(/搜尋/),
    ).toBeNull()
  })

  it('renders sidebar group + count + asset card after load + chips', async () => {
    mockOk({
      Items: [{
        Id: 'group-aaa', Name: 'my-assets', GroupType: 'AIGC',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 50,
    })
    // assets list for the auto-selected group
    mockOk({
      Items: [{
        Id: 'asset-1', Name: 'cat.png', URL: 'https://u',
        GroupId: 'group-aaa', AssetType: 'Image', Status: 'Active',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 100,
    })
    // countAssetsInGroup for the auto-selected group. TotalCount 刻意不是 1：
    // 標題讀的是伺服器端的群組總數，不是剛載進來的那一頁（那頁只有 1 筆）。
    mockOk({ Items: [], TotalCount: 7, PageNumber: 1, PageSize: 1 })

    render(<AssetLibraryPage />)
    // Group name appears twice (sidebar row + page header h2); both
    // valid renders, so use findAllByText.
    const matches = await screen.findAllByText('my-assets')
    expect(matches.length).toBeGreaterThan(0)
    // Header shows the group's asset count next to the group name.
    expect(await screen.findByText('7 個素材')).toBeInTheDocument()
    // 類型 chip 的數字（'全部 1'）—— label 與 count 是兩個 span，所以精確
    // 比對得到 '1'。側欄的逐群組徽章已隨 count 扇出一起移除，這個 '1' 只可能
    // 來自 chip。
    const onesAfter = await screen.findAllByText('1')
    expect(onesAfter.length).toBeGreaterThan(0)
    // asset card filename rendered
    expect(await screen.findByText('cat.png')).toBeInTheDocument()
    // toolbar visible — type chips (全部/圖片/…) + status <select>
    const allChips = screen.getAllByText(/全部/)
    expect(allChips.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/圖片/).length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getByRole('combobox', { name: '狀態篩選' }),
    ).toBeInTheDocument()
  })

  it('changing the status select refetches assets with the picked status', async () => {
    mockOk({
      Items: [{
        Id: 'group-aaa', Name: 'my-assets', GroupType: 'AIGC',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 50,
    })
    mockOk({
      Items: [{
        Id: 'asset-1', Name: 'cat.png', URL: 'https://u',
        GroupId: 'group-aaa', AssetType: 'Image', Status: 'Active',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 100,
    })
    render(<AssetLibraryPage />)
    await screen.findByText('cat.png')

    // Refetch triggered by the same statusFilter state as before.
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 100 })
    fireEvent.change(screen.getByRole('combobox', { name: '狀態篩選' }), {
      target: { value: 'Failed' },
    })
    await waitFor(() => {
      const lastBody = String(fetchMock.mock.calls.at(-1)?.[1]?.body ?? '')
      expect(lastBody).toContain('"Statuses":["Failed"]')
    })
  })

  it('shows the empty-account CTA when there are no groups', async () => {
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 50 })
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(screen.getByText(/建立第一個群組/)).toBeInTheDocument(),
    )
  })

  it('shows error banner when ListAssetGroups fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 503,
      json: async () => ({
        error: { message: 'Missing required env: BYTEPLUS_AK' },
      }),
    })
    render(<AssetLibraryPage />)
    await waitFor(() =>
      expect(
        screen.getByText('Missing required env: BYTEPLUS_AK'),
      ).toBeInTheDocument(),
    )
  })
})

describe('AssetLibraryPage — batch delete', () => {
  // Reuses the same fetch sequence as the "renders sidebar group + count
  // + asset card" test above: ListAssetGroups (page 1) → ListAssets.
  async function mountWithAsset() {
    mockOk({
      Items: [{
        Id: 'group-aaa', Name: 'my-assets', GroupType: 'AIGC',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 50,
    })
    mockOk({
      Items: [{
        Id: 'asset-1', Name: 'cat.png', URL: 'https://u',
        GroupId: 'group-aaa', AssetType: 'Image', Status: 'Active',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 100,
    })
    render(<AssetLibraryPage />)
    await screen.findByText('cat.png')
  }

  it('selection toolbar appears when items are checked and triggers batchDelete on confirm', async () => {
    const { batchDelete } = await import('../api/batchDelete')
    ;(batchDelete as unknown as Mock).mockClear?.()

    await mountWithAsset()

    const firstCheck = screen.getAllByTestId('asset-check')[0]
    fireEvent.click(firstCheck)

    // ActionPillBar (role="toolbar") is the new selection bar; its
    // delete action is labeled "刪除 N 個" (no longer "刪除選取").
    expect(await screen.findByRole('toolbar')).toBeInTheDocument()
    // The pill-bar button comes first in DOM order; the ConfirmModal
    // confirm button (aria-label "刪除 1 個") mounts after the click.
    fireEvent.click(screen.getAllByRole('button', { name: /刪除 1 個/ })[0])

    // ConfirmModal opens; both the toolbar and the dialog contain a
    // "刪除 1 個" button — pick the one inside the dialog.
    const dialog = await screen.findByRole('dialog')
    const confirmBtn = Array.from(
      dialog.querySelectorAll('button'),
    ).find((b) => /刪除 1 個/.test(b.textContent ?? ''))
    expect(confirmBtn).toBeTruthy()
    fireEvent.click(confirmBtn!)

    await waitFor(() => expect(batchDelete).toHaveBeenCalledTimes(1))
    const calledIds = (batchDelete as unknown as Mock).mock
      .calls[0][0] as string[]
    expect(calledIds.length).toBe(1)
  })

  it('cancelling the confirm does not call batchDelete', async () => {
    const { batchDelete } = await import('../api/batchDelete')
    ;(batchDelete as unknown as Mock).mockClear()

    await mountWithAsset()
    fireEvent.click(screen.getAllByTestId('asset-check')[0])
    // Pill-bar's danger button opens the ConfirmModal.
    fireEvent.click(screen.getAllByRole('button', { name: /刪除 1 個/ })[0])

    // Modal is open; click cancel ("取消")
    fireEvent.click(
      await screen.findByRole('button', { name: '取消' }),
    )
    expect(batchDelete).not.toHaveBeenCalled()
  })

  it('opens ConfirmModal with thumbs and count when batch delete triggered (no window.confirm)', async () => {
    const { batchDelete } = await import('../api/batchDelete')
    ;(batchDelete as unknown as Mock).mockClear?.()
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true)
    confirmSpy.mockClear()

    await mountWithAsset()

    // Select the only asset rendered
    fireEvent.click(screen.getAllByTestId('asset-check')[0])
    // ActionPillBar's badge contains "已選" + the count.
    expect(await screen.findByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByText(/已選/)).toBeTruthy()

    // Click the pill-bar's danger action ("刪除 1 個")
    fireEvent.click(screen.getAllByRole('button', { name: /刪除 1 個/ })[0])

    // ConfirmModal should be open (role="dialog"); window.confirm must NOT fire;
    // batchDelete should NOT have been called yet (still awaiting confirm)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/刪除 \d+ 個 asset/)).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(batchDelete).not.toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})

describe('AssetLibraryPage — single-asset delete (ConfirmModal)', () => {
  async function mountWithAsset() {
    mockOk({
      Items: [{
        Id: 'group-aaa', Name: 'my-assets', GroupType: 'AIGC',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 50,
    })
    mockOk({
      Items: [{
        Id: 'asset-1', Name: 'cat.png', URL: 'https://u',
        GroupId: 'group-aaa', AssetType: 'Image', Status: 'Active',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 100,
    })
    render(<AssetLibraryPage />)
    await screen.findByText('cat.png')
  }

  it('opens ConfirmModal when single asset delete is triggered (no window.confirm)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true)
    // Clear any leaked calls from prior tests in this file (no auto-restore).
    confirmSpy.mockClear()

    await mountWithAsset()

    // Open the preview drawer by clicking the asset card
    fireEvent.click(screen.getAllByTestId('asset-card')[0])

    // Click the drawer's delete button (aria-label 刪除素材)
    const deleteBtn = await screen.findByRole('button', { name: '刪除素材' })
    fireEvent.click(deleteBtn)

    // ConfirmModal should be open (role="dialog"); window.confirm must NOT have fired
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/刪除資產/)).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})

describe('AssetLibraryPage — group delete (ConfirmModal typed)', () => {
  async function mountWithGroup() {
    mockOk({
      Items: [{
        Id: 'group-aaa', Name: 'mygroup', GroupType: 'AIGC',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 50,
    })
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 100 })
    render(<AssetLibraryPage />)
    // Wait for the sidebar row to render
    await screen.findByTestId('group-row-group-aaa')
  }

  it('group delete opens ConfirmModal with typed-name confirmation (no window.prompt)', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => 'mygroup')
    promptSpy.mockClear()

    await mountWithGroup()

    // Open the overflow menu for the group, then click the 刪除 entry
    fireEvent.click(screen.getByTestId('group-overflow-group-aaa'))
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))

    // ConfirmModal should be open with typed-name input; window.prompt must NOT fire
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/刪除群組？/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/輸入群組名稱/)).toBeInTheDocument()
    expect(promptSpy).not.toHaveBeenCalled()

    promptSpy.mockRestore()
  })
})

describe('AssetLibraryPage — ActionPillBar (bottom-anchored selection bar)', () => {
  async function mountWithAsset() {
    mockOk({
      Items: [{
        Id: 'group-aaa', Name: 'my-assets', GroupType: 'AIGC',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 50,
    })
    mockOk({
      Items: [{
        Id: 'asset-1', Name: 'cat.png', URL: 'https://u',
        GroupId: 'group-aaa', AssetType: 'Image', Status: 'Active',
        ProjectName: 'p', CreateTime: 'x', UpdateTime: 'x',
      }],
      TotalCount: 1, PageNumber: 1, PageSize: 100,
    })
    render(<AssetLibraryPage />)
    await screen.findByText('cat.png')
  }

  it('hides ActionPillBar when no items are checked', async () => {
    await mountWithAsset()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('shows ActionPillBar with selection badge when items are checked', async () => {
    await mountWithAsset()

    fireEvent.click(screen.getAllByTestId('asset-check')[0])

    // Bottom-anchored pill bar uses role="toolbar"
    const toolbar = await screen.findByRole('toolbar')
    expect(toolbar).toBeInTheDocument()
    // Badge contains "已選" and the count
    expect(screen.getByText(/已選/)).toBeInTheDocument()
    // Selected count rendered inside the badge
    expect(toolbar.textContent).toContain('1')
    // Actions present per spec §4.3
    expect(screen.getByRole('button', { name: '全選本頁' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /刪除 1 個/ }),
    ).toBeInTheDocument()
  })
})

describe('AssetLibraryPage — build first group (ConfirmModal)', () => {
  it('build first group opens ConfirmModal with input (no window.prompt)', async () => {
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockImplementation(() => 'mygroup')
    promptSpy.mockClear()

    // Zero-groups state: ListAssetGroups returns empty
    mockOk({ Items: [], TotalCount: 0, PageNumber: 1, PageSize: 50 })
    render(<AssetLibraryPage />)

    // Wait for the empty-state CTA to appear
    const ctaBtn = await screen.findByRole('button', {
      name: /建立第一個群組/,
    })
    fireEvent.click(ctaBtn)

    // ConfirmModal should be open with an input; window.prompt must NOT fire
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/群組名稱/)).toBeInTheDocument()
    expect(promptSpy).not.toHaveBeenCalled()

    promptSpy.mockRestore()
  })
})
