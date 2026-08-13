import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  uploadOneAsset,
  capAssetName,
  deriveAssetName,
  MAX_CONCURRENT_UPLOADS,
  _getUploadSemaphoreForTests,
} from '../hooks/useAssetUpload'
import { useAssetStore } from '../stores/assetStore'
import type { Asset } from '../types/asset'

beforeEach(() => {
  useAssetStore.setState(useAssetStore.getInitialState())
})

describe('uploadOneAsset', () => {
  it('runs through tos → sign-get → create → polling → done and upserts asset', async () => {
    const file = new File([new Uint8Array(100)], 'cat.jpg', {
      type: 'image/jpeg',
    })

    const tosKey = 'seedance-2-0/2026/05/u-cat.jpg'
    const upload = vi.fn(async () => ({
      key: tosKey,
      viewUrl: 'https://tos/3h',
      expiresAt: 0,
    }))
    const signGet = vi.fn(async (_k: string, sec?: number) => ({
      url: `https://tos/${sec}`,
      expiresAt: 0,
    }))
    const createA = vi.fn(async () => ({ id: 'asset-1' }))
    const finalAsset: Asset = {
      id: 'asset-1',
      name: 'cat',
      url: 'https://final',
      groupId: 'g1',
      assetType: 'Image',
      status: 'Active',
      projectName: 'my-project',
      createTime: 'x',
      updateTime: 'x',
    }
    const poll = vi.fn(async () => finalAsset)

    const out = await uploadOneAsset({
      file,
      groupId: 'g1',
      assetType: 'Image',
      name: 'cat',
      deps: {
        upload,
        signGet,
        createAsset: createA,
        pollAssetUntilDone: poll,
        getNow: () => 1000,
      },
    })

    expect(upload).toHaveBeenCalledOnce()
    // Stage 1.5: re-sign with 12h TTL
    expect(signGet).toHaveBeenCalledWith(tosKey, 12 * 60 * 60)
    expect(createA).toHaveBeenCalledWith({
      groupId: 'g1',
      url: 'https://tos/43200',
      assetType: 'Image',
      name: 'cat',
    })
    expect(poll).toHaveBeenCalledWith(
      'asset-1',
      expect.objectContaining({
        intervalMs: 5_000,
        maxWaitMs: 600_000,
      }),
    )
    expect(out.status).toBe('Active')
    expect(useAssetStore.getState().assets).toContainEqual(finalAsset)
    // upload tracker cleared on success
    expect(useAssetStore.getState().uploads).toEqual([])
  })

  it('inserts a Processing placeholder before polling completes', async () => {
    const file = new File([new Uint8Array(100)], 'cat.jpg', {
      type: 'image/jpeg',
    })
    const placeholderSnapshots: Asset[] = []
    const upload = vi.fn(async () => ({
      key: 'k',
      viewUrl: 'https://tos/3h',
      expiresAt: 0,
    }))
    const signGet = vi.fn(async () => ({ url: 'https://tos/12h', expiresAt: 0 }))
    const createA = vi.fn(async () => ({ id: 'asset-2' }))
    const poll = vi.fn(async () => {
      // capture the store state inside polling — placeholder must be there
      placeholderSnapshots.push(...useAssetStore.getState().assets)
      return {
        id: 'asset-2',
        name: 'cat',
        url: 'https://final',
        groupId: 'g1',
        assetType: 'Image',
        status: 'Active',
        projectName: 'p',
        createTime: 'x',
        updateTime: 'x',
      } as Asset
    })

    await uploadOneAsset({
      file,
      groupId: 'g1',
      assetType: 'Image',
      deps: {
        upload,
        signGet,
        createAsset: createA,
        pollAssetUntilDone: poll,
        getNow: () => 0,
      },
    })

    expect(placeholderSnapshots).toHaveLength(1)
    expect(placeholderSnapshots[0]).toMatchObject({
      id: 'asset-2',
      status: 'Processing',
    })
  })

  it('marks upload error on TOS failure and clears the tracker', async () => {
    const file = new File([new Uint8Array(100)], 'cat.jpg', {
      type: 'image/jpeg',
    })
    const upload = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(
      uploadOneAsset({
        file,
        groupId: 'g1',
        assetType: 'Image',
        deps: {
          upload,
          signGet: vi.fn(),
          createAsset: vi.fn(),
          pollAssetUntilDone: vi.fn(),
          getNow: () => 1,
        },
      }),
    ).rejects.toThrow('boom')

    // upload tracker cleared on failure
    expect(useAssetStore.getState().uploads).toEqual([])
  })

  it('defaults CreateAsset.Name to the local file name when no name override is given', async () => {
    const file = new File([new Uint8Array(10)], 'hero_shot_v3_4k.png', {
      type: 'image/png',
    })
    const createA = vi.fn(async () => ({ id: 'asset-9' }))
    const finalActive: Asset = {
      id: 'asset-9',
      name: 'hero_shot_v3_4k.png',
      url: 'https://final',
      groupId: 'g1',
      assetType: 'Image',
      status: 'Active',
      projectName: 'p',
      createTime: 'x',
      updateTime: 'x',
    }
    await uploadOneAsset({
      file,
      groupId: 'g1',
      assetType: 'Image',
      // intentionally no `name` override
      deps: {
        upload: vi.fn(async () => ({ key: 'k', viewUrl: 'u', expiresAt: 0 })),
        signGet: vi.fn(async () => ({ url: 'u12', expiresAt: 0 })),
        createAsset: createA,
        pollAssetUntilDone: vi.fn(async () => finalActive),
        getNow: () => 0,
      },
    })

    expect(createA).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'hero_shot_v3_4k.png' }),
    )
  })

  it('uses the explicit name when given (overrides file.name)', async () => {
    const file = new File([new Uint8Array(10)], 'cat.jpg', {
      type: 'image/jpeg',
    })
    const createA = vi.fn(async () => ({ id: 'asset-10' }))
    const finalActive: Asset = {
      id: 'asset-10',
      name: 'My Cute Cat',
      url: 'https://final',
      groupId: 'g1',
      assetType: 'Image',
      status: 'Active',
      projectName: 'p',
      createTime: 'x',
      updateTime: 'x',
    }
    await uploadOneAsset({
      file,
      groupId: 'g1',
      assetType: 'Image',
      name: 'My Cute Cat',
      deps: {
        upload: vi.fn(async () => ({ key: 'k', viewUrl: 'u', expiresAt: 0 })),
        signGet: vi.fn(async () => ({ url: 'u12', expiresAt: 0 })),
        createAsset: createA,
        pollAssetUntilDone: vi.fn(async () => finalActive),
        getNow: () => 0,
      },
    })
    expect(createA).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Cute Cat' }),
    )
  })

  it('caps very long filenames to 64 chars when sending to ARK', async () => {
    const longName = 'a'.repeat(80) + '.png' // 84 chars
    const file = new File([new Uint8Array(10)], longName, { type: 'image/png' })
    const createA = vi.fn(async () => ({ id: 'asset-11' }))
    const finalActive: Asset = {
      id: 'asset-11',
      name: 'x',
      url: 'https://final',
      groupId: 'g1',
      assetType: 'Image',
      status: 'Active',
      projectName: 'p',
      createTime: 'x',
      updateTime: 'x',
    }
    await uploadOneAsset({
      file,
      groupId: 'g1',
      assetType: 'Image',
      deps: {
        upload: vi.fn(async () => ({ key: 'k', viewUrl: 'u', expiresAt: 0 })),
        signGet: vi.fn(async () => ({ url: 'u12', expiresAt: 0 })),
        createAsset: createA,
        pollAssetUntilDone: vi.fn(async () => finalActive),
        getNow: () => 0,
      },
    })
    const calls = createA.mock.calls as unknown as Array<[{ name: string }]>
    expect(calls.length).toBeGreaterThan(0)
    const sentName = calls[0][0].name
    expect(sentName.length).toBeLessThanOrEqual(64)
    expect(sentName.endsWith('.png')).toBe(true)
  })
})

