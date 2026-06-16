/**
 * Second-pass validation — runs during processing, after the row was already
 * accepted into the queue.
 *
 * The first-pass (Zod, in enqueue.ts) catches shape errors. The second-pass
 * catches semantic errors that need DB context:
 *   - referenced brand_id exists
 *   - field_path is on the whitelist
 *   - proposed_value satisfies the column's enum / regex / range
 *   - sector + global signals carry zero PII
 *
 * Returns either { ok: true, normalised: <data> } or
 *         { ok: false, code, reason }.
 *
 * IMPORTANT: this module is pure — no DB writes. Writes live in apply/*.ts.
 * Keeping validate.ts side-effect-free means we can unit-test it without a
 * database in CI.
 */
import type { Db } from '@repo/db/client'
import type { PgBypass } from './pg-bypass'
import {
  ALLOWED_FIELD_PATHS,
  type FieldUpdateData,
  type ConfidenceUpgradeData,
  type SectorSignalData,
  type GlobalSignalData,
  type Nomination,
  type RejectionCode,
} from './types'

export interface ValidationOk<T> {
  ok: true
  normalised: T
}
export interface ValidationFail {
  ok: false
  code: RejectionCode
  reason: string
}

export type ValidationResult<T> = ValidationOk<T> | ValidationFail

/**
 * Top-level dispatcher. Returns the same data shape but with normalised values.
 * `bypass` is an optional RLS-bypass adapter — supply it (via pgBypassAdapter())
 * in environments where the SUPABASE_SERVICE_ROLE_KEY isn't a real service-
 * role JWT. Production with a real service-role key passes null.
 */
