/**
 * Appliers for the four BRAND-scoped nomination types.
 *
 * Every function:
 *   - Assumes validation has already passed (validate.ts)
 *   - Performs the actual SQL write via service-role db client
 *   - Returns { ok, applied_to } or { ok: false, reason }
 *
 * Hard Rule #2 enforcement boundary: this is one of only two files that ever
 * write to Layer 1 tables (the other is apply-anonymous.ts for Layer 2/3).
 * Every other module reads-only.
 */
import type { Db } from '@repo/db/client'
import { CRITICAL_BRANDDNA_FIELDS } from '@repo/core'
import { getSharedPgClient } from './pg-bypass'
import {
  ALLOWED_FIELD_PATHS,
  type FieldUpdateData,
  type ConfidenceUpgradeData,
  type NegativePatternAddData,
  type OverrideRuleAddData,
  type MethodProfileUpdateData,
} from './types'

const CRITICAL_FIELD_SET = new Set<string>(CRITICAL_BRANDDNA_FIELDS)
function isCriticalBrandColumn(column: string): boolean {
  return CRITICAL_FIELD_SET.has(column)
}

/**
 * Direct-pg fallback used when reading/writing Layer 1 tables. validate.ts
 * uses the same shared client (pg-bypass.ts → getSharedPgClient) so the
 * entire Memory Controller funnels through ONE TCP connection per process —
 * critical for batch jobs that process 50+ nominations.
 */
const getPgClient = getSharedPgClient

interface ApplyOk {
  ok: true
  applied_to: string
}
interface ApplyFail {
  ok: false
  reason: string
}
type ApplyResult = ApplyOk | ApplyFail

