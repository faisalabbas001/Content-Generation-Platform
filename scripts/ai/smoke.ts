/**
 * AI smoke test — verifies the CEO/COO/CCO/DeepSeek wrappers are wired correctly.
 *
 * Usage:
 *   pnpm ai:smoke              # all four agents
 *   pnpm ai:smoke -- --only ceo,coo  # subset
 *   pnpm ai:smoke -- --no-db   # skip Supabase logging (offline)
 *
 * What it does:
 *   1. Loads .env.local (via dotenv).
 *   2. Verifies all four prompts resolve (env-var or prompts/ folder).
 *   3. For each enabled agent, sends a minimal valid input.
 *   4. Validates the response with the Zod schema.
 *   5. Confirms a usage_logs row was written (when db=on).
 *   6. Prints a summary table with cost + duration.
 *
 * Design choices:
 *   - Tiny inputs to keep cost negligible (~$0.01 total).
 *   - One agent per call, one call per agent — this isn't a load test.
 *   - Always uses `flow_id: 'smoke_test'` so the rows are easy to filter later.
 */
import { loadEnv } from '../db/lib/env'
loadEnv()
import { adminClient, isDbConfigured } from '@repo/db/client'
import { ceo, coo, cco, deepseek, isPromptConfigured } from '@repo/ai'
import type { Db } from '@repo/db/client'

interface AgentResult {
  agent: 'ceo' | 'coo' | 'cco' | 'deepseek'
  ok: boolean
  duration_ms: number
  cost_usd?: number
  error?: string
  detail?: string
}

const SMOKE_FLOW_ID = 'smoke_test'
const SMOKE_BRAND_ID = '11111111-1111-1111-1111-111111111111' // matches the seeded F&B dev brand

async function main() {
  const args = process.argv.slice(2)
  const onlyArg = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)
  const noDb = args.includes('--no-db')
  const enabled = new Set(
    onlyArg ? onlyArg.split(',') : ['ceo', 'coo', 'cco', 'deepseek'],
  )

  console.log('OGz Studios — AI smoke test')
  console.log('═════════════════════════════════════════')
  checkPrompts()
  console.log('')

  const db: Db | null = !noDb && isDbConfigured() ? adminClient() : null
  if (!db) console.log('  ⚠ Supabase not configured (or --no-db) — skipping usage_logs writes')

  const results: AgentResult[] = []

  if (enabled.has('ceo'))      results.push(await runCeo(db))
  if (enabled.has('coo'))      results.push(await runCoo(db))
  if (enabled.has('cco'))      results.push(await runCco(db))
  if (enabled.has('deepseek')) results.push(await runDeepSeek(db))

  console.log('')
  printSummary(results)
  if (db) await verifyUsageLogs(db, results)
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) process.exit(1)
}

function checkPrompts() {
  const keys = ['CEO_SYSTEM_PROMPT', 'COO_SYSTEM_PROMPT', 'CCO_SYSTEM_PROMPT', 'DEEPSEEK_SYSTEM_PROMPT'] as const
  for (const k of keys) {
    const ok = isPromptConfigured(k)
    console.log(`  ${ok ? '✓' : '✗'} ${k.padEnd(28)} ${ok ? '(env or prompts/)' : '(MISSING — set env or place file in prompts/)'}`)
  }
}

async function runCeo(db: Db | null): Promise<AgentResult> {
  const t0 = Date.now()
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { agent: 'ceo', ok: false, duration_ms: 0, error: 'ANTHROPIC_API_KEY not set in .env.local' }
  }
  try {
    const decision = await ceo.classify(
      {
        flow_id: 'N8N-A02',
        request_type: 'calendar_ondemand',
        brand_id: SMOKE_BRAND_ID,
        trigger_payload: { source: 'smoke_test' },
        evidence_bundle_states: {
          arabic_dialect: 'inferred_high',
          brand_differentiator: 'explicitly_confirmed',
          price_position: 'explicitly_confirmed',
          primary_channel: 'explicitly_confirmed',
          ramadan_relevance: 'inferred_high',
          'primary_audience.gender': 'inferred_medium',
          primary_kpi_type: 'explicitly_confirmed',
          religious_sensitivity: 'inferred_medium',
          tone_anti_attribute_ids: 'explicitly_confirmed',
          bilingual_ratio: 'explicitly_confirmed',
        },
        occasion_flags: ['none'],
        current_month_spend_usd: 5.0,
        monthly_ceiling_usd: 50.0,
      },
      { flow_id: SMOKE_FLOW_ID, brand_id: SMOKE_BRAND_ID, db },
    )
    return {
      agent: 'ceo', ok: true, duration_ms: Date.now() - t0,
      detail: `mode=${decision.confidence_mode} dispatch=[${decision.agents_to_dispatch.join(',')}] gate=${decision.human_gate_required}`,
    }
  } catch (e) {
    return { agent: 'ceo', ok: false, duration_ms: Date.now() - t0, error: (e as Error).message }
  }
}

