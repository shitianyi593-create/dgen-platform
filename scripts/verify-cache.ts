// scripts/verify-cache.ts
/**
 * verify-cache.ts
 *
 * Empirical probe for BytePlus ModelArk *implicit* context cache on the Chat API.
 * Goal: find the ACTUAL condition(s) under which
 *   usage.prompt_tokens_details.cached_tokens > 0
 * for model seed-2-0-pro (Dola Seed 2.0+, implicit cache auto-enabled).
 *
 * Both our earlier single probe and the user's manual testing saw only MISSES.
 * This script exercises four strategies (warmup burst, delay ladder,
 * conversation-growth, long-lived prefix) and prints a summary table.
 *
 * Each request is kept CHEAP: thinking disabled, max_tokens 32, non-stream.
 * COSTS REAL QUOTA (~10-12 tiny completions). Manual execution only.
 *
 * Run: npm run verify:cache
 *
 * This is a PROBE, not a gate: exit code stays 0 even if every phase misses.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }
type ChatResponse = {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  // Some ModelArk responses echo a caching field — capture it if present.
  caching?: unknown
}

/**
 * Stable >1024-token prefix mirroring verify-chat.ts's LONG_PREFIX so the two
 * scripts share a prefix history. `salt` is prepended ONCE at the very start:
 * static within a run (prefix stays stable) but unique across runs so a fresh
 * run is not polluted by a prior run's cache — except Phase 4, which passes an
 * empty salt to deliberately reuse the long-lived (previously-sent) prefix.
 */
function buildPrefix(salt: string): string {
  const body = Array.from({ length: 60 }, (_, i) =>
    `Paragraph ${i + 1}: The quick brown fox jumps over the lazy dog near the riverbank while the morning sun rises over distant mountains, casting long shadows across the quiet valley below.`,
  ).join('\n')
  return salt ? `${salt}\n${body}` : body
}

const RUN_SALT = `Session ${Date.now()}:`
const SALTED_PREFIX = buildPrefix(RUN_SALT)
// Phase 4 fallback: identical to verify-chat.ts LONG_PREFIX (no salt) — long-lived.
const UNSALTED_PREFIX = buildPrefix('')

function baseRequest(messages: Msg[]) {
  return {
    model: ENDPOINT,
    messages,
    thinking: { type: 'disabled' },
    max_tokens: 32,
  }
}

type Row = {
  phase: string
  req: string
  delaySec: number // seconds since first send of the run
  promptTokens: number
  cachedTokens: number
}
const rows: Row[] = []
let firstSendMs = 0

function record(phase: string, req: string, r: ChatResponse): number {
  const now = Date.now()
  if (firstSendMs === 0) firstSendMs = now
  const promptTokens = r.usage?.prompt_tokens ?? 0
  const cachedTokens = r.usage?.prompt_tokens_details?.cached_tokens ?? 0
  const delaySec = Math.round((now - firstSendMs) / 1000)
  rows.push({ phase, req, delaySec, promptTokens, cachedTokens })
  const mark = cachedTokens > 0 ? 'HIT ' : 'MISS'
  console.log(
    `[${mark}] ${phase} ${req}: prompt_tokens=${promptTokens} cached_tokens=${cachedTokens}` +
      (r.caching !== undefined ? ` caching=${JSON.stringify(r.caching)}` : ''),
  )
  return cachedTokens
}

/** Send one chat request and record its usage. Returns the response. */
async function send(phase: string, req: string, messages: Msg[]): Promise<ChatResponse> {
  const r = (await postJson('/chat/completions', baseRequest(messages))) as ChatResponse
  record(phase, req, r)
  return r
}

const warmupMsgs: Msg[] = [
  { role: 'system', content: SALTED_PREFIX },
  { role: 'user', content: 'Say OK' },
]

/** Phase 1 — warmup burst: same request 3x, 1s apart. */
async function phase1(): Promise<void> {
  console.log('\n=== Phase 1: warmup burst (3x same request, 1s apart) ===')
  for (let i = 1; i <= 3; i++) {
    await send('P1-warmup', `req#${i}`, warmupMsgs)
    if (i < 3) await sleep(1000)
  }
}

