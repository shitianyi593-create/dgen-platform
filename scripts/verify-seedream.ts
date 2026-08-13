// scripts/verify-seedream.ts
/**
 * verify-seedream.ts
 *
 * One-shot validation against the real Seedream image API using credentials
 * in .env.local. Synchronous API — each case asserts on the direct response.
 * Case 1 additionally dumps the raw response JSON so the ImageGenerationResponse
 * type in src/types/image.ts can be confirmed against reality.
 *
 * COSTS REAL QUOTA (a few 1K-size images per run). Manual execution only.
 *
 * Run: npm run verify:seedream
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local'), override: true })

const API_KEY = process.env.API_KEY
const ENDPOINT =
  process.env.SEEDREAM_5_0_ENDPOINT ??
  process.env.SEEDREAM_ENDPOINT ??
  process.env.IMAGE_ENDPOINT

if (!API_KEY || !ENDPOINT) {
  console.error(
    'Missing API_KEY or image endpoint in .env.local ' +
      '(accepted endpoint variables: SEEDREAM_5_0_ENDPOINT, SEEDREAM_ENDPOINT, IMAGE_ENDPOINT)',
  )
  process.exit(1)
}

const URL_API = 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations'
// 與 verify-frame-roles 相同的中性測試圖（HMAC 簽名的穩定 URL）。
const REF_IMG = 'https://fastly.picsum.photos/id/1015/512/512.jpg?hmac=pCxEWHTnaGaG9-DgQ0oEhpBYdYVKdGudtB0Y_8Pqgsk'

interface Case {
  name: string
  body: Record<string, unknown>
  expect: 'ok' | 'error'
  dumpResponse?: boolean
}

const base = {
  model: ENDPOINT,
  response_format: 'url',
  watermark: false,
  stream: false,
}

function buildCases(refDataUri: string): Case[] {
  return [
    {
      name: 't2i preset 1K',
      body: { ...base, prompt: 'a minimalist watercolor mountain landscape', size: '1K' },
      expect: 'ok',
      dumpResponse: true,
    },
    {
      name: 't2i custom px 1280x720',
      body: { ...base, prompt: 'a minimalist watercolor lake', size: '1280x720' },
      expect: 'ok',
    },
    {
      name: 'i2i single URL ref',
      body: {
        ...base,
        prompt: 'repaint this photo in impressionist oil style',
        image: REF_IMG,
        size: '1K',
      },
      expect: 'ok',
    },
    {
      name: 'i2i base64 data URI ref (UI upload path)',
      body: {
        ...base,
        prompt: 'repaint this photo as a pencil sketch',
        image: refDataUri,
        size: '1K',
      },
      expect: 'ok',
    },
    {
      name: 'negative: size below range (100x100)',
      body: { ...base, prompt: 'x', size: '100x100' },
      expect: 'error',
    },
    {
      name: 'negative: sequential on 5.0 Pro (capability table assumption)',
      body: {
        ...base,
        prompt: 'two variations of a simple icon',
        size: '1K',
        sequential_image_generation: 'auto',
        sequential_image_generation_options: { max_images: 2 },
      },
      expect: 'error',
    },
  ]
}

async function fetchRefAsDataUri(): Promise<string> {
  const res = await fetch(REF_IMG)
  if (!res.ok) throw new Error(`ref image fetch failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

async function submit(c: Case): Promise<void> {
  const res = await fetch(URL_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(c.body),
  })
  const text = await res.text()

  if (c.expect === 'ok') {
    if (!res.ok) {
      console.log(`[${c.name.padEnd(48)}] ❌ unexpected ${res.status}: ${text.slice(0, 200)}`)
      process.exitCode = 1
      return
    }
    const json = JSON.parse(text) as { data?: Array<{ url?: string }> }
    const url = json.data?.[0]?.url
    if (typeof url === 'string' && url.startsWith('https://')) {
      console.log(`[${c.name.padEnd(48)}] ✅ ${json.data!.length} image(s), url ok`)
    } else {
      console.log(`[${c.name.padEnd(48)}] ❌ 2xx but no data[0].url — response: ${text.slice(0, 300)}`)
      process.exitCode = 1
    }
    if (c.dumpResponse) {
      console.log('--- raw response (confirm ImageGenerationResponse type) ---')
      console.log(text)
      console.log('-----------------------------------------------------------')
    }
  } else {
    if (res.status === 400) {
      console.log(`[${c.name.padEnd(48)}] ✅ rejected (400) — ${text.slice(0, 120)}`)
    } else if (res.ok) {
      console.log(`[${c.name.padEnd(48)}] ❌ expected error, got 2xx — capability assumption WRONG, update seedreamModels.ts`)
      process.exitCode = 1
    } else {
      // Non-400 rejection (e.g. 401 expired key) does NOT confirm the
      // capability/validation assumption — flag it without failing the run.
      console.log(`[${c.name.padEnd(48)}] ⚠ rejected (${res.status}) — ${text.slice(0, 120)}`)
    }
  }
}

void (async () => {
  // The base64 case needs a network fetch first, so cases are built here.
  const cases = buildCases(await fetchRefAsDataUri())
  console.log(`Running ${cases.length} Seedream cases against ${ENDPOINT}\n`)
  for (const c of cases) {
    try {
      await submit(c)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`[${c.name.padEnd(48)}] ❌ threw: ${message}`)
      process.exitCode = 1
    }
  }
  console.log(`\nDone. Exit code: ${process.exitCode ?? 0}`)
})().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`Fatal: ${message}`)
  process.exit(1)
})
