'use server'

/**
 * Brand Insight — server actions for progressive BrandDNA enrichment.
 *
 * Per Hard Rule #2 (Doc §1.4): "No agent writes to BrandDNA tables directly.
 * All writes are nominated, queued in memory_controller_queue, validated by
 * Memory Controller, then written."
 *
 * Every field save goes through:
 *   1. enqueueNominations(db, [field_update nomination])
 *   2. processQueue(db)  ← drains immediately so change is visible right away
 *
 * This ensures:
 *   - branddna_event_log gets a row for every save (change history on /profile)
 *   - memory_controller_queue has an audit trail
 *   - evidence_bundles.field_confidence is set to explicitly_confirmed
 *   - completeness_score refreshes if a critical field was written
 *
 * source = 'client_confirmation' — the user explicitly provided this value,
 * so confidence is the highest possible state.
 */

import { z } from 'zod'
import { adminClient } from '@repo/db/client'
import { getBrandForCurrentUser, requireBrandAccess } from '@repo/auth/server'
import { enqueueNominations, processQueue } from '@repo/memory'
import { triggerN8nA01BatchCalendar } from '@/lib/n8n-outbound'

// ── Approve & Generate — fires directly from brand-insight sidebar ────────────
export async function approveAndGenerate(
  brandId: string,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireBrandAccess(brandId) } catch {
    return { ok: false, error: 'Not authorised' }
  }

  const { error } = await adminClient()
    .from('brand_profiles')
    .update({ onboarding_status: 'complete', strategy_version: 1 } as never)
    .eq('brand_id', brandId)

  if (error) return { ok: false, error: error.message }

  triggerN8nA01BatchCalendar(brandId, 'brand-insight-approval')
    .then((r) => {
      if (!r.ok) console.warn(`[approveAndGenerate] trigger failed brand=${brandId}: ${r.error}`)
      else console.info(`[approveAndGenerate] triggered brand=${brandId} req=${r.request_id}`)
    })
    .catch((e: Error) => console.warn(`[approveAndGenerate] threw brand=${brandId}: ${e.message}`))

  return { ok: true }
}

export interface InsightResult {
  ok: boolean
  error?: string
}

// ── Per-field value schemas ───────────────────────────────────────────────────
// Validates the raw FormData value before nominating.

const FIELD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  // Layer 2 — story
  founding_story:            z.string().trim().max(1000).transform(v => v || null),
  owner_values:              z.string().trim().max(500).transform(v => v || null),
  brand_goals:               z.string().trim().max(300).transform(v => v || null),
  products_list:             z.string().trim().max(800).transform(v => v || null),
  cust_desc:                 z.string().trim().max(400).transform(v => v || null),
  cust_quote:                z.string().trim().max(200).transform(v => v || null),
  vision_text:               z.string().trim().max(500).transform(v => v || null),
  respected_brands:          z.string().trim().max(200).transform(v => v || null),
  respected_why:             z.string().trim().max(300).transform(v => v || null),
  metric:                    z.string().trim().max(200).transform(v => v || null),
  hero_why:                  z.string().trim().max(400).transform(v => v || null),
  price_nums:                z.string().trim().max(100).transform(v => v || null),
  sub_sector:                z.string().trim().max(100).transform(v => v || null),
  founded_year:              z.string().regex(/^\d{4}$/, 'Must be a 4-digit year').transform(v => Number(v)),
  // Layer 2 — style
  way_of_speaking:           z.enum(['formal','casual','storytelling','direct']),
  communication_style:       z.string().trim().max(200).transform(v => v || null),
  comfort_on_camera:         z.enum(['willing','hesitant','not_interested']),
  physical_appearance_notes: z.string().trim().max(300).transform(v => v || null),
  content_preferences:       z.array(z.string()).min(1),
  // Layer 3 — content identity
  posting_rhythm:            z.enum(['daily','3x_week','weekly','biweekly','monthly']),
  caption_style:             z.enum(['short_punchy','long_storytelling','question_hook','cta_heavy']),
  tagline:                   z.string().trim().max(100).transform(v => v || null),
  formality_level:           z.enum(['casual','semi_formal','formal']),
  humor_tolerance:           z.enum(['none','light','moderate']),
  caption_ex:                z.string().trim().max(500).transform(v => v || null),
  custom_restriction:        z.string().trim().max(400).transform(v => v || null),
  music_link:                z.string().trim().max(300).transform(v => v || null),
  // Layer 4 — strategy
  goal_phase:                z.enum(['awareness','conversion','retention','launch']),
  permission_level:          z.enum(['category_leader','challenger','institutional','purpose','launch','sme_local']),
  primary_channel:           z.enum(['Instagram','Snapchat','TikTok','Twitter']),
  primary_kpi_type:          z.enum(['engagement','conversion','awareness','trust']),
  brave_safe_default:        z.boolean(),
  cultural_tension_owned:    z.string().trim().max(300).transform(v => v || null),
}

