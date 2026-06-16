/**
 * Server action — brand correction (Doc §8.4 "Flag correction → N8N-A04").
 *
 * Flow:
 *   1. Validate input + verify ownership
 *   2. Persist source_record (immutable audit)
 *   3. Fire n8n A04 (non-blocking, fire-and-forget)
 *   4. Return immediately — the client watches branddna_event_log via
 *      Supabase Realtime and reacts the instant the Memory Controller writes.
 *
 * Hard Rule #2: this action does NOT write brand_profiles directly.
 */
'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { serverComponentClient, adminClient } from '@repo/db/client'
import { requireUser } from '@repo/auth/server'
import { triggerN8nA04Correction } from '@/lib/n8n-outbound'
import { enqueueNominations, processQueue } from '@repo/memory'

export interface CorrectionResult {
  ok: boolean
  error?: string
  /** 'queued' = submitted to n8n, client watches Realtime for outcome */
  status?: 'queued'
  rejection_reason?: string
  /** Per-field outcomes from direct Memory Controller write (batch only) */
  field_results?: Array<{
    field_name: string
    status: 'written' | 'rejected' | 'error'
    rejection_reason?: string
  }>
}

const CORRECTABLE_FIELDS = z.enum([
  // Original 19 fields
  'arabic_dialect',
  'price_position',
  'formality_level',
  'humor_tolerance',
  'religious_sensitivity',
  'bilingual_ratio',
  'brand_differentiator',
  'primary_kpi_type',
  'primary_channel',
  'ramadan_relevance',
  'tone_anti_attribute_ids',
  'archetype_primary',
  'archetype_secondary',
  'lifecycle_stage',
  'intent_state',
  'primary_color_hex',
  'audience_description_ar',
  'audience_age_range',
  'audience_language_preference',
  // Layer 1 extras
  'sub_sector',
  'region_primary',
  'tone_register',
  'archetype_family',
  // Layer 2 — Owner Profile
  'founding_story',
  'owner_values',
  'comfort_on_camera',
  'way_of_speaking',
  'communication_style',
  'brand_goals',
  // Layer 3 — Content Style
  'posting_rhythm',
  'caption_style',
  // Layer 4 — Strategic Intelligence
  'permission_level',
  'cultural_tension_owned',
  'goal_phase',
  'brave_safe_default',
  // Relevance fields
  'national_day_relevance',
  'eid_fitr_relevance',
  'eid_adha_relevance',
  'founding_day_relevance',
  // v6 new fields
  'emotions',
  'occasions_ranked',
  'lifestyle',
  'music',
  'music_link',
  'brand_refs',
  'price_nums',
  'vision',
  'vision_text',
  'tagline',
  'cust_quote',
  'caption_ex',
  'metric',
  'anything',
  'custom_restriction',
  'custom_occasion',
  'scale_minmax',
  'scale_quietloud',
  'scale_localglobal',
  'scale_tradmod',
  'social',
  'platforms',
  'name_meaning',
  'hero_why',
  'lifecycle',
  // Business fields
  'respected_brands',
  'respected_why',
  'goal',
  'problems',
  // Identity fields (added — panel collects these)
  'founded_year',
  'brand_name_en',
  'city_primary',
  'sector',
])