async function runCoo(db: Db | null): Promise<AgentResult> {
  const t0 = Date.now()
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { agent: 'coo', ok: false, duration_ms: 0, error: 'ANTHROPIC_API_KEY not set in .env.local' }
  }
  try {
    const ctx = await coo.compileCaptionContext(
      {
        confidence_mode: 'Standard',
        occasion_flags: ['none'],
        platform_spec: 'Instagram 1080x1080, bottom-third safe zone, caption ≤220 chars',
        content_mix: { emotional: 0.4, lifestyle: 0.35, offer: 0.25 },
        post_count: 20,
        brand: {
          brand_name_ar: 'مطعم نجد',
          brand_name_en: 'Najd Restaurant',
          sector: 'F&B',
          subsector: 'casual_dining',
          city_primary: 'Riyadh',
          arabic_dialect: 'Najdi',
          price_position: 'mid_market',
          formality_level: 'casual',
          humor_tolerance: 'light',
          religious_sensitivity: 'Medium',
          bilingual_ratio: 'arabic_primary',
          tone_attribute_ids: ['warm', 'family_focused', 'proud_saudi'],
          tone_anti_attribute_ids: ['aggressive', 'western_casual'],
          brand_differentiator: 'authentic Najdi home-style cooking served by Saudi family staff',
        },
        negative_patterns: [
          { text: 'استمتع بالعروض', severity: 'SOFT_WARN' },
          { text: 'حصري لفترة محدودة', severity: 'STRONG_WARN' },
        ],
      },
      { flow_id: SMOKE_FLOW_ID, brand_id: SMOKE_BRAND_ID, db },
    )
    return {
      agent: 'coo', ok: true, duration_ms: Date.now() - t0,
      detail: `tokens=${ctx.token_count} layers=[${ctx.layers_included.join(',')}] watermark=${ctx.watermark_flag}`,
    }
  } catch (e) {
    return { agent: 'coo', ok: false, duration_ms: Date.now() - t0, error: (e as Error).message }
  }
}

async function runCco(db: Db | null): Promise<AgentResult> {
  const t0 = Date.now()
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return { agent: 'cco', ok: false, duration_ms: 0, error: 'OPENAI_API_KEY not set in .env.local' }
  }
  try {
    const evals = await cco.qcCaptions(
      {
        brand_id: SMOKE_BRAND_ID,
        caption_context_excerpt:
          'Brand: Najd Restaurant (مطعم نجد), F&B casual dining in Riyadh. Dialect: Najdi. ' +
          'Tone: warm, family_focused, proud_saudi. Avoid: aggressive, western_casual. ' +
          'Anti-attributes: stiff translation smell, English marketing clichés, "حصري"/"محدود".',
        posts: [
          {
            post_id: 'smoke_001',
            caption_ar: 'بيت نجد يجمعكم الليلة على قهوة سعودية وتمر — تعالوا تذوّقوا الجلسة الأصيلة.',
            content_type: 'lifestyle',
            posting_time: '19:30',
          },
          {
            post_id: 'smoke_002',
            caption_ar: 'استمتع بخصوماتنا الحصرية المحدودة! اكتشف سحر النكهات.',
            content_type: 'offer',
            posting_time: '20:00',
          },
        ],
      },
      { flow_id: SMOKE_FLOW_ID, brand_id: SMOKE_BRAND_ID, db },
    )
    const scores = evals.map((e) => `${e.post_id}:${e.score}`).join(' ')
    return {
      agent: 'cco', ok: true, duration_ms: Date.now() - t0,
      detail: `evaluations=${evals.length} ${scores}`,
    }
  } catch (e) {
    const err = e as Error & { lastError?: { status?: number; error?: { message?: string } } }
    const inner = err.lastError?.error?.message ?? err.lastError?.status
    return {
      agent: 'cco',
      ok: false,
      duration_ms: Date.now() - t0,
      error: inner ? `${err.message} — ${inner}` : err.message,
    }
  }
}

