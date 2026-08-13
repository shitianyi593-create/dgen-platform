/**
 * local API 層測試 — 僅剩 downloadAssetBlob 一個 entry。
 * 其餘 export/import/list/check 端點已隨多用戶隔離重構移除。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }))

vi.mock('axios', () => ({
  default: {
    create: () => ({
      post: mockPost,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}))

import { downloadAssetBlob } from '../api/local'

describe('downloadAssetBlob', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('POSTs to /local-api/download-asset with url + filename and responseType:blob', async () => {
    const fakeBlob = new Blob(['x'], { type: 'application/octet-stream' })
    mockPost.mockResolvedValue({ data: fakeBlob })

    const result = await downloadAssetBlob('https://cdn.bytepluses.com/v.mp4', 'cgt-1.mp4')

    expect(mockPost).toHaveBeenCalledWith(
      '/local-api/download-asset',
      { url: 'https://cdn.bytepluses.com/v.mp4', filename: 'cgt-1.mp4' },
      { responseType: 'blob' },
    )
    expect(result).toBe(fakeBlob)
  })
})