// ─────────────────────────────────────────────────────────────────────────
// 1. field_update — write a Layer 1 column
// ─────────────────────────────────────────────────────────────────────────
export async function applyFieldUpdate(
  db: Db,
  brand_id: string,
  data: FieldUpdateData,
): Promise<ApplyResult> {
  const meta = (ALLOWED_FIELD_PATHS as Record<string, { table: string; column: string }>)[data.field_path]!
  const pg = await getPgClient()

  if (meta.table === 'brand_profiles') {
    // Guard: cultural_tension_owned must be unique per (sector, city_primary) per
    // spec §4.2. Before writing, check cultural_tension_registry to prevent two
    // brands from claiming the same tension in the same market.
    if (meta.column === 'cultural_tension_owned' && data.proposed_value) {
      const tensionText = String(data.proposed_value).trim().toLowerCase()
      // Fetch this brand's sector + city so we can scope the uniqueness check
      const { data: brandCtx } = await db
        .from('brand_profiles')
        .select('sector, city_primary')
        .eq('brand_id', brand_id)
        .maybeSingle()
      if (brandCtx) {
        const { data: conflicting } = await db
          .from('cultural_tension_registry' as never)
          .select('brand_id, tension_text')
          .eq('sector' as never, (brandCtx as { sector: string }).sector)
          .eq('is_active' as never, true)
          .neq('brand_id' as never, brand_id)
          .limit(20)
        const existingTensions = ((conflicting ?? []) as unknown as Array<{ tension_text: string; brand_id: string }>)
        const clash = existingTensions.find(
          (r) => r.tension_text.toLowerCase() === tensionText,
        )
        if (clash) {
          return { ok: false, reason: `cultural_tension_owned: tension "${tensionText}" is already claimed by another brand in this sector` }
        }
        // Upsert into registry so future checks can find this brand's claim
        await db.from('cultural_tension_registry' as never).upsert({
          brand_id,
          tension_text: tensionText,
          sector: (brandCtx as { sector: string }).sector,
          city_primary: (brandCtx as { city_primary: string | null }).city_primary,
          claimed_at: new Date().toISOString(),
          is_active: true,
        } as never, { onConflict: 'brand_id' })
      }
    }

    if (pg) {
      try {
        // For jsonb columns, node-postgres needs the value cast explicitly —
        // passing a JS array/object as $1 sends it as a Postgres array literal
        // which is invalid for jsonb. Serialise to JSON string and cast.
        const fullMeta = (ALLOWED_FIELD_PATHS as Record<string, { table: string; column: string; type?: string }>)[data.field_path]
        const isJsonb = fullMeta?.type === 'jsonb'
        const pgValue = isJsonb ? JSON.stringify(data.proposed_value) : data.proposed_value
        const cast    = isJsonb ? '::jsonb' : ''
        await pg.query(
          `update brand_profiles set ${quoteIdent(meta.column)} = $1${cast}, updated_at = now() where brand_id = $2`,
          [pgValue, brand_id],
        )
        await maybeLinkSectorBaseline(db, brand_id, meta.column, pg)
        if (isCriticalBrandColumn(meta.column)) {
          // Client confirmation → upgrade evidence_bundles to explicitly_confirmed
          // so the profile completeness score and confidence display reflect the
          // human-verified state immediately.
          if (data.source === 'client_confirmation') {
            await upsertEvidenceConfidence(db, brand_id, meta.column, pg)
          }
          await refreshCompletenessScore(db, brand_id, pg)
        }
        return { ok: true, applied_to: `brand_profiles.${meta.column}` }
      } catch (e) {
        return { ok: false, reason: `pg update brand_profiles failed: ${(e as Error).message}` }
      }
    }
    const { error } = await db
      .from('brand_profiles')
      .update({ [meta.column]: data.proposed_value, updated_at: new Date().toISOString() } as never)
      .eq('brand_id', brand_id)
    if (error) return { ok: false, reason: `update brand_profiles failed: ${error.message}` }
    await maybeLinkSectorBaseline(db, brand_id, meta.column, null)
    if (isCriticalBrandColumn(meta.column)) {
      if (data.source === 'client_confirmation') {
        await upsertEvidenceConfidence(db, brand_id, meta.column, null)
      }
      await refreshCompletenessScore(db, brand_id, null)
    }
    return { ok: true, applied_to: `brand_profiles.${meta.column}` }
  }

  if (meta.table === 'audience_profiles' || meta.table === 'visual_style_profiles') {
    if (pg) {
      try {
        const fullMeta2 = (ALLOWED_FIELD_PATHS as Record<string, { table: string; column: string; type?: string }>)[data.field_path]
        const isJsonb2  = fullMeta2?.type === 'jsonb'
        const pgValue2  = isJsonb2 ? JSON.stringify(data.proposed_value) : data.proposed_value
        const cast2     = isJsonb2 ? '::jsonb' : ''
        await pg.query(
          `insert into ${quoteIdent(meta.table)} (brand_id, ${quoteIdent(meta.column)}) values ($1, $2${cast2})
           on conflict (brand_id) do update set ${quoteIdent(meta.column)} = excluded.${quoteIdent(meta.column)}`,
          [brand_id, pgValue2],
        )
        return { ok: true, applied_to: `${meta.table}.${meta.column}` }
      } catch (e) {
        return { ok: false, reason: `pg upsert ${meta.table} failed: ${(e as Error).message}` }
      }
    }
    const { error } = await db
      .from(meta.table)
      .upsert({ brand_id, [meta.column]: data.proposed_value } as never, { onConflict: 'brand_id' })
    if (error) return { ok: false, reason: `upsert ${meta.table} failed: ${error.message}` }
    return { ok: true, applied_to: `${meta.table}.${meta.column}` }
  }

  return { ok: false, reason: `no applier for table ${meta.table}` }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. confidence_upgrade — bump evidence_bundles.field_confidence
// ─────────────────────────────────────────────────────────────────────────
export async function applyConfidenceUpgrade(
  db: Db,
  brand_id: string,
  data: ConfidenceUpgradeData,
): Promise<ApplyResult> {
  const pg = await getPgClient()
  if (pg) {
    try {
      await pg.query(
        `insert into evidence_bundles
           (brand_id, field_name, field_confidence, supporting_source_ids, agreement_ratio, last_evaluated)
         values ($1, $2, $3, $4, $5, now())
         on conflict (brand_id, field_name) do update
           set field_confidence       = excluded.field_confidence,
               supporting_source_ids  = excluded.supporting_source_ids,
               agreement_ratio        = excluded.agreement_ratio,
               last_evaluated         = excluded.last_evaluated`,
        [brand_id, data.field_name, data.new_state, data.evidence_source_ids, data.agreement_ratio ?? 1],
      )
      // Doc §4.5 — recompute the cached completeness score so /profile
      // and /snapshot reflect the new evidence state immediately.
      await refreshCompletenessScore(db, brand_id, pg)
      return { ok: true, applied_to: `evidence_bundles.${data.field_name}` }
    } catch (e) {
      return { ok: false, reason: `pg upsert evidence_bundles failed: ${(e as Error).message}` }
    }
  }
  const { error } = await db
    .from('evidence_bundles')
    .upsert(
      {
        brand_id,
        field_name: data.field_name,
        field_confidence: data.new_state,
        supporting_source_ids: data.evidence_source_ids,
        agreement_ratio: data.agreement_ratio ?? 1,
        last_evaluated: new Date().toISOString(),
      } as never,
      { onConflict: 'brand_id,field_name' },
    )
  if (error) return { ok: false, reason: `upsert evidence_bundles failed: ${error.message}` }
  await refreshCompletenessScore(db, brand_id, null)
  return { ok: true, applied_to: `evidence_bundles.${data.field_name}` }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. negative_pattern_add — insert a per-brand row
// ─────────────────────────────────────────────────────────────────────────
export async function applyNegativePatternAdd(
  db: Db,
  brand_id: string,
  data: NegativePatternAddData,
): Promise<ApplyResult> {
  const pg = await getPgClient()
  const reasoning = data.reasoning ?? null
  const source = data.source ?? 'admin'
  if (pg) {
    try {
      // ON CONFLICT on the unique index (brand_id, lower(pattern_text)) added
      // in migration 0041 — upserts severity/reasoning if pattern already exists.
      await pg.query(
        `insert into negative_patterns (brand_id, pattern_text, severity, reasoning, source)
         values ($1::uuid, $2, $3::negpat_severity_type, $4, $5)
         on conflict (brand_id, lower(pattern_text))
         do update set severity = excluded.severity,
                       reasoning = excluded.reasoning,
                       updated_at = now()`,
        [brand_id, data.pattern_text, data.severity, reasoning, source],
      )
      return { ok: true, applied_to: 'negative_patterns' }
    } catch (e) {
      return { ok: false, reason: `pg insert negative_patterns failed: ${(e as Error).message}` }
    }
  }
  // JS-client fallback (no pg connection). The unique constraint is expression-
  // based (lower(pattern_text)) so PostgREST can't resolve it via column names.
  // Plain insert is correct — a duplicate (23505) means the row already exists,
  // which is fine. Any other error is a real failure.
  const { error } = await db.from('negative_patterns').insert(
    { brand_id, pattern_text: data.pattern_text, severity: data.severity, reasoning, source } as never,
  )
  if (error && error.code !== '23505') return { ok: false, reason: `insert negative_patterns failed: ${error.message}` }
  return { ok: true, applied_to: 'negative_patterns' }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. override_rule_add — insert / replace a rule
// ─────────────────────────────────────────────────────────────────────────
export async function applyOverrideRuleAdd(
  db: Db,
  brand_id: string,
  data: OverrideRuleAddData,
): Promise<ApplyResult> {
  const pg = await getPgClient()
  const description = data.description ?? null
  const reasoning = data.reasoning ?? null
  if (pg) {
    try {
      // ON CONFLICT on unique index (brand_id, rule_key) added in migration 0041.
      await pg.query(
        `insert into override_rules (brand_id, rule_key, rule_value, description, reasoning)
         values ($1, $2, $3::jsonb, $4, $5)
         on conflict (brand_id, rule_key)
         do update set rule_value  = excluded.rule_value,
                       description = excluded.description,
                       reasoning   = excluded.reasoning,
                       updated_at  = now()`,
        [brand_id, data.rule_key, JSON.stringify(data.rule_value), description, reasoning],
      )
      return { ok: true, applied_to: `override_rules.${data.rule_key}` }
    } catch (e) {
      return { ok: false, reason: `pg upsert override_rules failed: ${(e as Error).message}` }
    }
  }
  // JS-client fallback. override_rules has a named unique constraint on
  // (brand_id, rule_key) — PATCH the existing row if it already exists,
  // insert otherwise. This two-step is safe because only one user writes
  // their own brand's rules (no race between different users).
  const { data: existing } = await db.from('override_rules')
    .select('rule_id')
    .eq('brand_id', brand_id)
    .eq('rule_key', data.rule_key)
    .maybeSingle()
  if (existing) {
    const { error } = await db.from('override_rules')
      .update({ rule_value: data.rule_value, description, reasoning, updated_at: new Date().toISOString() } as never)
      .eq('rule_id', (existing as { rule_id: string }).rule_id)
    if (error) return { ok: false, reason: `update override_rules failed: ${error.message}` }
  } else {
    const { error } = await db.from('override_rules')
      .insert({ brand_id, rule_key: data.rule_key, rule_value: data.rule_value, description, reasoning } as never)
    if (error && error.code !== '23505') return { ok: false, reason: `insert override_rules failed: ${error.message}` }
  }
  return { ok: true, applied_to: `override_rules.${data.rule_key}` }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. method_profile_update — v2 creative-direction layer
// ─────────────────────────────────────────────────────────────────────────
/**
 * Upsert brand_method_profiles + append a row to brand_method_profile_history.
 * Two writes, but the history append is best-effort — if it fails we log and
 * continue (the live row is the source of truth; history is audit).
 *
 * Hard Rule #2: this is the ONLY code path that writes to
 * brand_method_profiles. The route handler calls Memory Controller's
 * processQueue which dispatches to this applier.
 */
export async function applyMethodProfileUpdate(
  db: Db,
  brand_id: string,
  data: MethodProfileUpdateData,
): Promise<ApplyResult> {
  const pg = await getPgClient()

  const blendJson = JSON.stringify(data.composition_blend)

  if (pg) {
    try {
      // 1. Upsert the live profile
      await pg.query(
        `insert into brand_method_profiles
           (brand_id, voice_register, diagnostic_pattern, visual_idiom,
            cadence_rule, closing_pattern, composition_blend,
            composition_score, creative_direction_text, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now())
         on conflict (brand_id) do update
           set voice_register          = excluded.voice_register,
               diagnostic_pattern      = excluded.diagnostic_pattern,
               visual_idiom            = excluded.visual_idiom,
               cadence_rule            = excluded.cadence_rule,
               closing_pattern         = excluded.closing_pattern,
               composition_blend       = excluded.composition_blend,
               composition_score       = excluded.composition_score,
               creative_direction_text = excluded.creative_direction_text,
               updated_at              = now()`,
        [
          brand_id,
          data.voice_register,
          data.diagnostic_pattern,
          data.visual_idiom,
          data.cadence_rule,
          data.closing_pattern,
          blendJson,
          data.composition_score,
          data.creative_direction_text,
        ],
      )

      // 2. Append history row (best-effort)
      try {
        await pg.query(
          `insert into brand_method_profile_history
             (brand_id, voice_register, diagnostic_pattern, visual_idiom,
              cadence_rule, closing_pattern, composition_blend,
              composition_score, creative_direction_text,
              change_reason, changed_by)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
          [
            brand_id,
            data.voice_register,
            data.diagnostic_pattern,
            data.visual_idiom,
            data.cadence_rule,
            data.closing_pattern,
            blendJson,
            data.composition_score,
            data.creative_direction_text,
            data.change_reason,
            'memory_controller',
          ],
        )
      } catch (e) {
        console.warn(`[memory] method_profile history append failed: ${(e as Error).message}`)
      }

      return { ok: true, applied_to: `brand_method_profiles.${brand_id}` }
    } catch (e) {
      return { ok: false, reason: `pg upsert brand_method_profiles failed: ${(e as Error).message}` }
    }
  }

  // Supabase JS client fallback (works because new tables are typed via
  // database.types.ts after pnpm db:types).
  const { error } = await db.from('brand_method_profiles').upsert(
    {
      brand_id,
      voice_register:          data.voice_register,
      diagnostic_pattern:      data.diagnostic_pattern,
      visual_idiom:            data.visual_idiom,
      cadence_rule:            data.cadence_rule,
      closing_pattern:         data.closing_pattern,
      composition_blend:       data.composition_blend,
      composition_score:       data.composition_score,
      creative_direction_text: data.creative_direction_text,
    } as never,
    { onConflict: 'brand_id' },
  )
  if (error) return { ok: false, reason: `upsert brand_method_profiles failed: ${error.message}` }

  // History append (best-effort)
  await db.from('brand_method_profile_history').insert({
    brand_id,
    voice_register:          data.voice_register,
    diagnostic_pattern:      data.diagnostic_pattern,
    visual_idiom:            data.visual_idiom,
    cadence_rule:            data.cadence_rule,
    closing_pattern:         data.closing_pattern,
    composition_blend:       data.composition_blend,
    composition_score:       data.composition_score,
    creative_direction_text: data.creative_direction_text,
    change_reason:           data.change_reason,
    changed_by:              'memory_controller',
  } as never)

  return { ok: true, applied_to: `brand_method_profiles.${brand_id}` }
}

/** Quote a SQL identifier — only used for column/table names from our own
 *  whitelist (ALLOWED_FIELD_PATHS), so injection isn't a concern; this is
 *  belt-and-braces. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Upsert evidence_bundles to explicitly_confirmed after a client-confirmed
 * field_update. A human just verified the value — highest confidence state.
 * agreement_ratio=1.0, conflict_score=0.
 * Best-effort: failures are logged but don't fail the parent write.
 */
async function upsertEvidenceConfidence(
  db: Db,
  brand_id: string,
  field_name: string,
  pg: Awaited<ReturnType<typeof getPgClient>>,
): Promise<void> {
  try {
    if (pg) {
      await pg.query(
        `insert into evidence_bundles
           (brand_id, field_name, field_confidence, agreement_ratio, conflict_score, last_evaluated)
         values ($1, $2, 'explicitly_confirmed', 1.0, 0, now())
         on conflict (brand_id, field_name) do update
           set field_confidence = 'explicitly_confirmed',
               agreement_ratio  = 1.0,
               conflict_score   = 0,
               last_evaluated   = now()`,
        [brand_id, field_name],
      )
      return
    }
    await db.from('evidence_bundles').upsert(
      {
        brand_id,
        field_name,
        field_confidence:  'explicitly_confirmed',
        agreement_ratio:   1.0,
        conflict_score:    0,
        last_evaluated:    new Date().toISOString(),
      } as never,
      { onConflict: 'brand_id,field_name' },
    )
  } catch (e) {
    console.warn(`[memory] evidence_bundles confidence upgrade failed for ${brand_id}.${field_name}: ${(e as Error).message}`)
  }
}

/**
 * Recompute brand_profiles.completeness_score from current evidence state.
 * Calls the SQL function added in migration 0019, which counts qualifying
 * evidence_bundles rows for the 10 critical fields.
 *
 * Called after every Memory Controller write that could change a critical
 * field's confidence — so the score on /profile and /snapshot stays in sync
 * with actual evidence (Doc §4.5 "How BrandDNA Learns").
 *
 * Best-effort: failures here are logged but don't fail the parent write.
 * The score is a derived metric — the source of truth (evidence_bundles)
 * is already correct by the time we call this.
 */
async function refreshCompletenessScore(
  db: Db,
  brand_id: string,
  pg: Awaited<ReturnType<typeof getPgClient>>,
): Promise<void> {
  try {
    if (pg) {
      await pg.query(`select public.refresh_brand_completeness($1)`, [brand_id])
      return
    }
    // Supabase JS client RPC fallback — works for the dev path where pg
    // bypass isn't configured.
    const { error } = await (
      db as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: Error | null }>
      }
    ).rpc('refresh_brand_completeness', { p_brand_id: brand_id })
    if (error) throw error
  } catch (e) {
    console.warn(
      `[memory] completeness recompute failed for ${brand_id}: ${(e as Error).message}`,
    )
  }
}

/**
 * After we've just written `arabic_dialect` (the trigger for confirming the
 * sector,dialect tuple), link `brand_profiles.sector_baseline_id` to the
 * matching baseline row. Doc §4.1: "Once dialect confirmed, link the brand
 * to its sector baseline." Idempotent — only runs when the link is null.
 */
async function maybeLinkSectorBaseline(
  db: Db,
  brand_id: string,
  column: string,
  pg: Awaited<ReturnType<typeof getPgClient>>,
): Promise<void> {
  if (column !== 'arabic_dialect') return
  try {
    if (pg) {
      await pg.query(
        `update brand_profiles bp
            set sector_baseline_id = sb.baseline_id
           from sector_baselines sb
          where bp.brand_id = $1
            and bp.sector_baseline_id is null
            and bp.sector  = sb.sector
            and bp.arabic_dialect = sb.dialect`,
        [brand_id],
      )
      return
    }
    const { data: brand } = await db
      .from('brand_profiles')
      .select('sector, arabic_dialect, sector_baseline_id')
      .eq('brand_id', brand_id)
      .single()
    if (!brand || brand.sector_baseline_id || !brand.sector || !brand.arabic_dialect) return
    const { data: baseline } = await db
      .from('sector_baselines')
      .select('baseline_id')
      .eq('sector', brand.sector)
      .eq('dialect', brand.arabic_dialect)
      .limit(1)
      .maybeSingle()
    if (!baseline) return
    await db
      .from('brand_profiles')
      .update({ sector_baseline_id: baseline.baseline_id } as never)
      .eq('brand_id', brand_id)
  } catch (e) {
    console.warn(`[memory] sector_baseline link failed for ${brand_id}: ${(e as Error).message}`)
  }
}
