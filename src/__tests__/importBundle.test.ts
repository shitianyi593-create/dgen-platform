import { describe, it, expect } from 'vitest'
import { zip } from 'fflate'
import { parseTaskFolder } from '../api/importBundle'

function makeFile(name: string, relPath: string, content: string | Uint8Array): File {
  const blob = typeof content === 'string'
    ? new Blob([content], { type: 'application/json' })
    : new Blob([content as BlobPart], { type: 'application/octet-stream' })
  const file = new File([blob], name, { type: blob.type })
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath, configurable: true })
  return file
}

describe('parseTaskFolder', () => {
  it('parses a single task folder', async () => {
    const taskJson = {
      task_id: 'cgt-001',
      created_at: '2026-05-14T00:00:00Z',
      status: 'succeeded',
      prompt: 'cat',
      request: { model: 'm', content: [] },
      result: { video_url: './output/video.mp4', last_frame_url: null },
    }
    const files = [
      makeFile('task.json', 'cgt-001/task.json', JSON.stringify(taskJson)),
      makeFile('video.mp4', 'cgt-001/output/video.mp4', new Uint8Array([1, 2, 3])),
    ]
    const parsed = await parseTaskFolder(files)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].taskJson.task_id).toBe('cgt-001')
    expect(parsed[0].videoBlob).toBeInstanceOf(Blob)
    expect(parsed[0].lastFrameBlob).toBeUndefined()
  })

  it('parses a parent folder containing multiple task subfolders', async () => {
    const j1 = { task_id: 't1', created_at: '2026-05-14T00:00:00Z', status: 'succeeded', prompt: 'a', request: { model: 'm', content: [] }, result: { video_url: null, last_frame_url: null } }
    const j2 = { task_id: 't2', created_at: '2026-05-14T00:00:00Z', status: 'succeeded', prompt: 'b', request: { model: 'm', content: [] }, result: { video_url: null, last_frame_url: null } }
    const files = [
      makeFile('task.json', 'batch/t1/task.json', JSON.stringify(j1)),
      makeFile('task.json', 'batch/t2/task.json', JSON.stringify(j2)),
    ]
    const parsed = await parseTaskFolder(files)
    const ids = parsed.map((p) => p.taskJson.task_id).sort()
    expect(ids).toEqual(['t1', 't2'])
  })

  it('matches references via relative paths', async () => {
    const taskJson = {
      task_id: 'cgt-r',
      created_at: '2026-05-14T00:00:00Z',
      status: 'succeeded',
      prompt: 'with ref',
      request: {
        model: 'm',
        content: [{ type: 'image_url', image_url: { url: './references/ref-1.png' }, role: 'reference_image' }],
      },
      result: { video_url: null, last_frame_url: null },
    }
    const files = [
      makeFile('task.json', 'cgt-r/task.json', JSON.stringify(taskJson)),
      makeFile('ref-1.png', 'cgt-r/references/ref-1.png', new Uint8Array([9])),
    ]
    const parsed = await parseTaskFolder(files)
    expect(parsed[0].referenceBlobs.get('references/ref-1.png')).toBeInstanceOf(Blob)
  })

  it('skips folders without task.json', async () => {
    const files = [
      makeFile('readme.txt', 'random/readme.txt', 'not a task'),
    ]
    const parsed = await parseTaskFolder(files)
    expect(parsed).toEqual([])
  })

  it('skips task.json that fails to parse', async () => {
    const files = [
      makeFile('task.json', 'cgt-bad/task.json', '{not valid json'),
    ]
    const parsed = await parseTaskFolder(files)
    expect(parsed).toEqual([])
  })
})

async function makeZipFile(entries: Record<string, Uint8Array>, name: string): Promise<File> {
  // fflate detects leaves with `val instanceof Uint8Array` against its own
  // captured Node-realm Uint8Array. Under jsdom, bytes from `TextEncoder`
  // can be a different-realm Uint8Array and get treated as a directory,
  // producing a malformed zip. Re-wrap each entry as a node-realm Uint8Array.
  const normalized: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(entries)) {
    normalized[k] = v instanceof Uint8Array ? v : new Uint8Array((v as Uint8Array).buffer, (v as Uint8Array).byteOffset, (v as Uint8Array).byteLength)
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(normalized, (err, data) => (err ? reject(err) : resolve(data)))
  })
  return new File([bytes as BlobPart], name, { type: 'application/zip' })
}

