// scripts/verify-chat.ts
/**
 * verify-chat.ts
 *
 * One-shot validation against the real ModelArk text APIs using .env.local.
 * Dumps raw response / SSE event shapes so src/api/{chat,responses}.ts can be
 * confirmed against reality (the Responses streaming event names are not
 * fully documented).
 *
 * COSTS REAL QUOTA. Manual execution only.
 *
 * Run: npm run verify:chat            # all cases
 *      npm run verify:chat -- --case 4   # single case (1-5)
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local'), override: true })

const API_KEY = process.env.API_KEY ?? process.env.ARK_API_KEY
const ENDPOINT =
  process.env.SEED_2_0_PRO_ENDPOINT ??
  process.env.SEED_ENDPOINT ??
  process.env.TEXT_ENDPOINT ??
  process.env.CHAT_ENDPOINT

if (!API_KEY || !ENDPOINT) {
  console.error(
    'Missing API_KEY or text endpoint in .env.local ' +
      '(accepted endpoint variables: SEED_2_0_PRO_ENDPOINT, SEED_ENDPOINT, TEXT_ENDPOINT, CHAT_ENDPOINT)',
  )
  process.exit(1)
}

const BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3'
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

/** 讀 SSE，回傳所有 data 行（含 event: 行的配對）。 */
async function postSseDump(path: string, body: unknown): Promise<string[]> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const lines: string[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '').trim()
      buf = buf.slice(nl + 1)
      if (line) lines.push(line)
    }
  }
  return lines
}

// 超過 1024 tokens 的穩定前綴（隱性 cache 命中門檻）。
const LONG_PREFIX = Array.from({ length: 60 }, (_, i) =>
  `Paragraph ${i + 1}: The quick brown fox jumps over the lazy dog near the riverbank while the morning sun rises over distant mountains, casting long shadows across the quiet valley below.`,
).join('\n')

async function case1_chatNonStream() {
  console.log('\n=== Case 1: Chat API non-stream (dump full response) ===')
  const data = await postJson('/chat/completions', {
    model: ENDPOINT,
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
  })
  console.log(JSON.stringify(data, null, 2))
}

async function case2_chatStream() {
  console.log('\n=== Case 2: Chat API stream (dump first/last chunks) ===')
  const lines = await postSseDump('/chat/completions', {
    model: ENDPOINT,
    messages: [{ role: 'user', content: 'Count from 1 to 10.' }],
    stream: true,
    stream_options: { include_usage: true },
  })
  console.log(`total data lines: ${lines.length}`)
  console.log('--- first 3 ---'); lines.slice(0, 3).forEach((l) => console.log(l))
  console.log('--- last 4 ---'); lines.slice(-4).forEach((l) => console.log(l))
}

async function case3_responsesNonStream() {
  console.log('\n=== Case 3: Responses API non-stream (dump full response) ===')
  const data = await postJson('/responses', { model: ENDPOINT, input: 'Reply with exactly: pong' }) as { id?: string }
  console.log(JSON.stringify(data, null, 2))
  // 順手驗 previous_response_id 多輪
  if (data.id) {
    await new Promise((r) => setTimeout(r, 200))
    const follow = await postJson('/responses', {
      model: ENDPOINT, input: 'Now reply with exactly: pong2', previous_response_id: data.id,
    }) as { usage?: unknown }
    console.log('--- follow-up (previous_response_id) usage ---')
    console.log(JSON.stringify(follow.usage, null, 2))
  }
}

async function case4_responsesStream() {
  console.log('\n=== Case 4: Responses API stream (dump EVENT NAMES — reconcile with src/api/responses.ts) ===')
  const lines = await postSseDump('/responses', {
    model: ENDPOINT, input: 'Count from 1 to 5.', stream: true,
  })
  console.log(`total lines: ${lines.length}`)
  const eventNames = [...new Set(lines.filter((l) => l.startsWith('event:')).map((l) => l.slice(6).trim()))]
  console.log('distinct event names:', eventNames)
  const typeNames = [...new Set(
    lines.filter((l) => l.startsWith('data:') && l.includes('"type"'))
      .map((l) => { try { return (JSON.parse(l.slice(5)) as { type?: string }).type ?? '?' } catch { return '?' } }),
  )]
  console.log('distinct data .type values:', typeNames)
  console.log('--- first 5 lines ---'); lines.slice(0, 5).forEach((l) => console.log(l.slice(0, 300)))
  console.log('--- last 5 lines ---'); lines.slice(-5).forEach((l) => console.log(l.slice(0, 300)))
}

async function case5_implicitCache() {
  console.log('\n=== Case 5: implicit cache — same >1024-token prompt twice ===')
  const body = {
    model: ENDPOINT,
    messages: [
      { role: 'system', content: LONG_PREFIX },
      { role: 'user', content: 'Summarize the above in one sentence.' },
    ],
  }
  type Usage = { usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }
  const r1 = await postJson('/chat/completions', body) as Usage
  console.log('run 1 usage:', JSON.stringify(r1.usage))
  await new Promise((r) => setTimeout(r, 1500))
  const r2 = await postJson('/chat/completions', body) as Usage
  console.log('run 2 usage:', JSON.stringify(r2.usage))
  const cached = r2.usage?.prompt_tokens_details?.cached_tokens ?? 0
  console.log(cached > 0
    ? `✅ implicit cache HIT on run 2 (cached_tokens=${cached})`
    : '⚠️ run 2 did not hit cache（不保證命中是正常行為；prompt_tokens ≥1024 才有機會）')
}

const CASES = [case1_chatNonStream, case2_chatStream, case3_responsesNonStream, case4_responsesStream, case5_implicitCache]

async function main() {
  const idx = process.argv.indexOf('--case')
  const only = idx !== -1 ? Number(process.argv[idx + 1]) : null
  for (let i = 0; i < CASES.length; i++) {
    if (only !== null && only !== i + 1) continue
    try { await CASES[i]() } catch (e) {
      console.error(`Case ${i + 1} FAILED:`, e instanceof Error ? e.message : e)
      process.exitCode = 1
    }
  }
}

void main()
