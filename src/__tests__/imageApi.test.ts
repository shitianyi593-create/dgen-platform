// src/__tests__/imageApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateImages, IMAGES_PATH } from '../api/image'
import { apiClient } from '../api/client'
import type { ImageGenerationRequest } from '../types/image'

vi.mock('../api/client', () => ({
  apiClient: { post: vi.fn() },
}))

const mockPost = vi.mocked(apiClient.post)

function baseRequest(): ImageGenerationRequest {
  return {
    model: 'ep-20260101000000-aaaaa',
    prompt: 'a cat',
    size: '2K',
    response_format: 'url',
    watermark: false,
    stream: false,
  }
}

describe('generateImages', () => {
  beforeEach(() => {
    mockPost.mockReset()
  })

  it('POSTs to /api/v3/images/generations and returns the body + requestId', async () => {
    const body = { data: [{ url: 'https://example.bytepluses.com/img.png' }] }
    mockPost.mockResolvedValueOnce({ data: body, headers: { 'x-request-id': 'req-123' } })

    const res = await generateImages(baseRequest())

    expect(mockPost).toHaveBeenCalledWith(
      IMAGES_PATH,
      baseRequest(),
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    expect(IMAGES_PATH).toBe('/api/v3/images/generations')
    expect(res.response.data?.[0].url).toContain('img.png')
    expect(res.requestId).toBe('req-123')
  })

  it('leaves requestId undefined when the x-request-id header is absent', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: [] } })
    const res = await generateImages(baseRequest())
    expect(res.requestId).toBeUndefined()
    expect(res.response.data).toEqual([])
  })

  it('uses an extended timeout (sync generation can take > 30s)', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: [] } })
    await generateImages(baseRequest())
    const opts = mockPost.mock.calls[0][2] as { timeout: number }
    expect(opts.timeout).toBeGreaterThanOrEqual(120_000)
  })

  it('propagates normalized errors from the client', async () => {
    mockPost.mockRejectedValueOnce(new Error('sensitive content detected'))
    await expect(generateImages(baseRequest())).rejects.toThrow('sensitive content')
  })
})