// Maps UI field_name keys to Memory Controller field_path values.
// UI uses flat keys; Memory Controller uses dotted namespace paths.
const FIELD_PATH_MAP: Record<string, string> = {
  // Audience fields: keep bare names so n8n ALLOWED_FIELDS matches.
  // CEO will emit the correct AudienceProfile.* namespace in memory_nominations.
  audience_description_ar:      'audience_description_ar',
  audience_age_range:           'audience_age_range',
  audience_language_preference: 'audience_language_preference',
  primary_color_hex:            'BrandProfile.primary_color_hex',
  // Layer 1 extras — map to themselves
  sub_sector:                   'sub_sector',
  region_primary:               'region_primary',
  tone_register:                'tone_register',
  archetype_family:             'archetype_family',
  // Layer 2 — Owner Profile
  founding_story:               'founding_story',
  owner_values:                 'owner_values',
  comfort_on_camera:            'comfort_on_camera',
  way_of_speaking:              'way_of_speaking',
  communication_style:          'communication_style',
  brand_goals:                  'brand_goals',
  // Layer 3 — Content Style
  posting_rhythm:               'posting_rhythm',
  caption_style:                'caption_style',
  // Layer 4 — Strategic Intelligence
  permission_level:             'permission_level',
  cultural_tension_owned:       'cultural_tension_owned',
  goal_phase:                   'goal_phase',
  brave_safe_default:           'brave_safe_default',
  // Relevance fields
  national_day_relevance:       'national_day_relevance',
  eid_fitr_relevance:           'eid_fitr_relevance',
  eid_adha_relevance:           'eid_adha_relevance',
  founding_day_relevance:       'founding_day_relevance',
  // v6 new fields
  emotions:                     'emotions',
  occasions_ranked:             'occasions_ranked',
  lifestyle:                    'lifestyle',
  music:                        'music',
  music_link:                   'music_link',
  brand_refs:                   'brand_refs',
  price_nums:                   'price_nums',
  vision:                       'vision',
  vision_text:                  'vision_text',
  tagline:                      'tagline',
  cust_quote:                   'cust_quote',
  caption_ex:                   'caption_ex',
  metric:                       'metric',
  anything:                     'anything',
  custom_restriction:           'custom_restriction',
  custom_occasion:              'custom_occasion',
  scale_minmax:                 'scale_minmax',
  scale_quietloud:              'scale_quietloud',
  scale_localglobal:            'scale_localglobal',
  scale_tradmod:                'scale_tradmod',
  social:                       'social',
  platforms:                    'platforms',
  name_meaning:                 'name_meaning',
  hero_why:                     'hero_why',
  lifecycle:                    'lifecycle',
  // Business fields
  respected_brands:             'respected_brands',
  respected_why:                'respected_why',
  goal:                         'goal',
  problems:                     'problems',
  // Identity fields
  founded_year:                 'founded_year',
  brand_name_en:                'brand_name_en',
  city_primary:                 'city_primary',
  sector:                       'sector',
}

function toFieldPath(fieldName: string): string {
  return FIELD_PATH_MAP[fieldName] ?? fieldName
}

const Schema = z.object({
  brand_id:        z.string().uuid(),
  field_name:      CORRECTABLE_FIELDS,
  current_value:   z.string().nullable(),
  corrected_value: z.string().min(1).max(500),
  reasoning:       z.string().max(500).nullable().default(null),
})

export async function submitBrandCorrection(formData: FormData): Promise<CorrectionResult> {
  const user = await requireUser({ next: '/' })

  const raw = {
    brand_id:        String(formData.get('brand_id')        ?? ''),
    field_name:      String(formData.get('field_name')      ?? ''),
    current_value:   (formData.get('current_value') as string | null) || null,
    corrected_value: String(formData.get('corrected_value') ?? '').trim(),
    reasoning:       ((formData.get('reasoning') as string | null) || '').trim() || null,
  }

  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `${issue?.path.join('.') ?? 'form'}: ${issue?.message ?? 'invalid'}` }
  }
  const f = parsed.data

  const store = await cookies()
  const supabase = serverComponentClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const c of toSet) store.set(c.name, c.value, c.options)
      } catch { /* read-only context */ }
    },
  })
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('brand_id, auth_user_id, client_slug')
    .eq('brand_id', f.brand_id)
    .maybeSingle()
  if (!brand || brand.auth_user_id !== user.id) {
    return { ok: false, error: 'Brand not found or you do not own it' }
  }

  await supabase.from('source_records').insert({
    brand_id:     f.brand_id,
    source_type:  'correction',
    raw_payload:  {
      field_name:      f.field_name,
      current_value:   f.current_value,
      corrected_value: f.corrected_value,
      reasoning:       f.reasoning,
      submitted_by:    user.id,
    },
    recency_score: 1.0,
  } as never)

  triggerN8nA04Correction({
    flow_id:         'N8N-A04',
    brand_id:        f.brand_id,
    slug:            brand.client_slug,
    field_name:      toFieldPath(f.field_name),
    current_value:   f.current_value,
    corrected_value: f.corrected_value,
    reasoning:       f.reasoning,
  }).then((r) => {
    if (!r.ok) console.warn('[correction] N8N-A04 trigger fire-and-forget failed (still queued):', r.error)
  })

  return { ok: true, status: 'queued' }
}

// ── Batch correction — all changed fields in ONE n8n trigger ──────────────────

const FieldCorrectionSchema = z.object({
  field_name:      CORRECTABLE_FIELDS,
  current_value:   z.string().nullable(),
  corrected_value: z.string().min(1).max(500),
  reasoning:       z.string().max(500).nullable().default(null),
})

const BatchSchema = z.object({
  brand_id: z.string().uuid(),
  fields:   z.array(FieldCorrectionSchema).min(1).max(15),
})