describe('capAssetName', () => {
  it('returns short names unchanged', () => {
    expect(capAssetName('cat.jpg')).toBe('cat.jpg')
  })

  it('caps to 64 chars while preserving the extension when reasonable', () => {
    const long = 'a'.repeat(80) + '.png'
    const out = capAssetName(long)
    expect(out.length).toBeLessThanOrEqual(64)
    expect(out.endsWith('.png')).toBe(true)
  })

  it('falls back to plain truncate when no plausible extension', () => {
    const out = capAssetName('z'.repeat(70))
    expect(out.length).toBe(64)
  })

  it('handles empty / whitespace by returning a sentinel', () => {
    expect(capAssetName('')).toBe('asset')
    expect(capAssetName('   ')).toBe('asset')
  })

  it('preserves unicode (Chinese filenames)', () => {
    expect(capAssetName('封面圖_v3.png')).toBe('封面圖_v3.png')
  })
})

describe('deriveAssetName', () => {
  it('uses explicit name when provided', () => {
    const file = new File([], 'cat.jpg', { type: 'image/jpeg' })
    expect(deriveAssetName({ file, name: 'override' })).toBe('override')
  })

  it('falls back to file.name when name is empty / whitespace', () => {
    const file = new File([], 'cat.jpg', { type: 'image/jpeg' })
    expect(deriveAssetName({ file, name: '' })).toBe('cat.jpg')
    expect(deriveAssetName({ file, name: '   ' })).toBe('cat.jpg')
  })
})

describe('Upload semaphore', () => {
  it('exports MAX_CONCURRENT_UPLOADS = 8', () => {
    expect(MAX_CONCURRENT_UPLOADS).toBe(8)
  })

  it('caps simultaneous tasks at MAX_CONCURRENT_UPLOADS', async () => {
    const sem = _getUploadSemaphoreForTests()
    let active = 0
    let peak = 0
    let completed = 0

    const TOTAL = 12
    const tasks = Array.from({ length: TOTAL }, () =>
      sem.run(async () => {
        active++
        peak = Math.max(peak, active)
        // Yield twice to give other tasks a chance to start.
        await Promise.resolve()
        await Promise.resolve()
        active--
        completed++
      }),
    )
    await Promise.all(tasks)

    expect(completed).toBe(TOTAL)
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_UPLOADS)
    expect(peak).toBeGreaterThan(0)
  })

  it('releases the slot even when the inner task throws', async () => {
    const sem = _getUploadSemaphoreForTests()
    await expect(
      sem.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // After throw, slot should be free — a follow-up run should resolve.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok')
  })
})