export async function validateNomination(
  db: Db,
  n: Nomination,
  bypass: PgBypass | null = null,
): Promise<ValidationResult<Nomination>> {
  switch (n.nomination_type) {
    case 'field_update': {
      const r = await validateFieldUpdate(db, n.brand_id, n.data, bypass)
      return r.ok ? { ok: true, normalised: { ...n, data: r.normalised } } : r
    }
    case 'confidence_upgrade': {
      const r = await validateConfidenceUpgrade(db, n.brand_id, n.data, bypass)
      return r.ok ? { ok: true, normalised: { ...n, data: r.normalised } } : r
    }
    case 'negative_pattern_add':
    case 'override_rule_add':
    case 'method_profile_update': {
      // For these three, brand existence is the only cross-row check needed.
      // Per-field/enum validation is handled by Zod at the entry boundary.
      const exists = await brandExists(db, n.brand_id, bypass)
      if (!exists) return fail('brand_not_found', `brand_id ${n.brand_id} not found`)
      return { ok: true, normalised: n }
    }
    case 'sector_signal':
    case 'global_signal': {
      const r = validateAnonymousSignal(n.data)
      return r.ok ? { ok: true, normalised: { ...n, data: r.normalised } } : r
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Per-type validators
// ─────────────────────────────────────────────────────────────────────────

export async function validateFieldUpdate(
  db: Db,
  brand_id: string,
  data: FieldUpdateData,
  bypass: PgBypass | null = null,
): Promise<ValidationResult<FieldUpdateData>> {
  const meta = (ALLOWED_FIELD_PATHS as Record<string, AllowedFieldMeta | undefined>)[data.field_path]
  if (!meta) {
    return fail('forbidden_field_path', `field_path "${data.field_path}" is not on the whitelist`)
  }

  // Type / enum / regex / range checks per the meta entry.
  let v = data.proposed_value

  // ── Enum value normalization (COO drift corrections) ─────────────────────
  // COO occasionally emits shorthand or legacy values that have known correct forms.
  if (meta.enum && typeof v === 'string') {
    const ENUM_ALIASES: Record<string, string> = {
      // arabic_dialect
      'MSA':         'MSA_accessible',
      'msa':         'MSA_accessible',
      'MSA formal':  'MSA_formal',
      'MSA accessible': 'MSA_accessible',
      // archetype
      'creator':     'Creator',
      'lover':       'Lover',
      'hero':        'Hero',
      'sage':        'Sage',
      'innocent':    'Innocent',
      'explorer':    'Explorer',
      'outlaw':      'Outlaw',
      'magician':    'Magician',
      'jester':      'Jester',
      'everyman':    'Everyman',
      'caregiver':   'Caregiver',
      'ruler':       'Ruler',
    }
    if (!meta.enum.includes(v) && ENUM_ALIASES[v]) {
      v = ENUM_ALIASES[v]!
      ;(data as { proposed_value: unknown }).proposed_value = v
    }
  }

  if (meta.enum) {
    if (typeof v !== 'string' || !meta.enum.includes(v)) {
      return fail('value_out_of_enum', `value "${String(v)}" not in enum [${meta.enum.join(',')}]`)
    }
  } else if (meta.regex) {
    if (typeof v !== 'string' || !meta.regex.test(v)) {
      return fail('value_out_of_range', `value "${String(v)}" failed regex ${meta.regex}`)
    }
  } else if (meta.type === 'number') {
    // Coerce string → number (CEO emits founded_year as "2009" from form input).
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      ;(data as { proposed_value: unknown }).proposed_value = Number(v)
    }
    const nv = (data as { proposed_value: unknown }).proposed_value
    if (typeof nv !== 'number' || Number.isNaN(nv)) {
      return fail('value_out_of_range', `value must be a number, got ${typeof v}`)
    }
    if (meta.min !== undefined && (nv as number) < meta.min) return fail('value_out_of_range', `value ${nv} < min ${meta.min}`)
    if (meta.max !== undefined && (nv as number) > meta.max) return fail('value_out_of_range', `value ${nv} > max ${meta.max}`)
  } else if (meta.type === 'jsonb') {
    // Coerce known string shorthands for jsonb fields (e.g. gender_mix)
    if (typeof v === 'string' && data.field_path.includes('gender_mix')) {
      const GENDER_MAP: Record<string, { male: number; female: number }> = {
        balanced:      { male: 50, female: 50 },
        mixed:         { male: 50, female: 50 },
        male_skewed:   { male: 70, female: 30 },
        female_skewed: { male: 30, female: 70 },
        male:          { male: 80, female: 20 },
        female:        { male: 20, female: 80 },
      }
      const mapped = GENDER_MAP[v.toLowerCase().replace(/[\s-]/g, '_')]
      if (mapped) {
        ;(data as { proposed_value: unknown }).proposed_value = mapped
      } else {
        return fail('value_out_of_range', `jsonb gender_mix: unknown shorthand "${v}"`)
      }
    } else if (v === null || typeof v !== 'object') {
      return fail('value_out_of_range', 'jsonb columns require an object value')
    }
  } else if (meta.type === 'text[]') {
    // CEO sometimes emits a comma-separated string instead of an array.
    // Coerce it so clients can pass e.g. "bold, aggressive" and get ["bold","aggressive"].
    if (typeof v === 'string') {
      ;(data as { proposed_value: unknown }).proposed_value = v.split(',').map((s) => s.trim()).filter(Boolean)
    } else if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      return fail('value_out_of_range', 'text[] columns require an array of strings')
    }
  } else if (meta.type === 'boolean') {
    // Coerce string "true"/"false" → boolean (form submissions always stringify).
    if (typeof v === 'string') {
      const lower = v.toLowerCase().trim()
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        ;(data as { proposed_value: unknown }).proposed_value = true
      } else if (lower === 'false' || lower === '0' || lower === 'no') {
        ;(data as { proposed_value: unknown }).proposed_value = false
      } else {
        return fail('value_out_of_range', `boolean columns require true or false, got "${v}"`)
      }
    } else if (typeof v !== 'boolean') {
      return fail('value_out_of_range', `boolean columns require true or false, got ${typeof v}`)
    }
  }
  // String fallback — must be a non-empty string.
  if (!meta.enum && !meta.regex && !meta.type) {
    if (typeof v !== 'string' || v.trim().length === 0) {
      return fail('value_out_of_range', 'expected a non-empty string')
    }
  }

  // Brand must exist.
  if (!(await brandExists(db, brand_id, bypass))) {
    return fail('brand_not_found', `brand_id ${brand_id} not found`)
  }

  return { ok: true, normalised: data }
}