export async function submitBrandCorrectionBatch(
  brandId: string,
  fields: Array<{ field_name: string; current_value: string | null; corrected_value: string; reasoning: string | null }>,
): Promise<CorrectionResult> {
  const user = await requireUser({ next: '/' })

  const parsed = BatchSchema.safeParse({ brand_id: brandId, fields })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `${issue?.path.join('.') ?? 'batch'}: ${issue?.message ?? 'invalid'}` }
  }
  const { brand_id, fields: validFields } = parsed.data

  const store = await cookies()
  const supabase = serverComponentClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const c of toSet) store.set(c.name, c.value, c.options)
      } catch { /* read-only context */ }
    },
  })
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('brand_id, auth_user_id, client_slug')
    .eq('brand_id', brand_id)
    .maybeSingle()
  if (!brand || brand.auth_user_id !== user.id) {
    return { ok: false, error: 'Brand not found or you do not own it' }
  }

  // Persist one source_record per field (immutable audit — Hard Rule #2)
  await supabase.from('source_records').insert(
    validFields.map((f) => ({
      brand_id,
      source_type:  'correction',
      raw_payload:  {
        field_name:      f.field_name,
        current_value:   f.current_value,
        corrected_value: f.corrected_value,
        reasoning:       f.reasoning,
        submitted_by:    user.id,
        batch:           true,
      },
      recency_score: 1.0,
    })) as never
  )

  // Direct Memory Controller path — enqueue + drain synchronously.
  // Returns per-field outcomes so the UI can show accurate results immediately
  // without waiting for n8n/CEO events that may never arrive.
  const db = adminClient()
  const fieldResults: NonNullable<CorrectionResult['field_results']> = []

  const nominations = validFields.map((f) => ({
    nomination_type: 'field_update' as const,
    brand_id,
    data: {
      field_path:     toFieldPath(f.field_name),
      proposed_value: f.corrected_value,
      source:         'client_confirmation' as const,
      reasoning:      f.reasoning ?? 'User correction via profile panel',
    },
  }))

  try {
    const eq = await enqueueNominations(db, nominations, { nominated_by: 'profile_correction' })
    if (eq.enqueued > 0 || eq.skipped_duplicates > 0) {
      const processed = await processQueue(db, { batch_size: validFields.length + 2 })
      // Map process results back to field names
      const processedByPath = new Map(
        processed.details.map((d) => [d.applied_to?.split('.').pop() ?? '', d])
      )
      for (const f of validFields) {
        const col = toFieldPath(f.field_name).split('.').pop() ?? f.field_name
        const detail = processedByPath.get(col) ?? processedByPath.get(f.field_name)
        if (detail) {
          fieldResults.push({
            field_name: f.field_name,
            status: detail.status === 'written' ? 'written' : 'rejected',
            rejection_reason: detail.rejection_reason ?? undefined,
          })
        } else {
          // skipped_duplicate = already written, treat as success
          fieldResults.push({ field_name: f.field_name, status: 'written' })
        }
      }
    } else {
      // All were skipped duplicates — already up to date
      for (const f of validFields) fieldResults.push({ field_name: f.field_name, status: 'written' })
    }
  } catch (e) {
    console.warn('[correction/batch] direct MC path failed:', (e as Error).message)
    for (const f of validFields) fieldResults.push({ field_name: f.field_name, status: 'error' })
  }

  // Fire n8n A04 for CEO audit trail — fire-and-forget, never blocks the response.
  triggerN8nA04Correction({
    flow_id:  'N8N-A04',
    brand_id,
    slug:     brand.client_slug,
    fields:   validFields.map((f) => ({ ...f, field_name: toFieldPath(f.field_name) })),
  }).then((r) => {
    if (!r.ok) console.warn('[correction/batch] N8N-A04 trigger failed:', r.error)
  })

  // Bust page cache so corrected values appear immediately on next load.
  const slug = brand.client_slug
  revalidatePath(`/${slug}/profile`)
  revalidatePath(`/${slug}/strategy`)
  revalidatePath(`/${slug}/dashboard`)
  revalidatePath(`/${slug}/snapshot`)
  revalidatePath(`/${slug}/brand-insight`)

  const allApplied = fieldResults.every((r) => r.status === 'written')
  const anyRejected = fieldResults.some((r) => r.status === 'rejected')
  return {
    ok: true,
    status: 'queued',
    field_results: fieldResults,
    rejection_reason: anyRejected
      ? fieldResults.find((r) => r.status === 'rejected')?.rejection_reason
      : undefined,
  }
}

/**
 * Called by the /api/webhooks/n8n handler after correction_applied.
 * Busts the Next.js page cache so the profile page shows the new value.
 */