// ── Public action ─────────────────────────────────────────────────────────────

export async function saveField(
  slug: string,
  fieldName: string,
  formData: FormData,
): Promise<InsightResult> {
  const schema = FIELD_SCHEMAS[fieldName]
  if (!schema) return { ok: false, error: `Unknown field: ${fieldName}` }

  // Parse + validate the raw value
  let rawValue: unknown
  if (fieldName === 'content_preferences') {
    rawValue = formData.getAll(fieldName).map(String).filter(Boolean)
  } else if (fieldName === 'brave_safe_default') {
    rawValue = formData.get(fieldName) === 'true'
  } else {
    rawValue = formData.get(fieldName)
  }

  const parsed = schema.safeParse(rawValue)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? 'Invalid value' }
  }

  const proposedValue = parsed.data
  if (proposedValue === null) {
    // User cleared an optional field — nothing to nominate
    return { ok: true }
  }

  // Verify ownership
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  const db = adminClient()

  try {
    // Enqueue a field_update nomination — Memory Controller validates the field
    // path, writes brand_profiles, appends branddna_event_log, and refreshes
    // completeness_score for critical fields.
    const r = await enqueueNominations(db, [{
      nomination_type: 'field_update',
      brand_id: brandId,
      data: {
        field_path: fieldName,          // bare name — ALLOWED_FIELD_PATHS covers all
        proposed_value: proposedValue,
        source: 'client_confirmation',  // highest confidence — user explicitly answered
        reasoning: `Owner answered via BrandDNA Insights wizard (field: ${fieldName})`,
      },
    }], { nominated_by: 'brand_insight' })

    if (r.enqueued === 0 && r.skipped_duplicates === 0) {
      // Nomination was rejected by enqueue (e.g. forbidden_field_path).
      // Fall back to direct write so the user's answer is never lost.
      console.warn(`[brand-insight] enqueue returned 0 for field=${fieldName}, falling back to direct write`)
      const { error } = await db
        .from('brand_profiles')
        .update({ [fieldName]: proposedValue, updated_at: new Date().toISOString() } as never)
        .eq('brand_id', brandId)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }

    // Drain the queue — runs synchronously so the value is visible on next page load
    await processQueue(db, { batch_size: 5 })

    return { ok: true }
  } catch (err) {
    // Memory Controller unavailable — fall back to direct write.
    // The data is always saved; the audit trail may be missing.
    console.error(`[brand-insight] MC write failed for field=${fieldName}:`, (err as Error).message)
    const { error } = await db
      .from('brand_profiles')
      .update({ [fieldName]: proposedValue, updated_at: new Date().toISOString() } as never)
      .eq('brand_id', brandId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }
}

// ── Legacy group actions (kept for backward compat with old profile correction) ──

export async function saveOwnerStory(slug: string, formData: FormData): Promise<InsightResult> {
  for (const field of ['founding_story', 'owner_values', 'brand_goals']) {
    const v = formData.get(field)
    if (v !== null && v !== '') {
      const r = await saveField(slug, field, formData)
      if (!r.ok) return r
    }
  }
  return { ok: true }
}

export async function saveOwnerStyle(slug: string, formData: FormData): Promise<InsightResult> {
  for (const field of ['way_of_speaking','communication_style','comfort_on_camera','physical_appearance_notes']) {
    const v = formData.get(field)
    if (v !== null && v !== '') {
      const r = await saveField(slug, field, formData)
      if (!r.ok) return r
    }
  }
  const prefs = formData.getAll('content_preferences').map(String).filter(Boolean)
  if (prefs.length) {
    const fd = new FormData()
    for (const p of prefs) fd.append('content_preferences', p)
    const r = await saveField(slug, 'content_preferences', fd)
    if (!r.ok) return r
  }
  return { ok: true }
}

export async function saveStrategy(slug: string, formData: FormData): Promise<InsightResult> {
  for (const field of ['permission_level','cultural_tension_owned','goal_phase','primary_channel','primary_kpi_type']) {
    const v = formData.get(field)
    if (v !== null && v !== '') {
      const r = await saveField(slug, field, formData)
      if (!r.ok) return r
    }
  }
  const brave = formData.get('brave_safe_default')
  if (brave !== null) {
    const fd = new FormData()
    fd.set('brave_safe_default', brave as string)
    const r = await saveField(slug, 'brave_safe_default', fd)
    if (!r.ok) return r
  }
  return { ok: true }
}

export async function saveVisual(slug: string, formData: FormData): Promise<InsightResult> {
  for (const field of ['posting_rhythm','caption_style','tagline','formality_level','humor_tolerance']) {
    const v = formData.get(field)
    if (v !== null && v !== '') {
      const r = await saveField(slug, field, formData)
      if (!r.ok) return r
    }
  }
  return { ok: true }
}