async function runDeepSeek(db: Db | null): Promise<AgentResult> {
  const t0 = Date.now()
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    return { agent: 'deepseek', ok: false, duration_ms: 0, error: 'DEEPSEEK_API_KEY not set in .env.local' }
  }
  try {
    const r = await deepseek.generate(
      {
        brand_id: SMOKE_BRAND_ID,
        month: '2026-05',
        post_count: 3, // tiny smoke batch
        caption_context:
          'Brand: مطعم نجد / Najd Restaurant — F&B casual dining, Riyadh. Dialect: Najdi. ' +
          'Tone: warm, family-focused, proud Saudi. Voice: direct, hospitable. ' +
          'Avoid: aggressive CTAs, translation smell ("استمتع", "حصري"). ' +
          'Content mix: 40% emotional, 35% lifestyle, 25% offer. ' +
          'Platform: Instagram 1080x1080, caption ≤220 chars. Bilingual ratio: arabic_primary.',
        watermark_required: false,
      },
      { flow_id: SMOKE_FLOW_ID, brand_id: SMOKE_BRAND_ID, db },
    )
    const types = r.posts.map((p) => p.content_type).join(',')
    return {
      agent: 'deepseek', ok: true, duration_ms: Date.now() - t0,
      detail: `posts=${r.posts.length} types=[${types}]`,
    }
  } catch (e) {
    return { agent: 'deepseek', ok: false, duration_ms: Date.now() - t0, error: (e as Error).message }
  }
}

function printSummary(results: AgentResult[]) {
  console.log('Summary')
  console.log('─────────────────────────────────────────')
  for (const r of results) {
    const status = r.ok ? '✓' : '✗'
    const time = `${(r.duration_ms / 1000).toFixed(1)}s`.padStart(6)
    console.log(`  ${status} ${r.agent.padEnd(8)} ${time}  ${r.detail ?? r.error ?? ''}`)
  }
  if (process.env.AI_SMOKE_DEBUG) {
    console.log('\nFor more detail set AI_SMOKE_DEBUG=1 (already on).')
    for (const r of results) {
      if (!r.ok && r.error) console.log(`  [${r.agent}] full error: ${r.error}`)
    }
  }
}

async function verifyUsageLogs(_db: Db, results: AgentResult[]) {
  // Use direct Postgres (not the anon-keyed Supabase client) so we bypass RLS.
  // This is the same path the migrate/seed scripts use.
  const { Client } = await import('pg')
  const conn = process.env.SUPABASE_DB_URL
  if (!conn) {
    console.log('\n  ⚠ SUPABASE_DB_URL not set — skipping usage_logs verification.')
    return
  }
  const c = new Client({ connectionString: conn })
  try {
    await c.connect()
    const usage = await c.query<{ node_name: string; cost_usd: string; duration_ms: number; payload: { attempt?: number; failed?: boolean } | null }>(
      `select node_name, cost_usd, duration_ms, payload
         from public.usage_logs
        where flow_id = $1
          and created_at >= now() - interval '60 seconds'
        order by created_at desc`,
      [SMOKE_FLOW_ID],
    )
    const anomalies = await c.query<{ anomaly_type: string; severity: string }>(
      `select anomaly_type, severity
         from public.anomaly_records
        where (details->>'flow_id') = $1
          and created_at >= now() - interval '60 seconds'`,
      [SMOKE_FLOW_ID],
    )

    console.log('\nObservability verification (direct pg — bypasses RLS)')
    console.log('─────────────────────────────────────────')
    console.log(`  usage_logs:       ${usage.rowCount} rows`)
    console.log(`  anomaly_records:  ${anomalies.rowCount} rows`)
    if (usage.rowCount && usage.rowCount > 0) {
      const total = usage.rows.reduce((acc, r) => acc + Number(r.cost_usd ?? 0), 0)
      console.log(`  Total cost (this run): $${total.toFixed(4)} USD`)
      for (const r of usage.rows) {
        const tag = r.payload?.failed ? 'fail' : 'ok'
        console.log(`    · ${r.node_name.padEnd(8)} attempt=${r.payload?.attempt ?? '?'} ${tag.padEnd(4)} $${Number(r.cost_usd).toFixed(4)} ${r.duration_ms}ms`)
      }
    }
    // Sanity: each successful agent should have ≥1 successful (non-failed) usage_logs row.
    const successes = results.filter((r) => r.ok).map((r) => r.agent)
    for (const agent of successes) {
      const found = usage.rows.some((r) => r.node_name === agent && !r.payload?.failed)
      if (!found) console.log(`  ⚠ Expected a successful usage_logs row for ${agent} but none was found`)
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error('smoke test crashed:', e)
  process.exit(1)
})