export async function revalidateBrandProfile(slug: string) {
  revalidatePath(`/${slug}/profile`)
  revalidatePath(`/${slug}/strategy`)
  revalidatePath(`/${slug}/dashboard`)
  revalidatePath(`/${slug}/snapshot`)
  revalidatePath(`/${slug}/brand-insight`)
}

/**
 * Polling fallback for the correction form — reads final outcome events from
 * branddna_event_log using the admin client (bypasses RLS) so the browser
 * doesn't depend solely on Realtime to resolve the correction status.
 *
 * Returns the most recent correction_applied / correction_rejected event
 * for the given brand after `since` timestamp, or null if not yet available.
 */
export async function pollCorrectionOutcome(
  brandId: string,
  since: string,
): Promise<{ stage: string; field_name: string | null; rejection_reason: string | null } | null> {
  const user = await requireUser({ next: '/' })
  const store = await cookies()
  const supabase = serverComponentClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const c of toSet) store.set(c.name, c.value, c.options)
      } catch { /* read-only context */ }
    },
  })
  // Verify ownership before returning events
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('brand_id, auth_user_id')
    .eq('brand_id', brandId)
    .maybeSingle()
  if (!brand || brand.auth_user_id !== user.id) return null

  // Use admin client to bypass RLS on the event log
  const db = adminClient()
  const { data } = await db
    .from('branddna_event_log')
    .select('event_type, event_data')
    .eq('brand_id', brandId)
    .gte('created_at', since)
    .in('event_type', [
      'correction_progress_correction_received',
      'correction_progress_ceo_classifying',
      'correction_progress_ceo_approved',
      'correction_progress_memory_writing',
      'correction_progress_correction_applied',
      'correction_progress_correction_rejected',
    ])
    .order('created_at', { ascending: false })
    .limit(10)

  if (!data || data.length === 0) return null

  const row = data[0]
  const eventData = row.event_data as Record<string, unknown> | null
  const stage = String(eventData?.stage ?? row.event_type.replace('correction_progress_', ''))
  return {
    stage,
    field_name: eventData?.field_name ? String(eventData.field_name) : null,
    rejection_reason: eventData?.rejection_reason ? String(eventData.rejection_reason) : null,
  }
}

// ── Visual style update — client-side (no n8n, direct Memory Controller) ─────

const VisualStyleUpdateSchema = z.object({
  brand_id:         z.string().uuid(),
  color_palette:    z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(12).optional(),
  style_descriptor: z.string().min(2).max(1000).optional(),
}).refine((d) => d.color_palette !== undefined || d.style_descriptor !== undefined, {
  message: 'Provide at least color_palette or style_descriptor',
})

export async function submitVisualStyleUpdate(
  input: z.infer<typeof VisualStyleUpdateSchema>,
): Promise<CorrectionResult> {
  const user = await requireUser({ next: '/' })

  const parsed = VisualStyleUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_input' }

  const store = await cookies()
  const supabase = serverComponentClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try { for (const c of toSet) store.set(c.name, c.value, c.options) } catch { /* read-only */ }
    },
  })

  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('brand_id, auth_user_id, client_slug')
    .eq('brand_id', parsed.data.brand_id)
    .maybeSingle()
  if (!brand || brand.auth_user_id !== user.id) {
    return { ok: false, error: 'Brand not found or access denied' }
  }

  const db = adminClient()
  const nominations = []

  if (parsed.data.color_palette !== undefined) {
    nominations.push({
      nomination_type: 'field_update' as const,
      brand_id: parsed.data.brand_id,
      data: {
        field_path:          'VisualStyleProfile.color_palette',
        proposed_value:      parsed.data.color_palette,
        source:              'client_confirmation',
        confidence_delta:    'confirmed',
        human_review_required: false,
      },
    })
  }

  if (parsed.data.style_descriptor !== undefined) {
    nominations.push({
      nomination_type: 'field_update' as const,
      brand_id: parsed.data.brand_id,
      data: {
        field_path:          'VisualStyleProfile.style_descriptor',
        proposed_value:      parsed.data.style_descriptor,
        source:              'client_confirmation',
        confidence_delta:    'confirmed',
        human_review_required: false,
      },
    })
  }

  const enq = await enqueueNominations(db, nominations, { nominated_by: 'client' })
  if (enq.rejected_at_input > 0) {
    return { ok: false, error: enq.details.find((d) => !d.ok)?.error ?? 'enqueue rejected' }
  }

  try { await processQueue(db, { batch_size: 10 }) } catch { /* best-effort */ }

  revalidatePath(`/${brand.client_slug}/profile`)
  return { ok: true, status: 'queued' }
}