describe('parseTaskZip', () => {
  it('parses a single-task zip', async () => {
    const taskJson = {
      task_id: 'cgt-zip-001',
      created_at: '2026-05-14T00:00:00Z',
      status: 'succeeded',
      prompt: 'zip cat',
      request: { model: 'm', content: [] },
      result: { video_url: './output/video.mp4', last_frame_url: null },
    }
    const zipFile = await makeZipFile({
      'task.json': new TextEncoder().encode(JSON.stringify(taskJson)),
      'output/video.mp4': new Uint8Array([1, 2, 3]),
    }, 'cgt-zip-001.zip')

    const { parseTaskZip } = await import('../api/importBundle')
    const parsed = await parseTaskZip(zipFile)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].taskJson.task_id).toBe('cgt-zip-001')
    expect(parsed[0].videoBlob).toBeInstanceOf(Blob)
  })

  it('parses a batch zip with per-task subfolders', async () => {
    const j1 = { task_id: 't1', created_at: '2026-05-14T00:00:00Z', status: 'succeeded', prompt: 'a', request: { model: 'm', content: [] }, result: { video_url: null, last_frame_url: null } }
    const j2 = { task_id: 't2', created_at: '2026-05-14T00:00:00Z', status: 'succeeded', prompt: 'b', request: { model: 'm', content: [] }, result: { video_url: null, last_frame_url: null } }
    const zipFile = await makeZipFile({
      't1/task.json': new TextEncoder().encode(JSON.stringify(j1)),
      't2/task.json': new TextEncoder().encode(JSON.stringify(j2)),
    }, 'batch.zip')

    const { parseTaskZip } = await import('../api/importBundle')
    const parsed = await parseTaskZip(zipFile)
    expect(parsed.map((p) => p.taskJson.task_id).sort()).toEqual(['t1', 't2'])
  })

  it('resolves _shared/ references through ../_shared/ paths in task.json', async () => {
    const shared = new Uint8Array([42])
    const j1 = {
      task_id: 'tA', created_at: '2026-05-14T00:00:00Z', status: 'succeeded', prompt: 'a',
      request: { model: 'm', content: [{ type: 'image_url', image_url: { url: '../_shared/abc.png' }, role: 'reference_image' }] },
      result: { video_url: null, last_frame_url: null },
    }
    const zipFile = await makeZipFile({
      'tA/task.json': new TextEncoder().encode(JSON.stringify(j1)),
      '_shared/abc.png': shared,
    }, 'batch.zip')

    const { parseTaskZip } = await import('../api/importBundle')
    const parsed = await parseTaskZip(zipFile)
    expect(parsed).toHaveLength(1)
    // The shared file should be discoverable via the path it points to
    expect(parsed[0].referenceBlobs.get('../_shared/abc.png')).toBeInstanceOf(Blob)
  })
})

import { vi, beforeEach, afterEach } from 'vitest'

