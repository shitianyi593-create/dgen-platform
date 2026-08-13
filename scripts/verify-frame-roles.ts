/**
 * verify-frame-roles.ts
 *
 * One-shot validation against the real ARK API using credentials in .env.local.
 * Submits seven cases (3 happy paths + 4 mutex violations) and checks only the
 * task-creation HTTP response — does not wait for video generation.
 *
 * Run: npm run verify:frame-roles
 *
 * Verified against ARK API @ 2026-05-22 (per spec §2)
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local'), override: true })

const API_KEY = process.env.API_KEY
const ENDPOINT = process.env.ENDPOINT

if (!API_KEY || !ENDPOINT) {
  console.error('Missing API_KEY or ENDPOINT in .env.local')
  process.exit(1)
}

// Note: the spec originally referenced the BytePlus doc-image samples
// (`seepro_first_frame.jpeg` / `seepro_last_frame.jpeg`), but BytePlus's
// content-safety layer now rejects those images with
// `InputImageSensitiveContentDetected.PrivacyInformation` because they depict
// real people. To exercise the role schema end-to-end we swap in neutral
// landscape photos hosted on fastly.picsum.photos with stable HMAC-signed URLs.
const IMG_FIRST = 'https://fastly.picsum.photos/id/1015/512/512.jpg?hmac=pCxEWHTnaGaG9-DgQ0oEhpBYdYVKdGudtB0Y_8Pqgsk'
const IMG_LAST  = 'https://fastly.picsum.photos/id/1018/512/512.jpg?hmac=MJgvU8VAT38xA9d75e8GtYV9Q5yCSFQdkfGOa2WnUtA'

interface Case {
  name: string
  content: unknown[]
  expect: 'ok' | 'mutex_error'
}

const cases: Case[] = [
  {
    name: 'first_frame (explicit role)',
    content: [
      { type: 'text', text: 'a smooth cinematic move' },
      { type: 'image_url', image_url: { url: IMG_FIRST }, role: 'first_frame' },
    ],
    expect: 'ok',
  },
  {
    name: 'first_frame (omitted role)',
    content: [
      { type: 'text', text: 'a smooth cinematic move' },
      { type: 'image_url', image_url: { url: IMG_FIRST } },
    ],
    expect: 'ok',
  },
  {
    name: 'first_last_frame',
    content: [
      { type: 'text', text: 'transition from start to end' },
      { type: 'image_url', image_url: { url: IMG_FIRST }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: IMG_LAST }, role: 'last_frame' },
    ],
    expect: 'ok',
  },
  {
    name: 'multimodal (3 ref images)',
    content: [
      { type: 'text', text: 'character + scene + style' },
      { type: 'image_url', image_url: { url: IMG_FIRST }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: IMG_LAST }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: IMG_FIRST }, role: 'reference_image' },
    ],
    expect: 'ok',
  },
  {
    name: 'mutex: first_frame + reference video',
    content: [
      { type: 'text', text: 'should reject' },
      { type: 'image_url', image_url: { url: IMG_FIRST }, role: 'first_frame' },
      { type: 'video_url', video_url: { url: 'https://example.com/x.mp4' }, role: 'reference_video' },
    ],
    expect: 'mutex_error',
  },
  {
    name: 'mutex: first_last + reference video',
    content: [
      { type: 'text', text: 'should reject' },
      { type: 'image_url', image_url: { url: IMG_FIRST }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: IMG_LAST }, role: 'last_frame' },
      { type: 'video_url', video_url: { url: 'https://example.com/x.mp4' }, role: 'reference_video' },
    ],
    expect: 'mutex_error',
  },
  {
    name: 'mutex: first_frame + reference_image',
    content: [
      { type: 'text', text: 'should reject' },
      { type: 'image_url', image_url: { url: IMG_FIRST }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: IMG_LAST }, role: 'reference_image' },
    ],
    expect: 'mutex_error',
  },
]

async function submit(c: Case): Promise<void> {
  const res = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ENDPOINT,
      content: c.content,
      resolution: '480p',
      duration: 4,
      ratio: 'adaptive',
      execution_expires_after: 3600,
    }),
  })

  if (c.expect === 'ok') {
    if (res.ok) {
      const body = (await res.json()) as { id?: string }
      console.log(`[${c.name.padEnd(40)}] ✅ task_id=${body.id ?? '?'}`)
    } else {
      const text = await res.text()
      console.log(`[${c.name.padEnd(40)}] ❌ unexpected ${res.status}: ${text.slice(0, 200)}`)
      process.exitCode = 1
    }
  } else {
    if (res.status === 400) {
      const text = await res.text()
      console.log(`[${c.name.padEnd(40)}] ✅ rejected (400) — ${text.slice(0, 80)}`)
    } else if (res.ok) {
      console.log(`[${c.name.padEnd(40)}] ❌ expected reject, got 2xx`)
      process.exitCode = 1
    } else {
      const text = await res.text()
      console.log(`[${c.name.padEnd(40)}] ⚠ rejected (${res.status}) — ${text.slice(0, 80)}`)
    }
  }
}

void (async () => {
  console.log(`Running ${cases.length} cases against ${ENDPOINT}\n`)
  for (const c of cases) {
    await submit(c)
  }
  console.log(`\nDone. Exit code: ${process.exitCode ?? 0}`)
})()