/** Phase 2 — delay ladder: resend the SAME request at +5/+15/+30/+60s. */
async function phase2(): Promise<void> {
  console.log('\n=== Phase 2: delay ladder (async cache-write latency) ===')
  const gaps: [number, string][] = [
    [5000, '+5s'],
    [10000, '+15s'],
    [15000, '+30s'],
    [30000, '+60s'],
  ]
  for (const [gap, label] of gaps) {
    await sleep(gap)
    await send('P2-delay', label, warmupMsgs)
  }
}

/** Phase 3 — conversation growth: growing prefix, the real chat pattern. */
async function phase3(): Promise<void> {
  console.log('\n=== Phase 3: conversation-growth probe (growing prefix) ===')
  const sys: Msg = { role: 'system', content: SALTED_PREFIX }
  const u1: Msg = { role: 'user', content: 'Continue with one short sentence.' }

  const a = await send('P3-conv', 'A(sys,u1)', [sys, u1])
  const a1 = a.choices?.[0]?.message?.content ?? 'Understood.'

  await sleep(3000)
  const u2: Msg = { role: 'user', content: 'Add one more short sentence.' }
  const b = await send('P3-conv', 'B(sys,u1,a1,u2)', [sys, u1, { role: 'assistant', content: a1 }, u2])
  const b2 = b.choices?.[0]?.message?.content ?? 'Understood.'

  await sleep(3000)
  const u3: Msg = { role: 'user', content: 'Now conclude in one short sentence.' }
  await send('P3-conv', 'C(...,u3)', [
    sys,
    u1,
    { role: 'assistant', content: a1 },
    u2,
    { role: 'assistant', content: b2 },
    u3,
  ])
}

/** Phase 4 — last resort: +120s resend, then the long-lived unsalted prefix. */
async function phase4(): Promise<void> {
  console.log('\n=== Phase 4: long-lived fallback (only run if all above missed) ===')
  console.log('waiting 120s before final salted resend...')
  await sleep(120000)
  await send('P4-late', '+120s salted', warmupMsgs)

  const unsaltedMsgs: Msg[] = [
    { role: 'system', content: UNSALTED_PREFIX },
    { role: 'user', content: 'Say OK' },
  ]
  await send('P4-late', 'unsalted', unsaltedMsgs)
}

function anyHit(): boolean {
  return rows.some((r) => r.cachedTokens > 0)
}

function printSummary(): void {
  console.log('\n================ SUMMARY ================')
  const header = ['phase', 'req', 'delay(s)', 'prompt_tok', 'cached_tok', 'result']
  const w = [10, 18, 9, 11, 11, 7]
  const fmt = (cells: (string | number)[]) =>
    cells.map((c, i) => String(c).padEnd(w[i])).join('| ')
  console.log(fmt(header))
  console.log('-'.repeat(w.reduce((a, b) => a + b + 2, 0)))
  for (const r of rows) {
    console.log(
      fmt([r.phase, r.req, r.delaySec, r.promptTokens, r.cachedTokens, r.cachedTokens > 0 ? 'HIT' : 'MISS']),
    )
  }
  console.log('========================================')
  console.log(
    anyHit()
      ? '✅ implicit cache HIT observed in at least one phase (see table).'
      : '⚠️ ALL phases MISSED (cached_tokens=0 everywhere). Not-guaranteed hits are per-doc normal behavior; see report for plausible causes.',
  )
}

async function runPhase(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    console.error(`${name} FAILED:`, e instanceof Error ? e.message : e)
  }
}

async function main(): Promise<void> {
  console.log(`Model endpoint: ${ENDPOINT}`)
  console.log(`Run salt: ${RUN_SALT}`)
  console.log(`Salted prefix length (chars): ${SALTED_PREFIX.length}`)

  await runPhase('Phase 1', phase1)
  await runPhase('Phase 2', phase2)
  await runPhase('Phase 3', phase3)

  if (!anyHit()) {
    await runPhase('Phase 4', phase4)
  } else {
    console.log('\n(Phase 4 skipped: a hit was already observed above.)')
  }

  printSummary()
  // Probe, not a gate — always exit 0.
  process.exitCode = 0
}

void main()