describe('toHistoryItem', () => {
  beforeEach(() => {
    let counter = 0
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:fake-${counter++}`),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('produces a VideoHistoryItem with object URLs for video and frame', async () => {
    const { toHistoryItem } = await import('../api/importBundle')
    const videoBytes = new Uint8Array([1])
    const frameBytes = new Uint8Array([2])
    const parsed = {
      taskJson: {
        task_id: 'cgt-z',
        created_at: '2026-05-14T00:00:00Z',
        status: 'succeeded',
        prompt: 'p',
        request: { model: 'm', content: [] },
        result: { video_url: './output/video.mp4', last_frame_url: './output/last_frame.png' },
      },
      videoBlob: new Blob([videoBytes as BlobPart]),
      lastFrameBlob: new Blob([frameBytes as BlobPart]),
      referenceBlobs: new Map<string, Blob>(),
    }
    const item = await toHistoryItem(parsed)
    expect(item.taskId).toBe('cgt-z')
    expect(item.objectUrl).toMatch(/^blob:fake-/)
    expect(item.frameObjectUrl).toMatch(/^blob:fake-/)
    expect(item.imported).toBe(true)
  })

  it('rewrites request.content reference URLs to object URLs', async () => {
    const { toHistoryItem } = await import('../api/importBundle')
    const refBytes = new Uint8Array([99])
    const refBlob = new Blob([refBytes as BlobPart])
    const parsed = {
      taskJson: {
        task_id: 'cgt-r',
        created_at: '2026-05-14T00:00:00Z',
        status: 'succeeded',
        prompt: 'p',
        request: {
          model: 'm',
          content: [{ type: 'image_url', image_url: { url: './references/ref-1.png' }, role: 'reference_image' }],
        },
        result: { video_url: null, last_frame_url: null },
      },
      referenceBlobs: new Map<string, Blob>([['references/ref-1.png', refBlob]]),
    }
    const item = await toHistoryItem(parsed)
    const content = item.requestContent?.content as unknown as Array<Record<string, unknown>>
    expect((content[0].image_url as { url: string }).url).toMatch(/^blob:fake-/)
  })

  it('leaves missing references with their relative path unchanged (it will 404 when displayed)', async () => {
    const { toHistoryItem } = await import('../api/importBundle')
    const parsed = {
      taskJson: {
        task_id: 'cgt-m',
        created_at: '2026-05-14T00:00:00Z',
        status: 'succeeded',
        prompt: 'p',
        request: {
          model: 'm',
          content: [{ type: 'image_url', image_url: { url: './references/missing.png' }, role: 'reference_image' }],
        },
        result: { video_url: null, last_frame_url: null },
      },
      referenceBlobs: new Map<string, Blob>(),
    }
    const item = await toHistoryItem(parsed)
    const content = item.requestContent?.content as unknown as Array<Record<string, unknown>>
    // No matching blob → URL stays as the relative path; UI handles broken image
    expect((content[0].image_url as { url: string }).url).toBe('./references/missing.png')
  })

  it('falls back to reference_image for unknown role string', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { toHistoryItem } = await import('../api/importBundle')
    const parsed = {
      taskJson: {
        task_id: 'cgt-unknown-role',
        created_at: '2026-05-14T00:00:00Z',
        status: 'succeeded',
        prompt: 'p',
        request: {
          model: 'm',
          content: [{ type: 'image_url', image_url: { url: './ref.png' }, role: 'something_new' }],
        },
        result: { video_url: null, last_frame_url: null },
      },
      referenceBlobs: new Map<string, Blob>(),
    }
    const item = await toHistoryItem(parsed)
    const content = item.requestContent?.content as unknown as Array<Record<string, unknown>>
    expect(content[0].role).toBe('reference_image')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('revokeImportedUrls', () => {
  it('revokes blob: URLs in objectUrl, frameObjectUrl, and reference content', async () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:placeholder'),
      revokeObjectURL: vi.fn((u: string) => { revoked.push(u) }),
    })
    const { revokeImportedUrls } = await import('../api/importBundle')
    revokeImportedUrls({
      objectUrl: 'blob:video-1',
      frameObjectUrl: 'blob:frame-1',
      requestContent: {
        model: 'm',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image_url', image_url: { url: 'blob:ref-img' }, role: 'reference_image' },
          { type: 'video_url', video_url: { url: 'blob:ref-vid' }, role: 'reference_video' },
          { type: 'audio_url', audio_url: { url: 'blob:ref-aud' }, role: 'reference_audio' },
        ],
      } as unknown as import('../types').CreateVideoTaskRequest,
    })
    expect(revoked.sort()).toEqual(['blob:frame-1', 'blob:ref-aud', 'blob:ref-img', 'blob:ref-vid', 'blob:video-1'])
    vi.unstubAllGlobals()
  })

  it('ignores non-blob URLs and undefined fields', async () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(),
      revokeObjectURL: vi.fn((u: string) => { revoked.push(u) }),
    })
    const { revokeImportedUrls } = await import('../api/importBundle')
    revokeImportedUrls({
      objectUrl: 'https://signed.example.com/v.mp4',  // not blob:
      frameObjectUrl: undefined,
      requestContent: {
        model: 'm',
        content: [
          { type: 'image_url', image_url: { url: './references/local.png' }, role: 'reference_image' },
        ],
      } as unknown as import('../types').CreateVideoTaskRequest,
    })
    expect(revoked).toEqual([])
    vi.unstubAllGlobals()
  })
})

describe('parseTaskFolder — _shared/', () => {
  it('attaches sibling _shared/ files to each task via ../_shared/ key', async () => {
    const j1 = {
      task_id: 'tA', created_at: '2026-05-14T00:00:00Z', status: 'succeeded', prompt: 'a',
      request: { model: 'm', content: [{ type: 'image_url', image_url: { url: '../_shared/abc.png' }, role: 'reference_image' }] },
      result: { video_url: null, last_frame_url: null },
    }
    const files = [
      makeFile('task.json', 'batch/tA/task.json', JSON.stringify(j1)),
      makeFile('abc.png', 'batch/_shared/abc.png', new Uint8Array([42])),
    ]
    const { parseTaskFolder } = await import('../api/importBundle')
    const parsed = await parseTaskFolder(files)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].referenceBlobs.get('../_shared/abc.png')).toBeInstanceOf(Blob)
  })

  it('handles _shared/ at the top level when the task folder is also at top level', async () => {
    const j1 = {
      task_id: 'tA', created_at: '2026-05-14T00:00:00Z', status: 'succeeded', prompt: 'a',
      request: { model: 'm', content: [] },
      result: { video_url: null, last_frame_url: null },
    }
    const files = [
      makeFile('task.json', 'tA/task.json', JSON.stringify(j1)),
      makeFile('abc.png', '_shared/abc.png', new Uint8Array([42])),
    ]
    const { parseTaskFolder } = await import('../api/importBundle')
    const parsed = await parseTaskFolder(files)
    expect(parsed[0].referenceBlobs.get('../_shared/abc.png')).toBeInstanceOf(Blob)
  })
})