export async function validateConfidenceUpgrade(
  db: Db,
  brand_id: string,
  data: ConfidenceUpgradeData,
  bypass: PgBypass | null = null,
): Promise<ValidationResult<ConfidenceUpgradeData>> {
  if (!(await brandExists(db, brand_id, bypass))) {
    return fail('brand_not_found', `brand_id ${brand_id} not found`)
  }
  // Verify every claimed source_id belongs to this brand. Otherwise CEO could
  // (in a buggy state) cross-credit evidence between brands.
  if (data.evidence_source_ids.length > 0) {
    let map: Map<string, string> | null = null
    if (bypass) {
      map = await bypass.brandIdsForSources(data.evidence_source_ids)
    } else {
      const { data: sources, error } = await db
        .from('source_records')
        .select('source_id, brand_id')
        .in('source_id', data.evidence_source_ids)
      if (error) return fail('apply_failed', `evidence source check failed: ${error.message}`)
      map = new Map((sources ?? []).map((s) => [s.source_id as string, s.brand_id as string]))
    }
    const missing = data.evidence_source_ids.filter((id) => !map!.has(id))
    if (missing.length > 0) {
      return fail('evidence_sources_not_found', `unknown source_ids: ${missing.slice(0, 3).join(', ')}`)
    }
    for (const [id, owner] of map.entries()) {
      if (owner !== brand_id) {
        return fail('pii_in_anonymous_signal', `source_id ${id} belongs to a different brand`)
      }
    }
  }
  return { ok: true, normalised: data }
}

/**
 * Anonymous-signal scrubber: rejects any payload that looks like it leaked
 * brand-identifying data into a Layer 2/3 signal. Per Doc §4.4: "CEO extracts
 * anonymized signals — no brand_id, no caption text, no PII."
 */
export function validateAnonymousSignal(data: SectorSignalData | GlobalSignalData): ValidationResult<SectorSignalData> {
  const blob = JSON.stringify(data)
  // Brand ID smell — UUIDs.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(blob)) {
    return fail('pii_in_anonymous_signal', 'anonymous signal contains a UUID — possibly a brand_id leak')
  }
  // Email smell.
  if (/[\w._-]+@[\w.-]+\.[a-z]{2,}/i.test(blob)) {
    return fail('pii_in_anonymous_signal', 'anonymous signal contains an email')
  }
  // Arabic content smell — caption text leaking through. The prompt explicitly
  // forbids carrying caption_ar in signals; reject anything with > 10 Arabic
  // letters in the payload.
  const arabicLetters = blob.match(/[؀-ۿ]/g)
  if (arabicLetters && arabicLetters.length > 10) {
    return fail('pii_in_anonymous_signal', 'anonymous signal contains substantial Arabic text — caption leak?')
  }
  return { ok: true, normalised: data }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
async function brandExists(db: Db, brand_id: string, bypass: PgBypass | null): Promise<boolean> {
  if (bypass) return bypass.brandExists(brand_id)
  const { data, error } = await db
    .from('brand_profiles')
    .select('brand_id')
    .eq('brand_id', brand_id)
    .limit(1)
    .maybeSingle()
  return !error && !!data
}

function fail(code: RejectionCode, reason: string): ValidationFail {
  return { ok: false, code, reason }
}

interface AllowedFieldMeta {
  table: string
  column: string
  enum: readonly string[] | null
  regex?: RegExp
  type?: 'number' | 'jsonb' | 'text[]' | 'boolean'
  min?: number
  max?: number
}
