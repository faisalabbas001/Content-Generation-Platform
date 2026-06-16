/**
 * POST /api/agents/coo/build-branddna
 *
 * COO Job 1 (Doc §6.2). Called by N8N-A03 onboarding after Apify + Puppeteer
 * scrapers + Google Places run. Maps the 15-question form + scraper data to
 * 10 BrandDNA field nominations. Memory Controller writes BrandDNA fields;
 * COO never writes them. But COO IS the canonical writer for the raw evidence
 * tables (source_records, audience/visual/channel placeholders) — these are
 * fact-of-record rows, not BrandDNA decisions, so they fall outside Hard
 * Rule #2's scope. See packages/db/src/queries/onboarding-writes.ts for the
 * scope rationale.
 */
import { adminClient, onboardingWritesQ } from '@repo/db'
import { coo } from '@repo/ai'
import { computeCompletenessScore, COMPOSITION_FLOOR, CRITICAL_BRANDDNA_FIELDS } from '@repo/core'
import { enqueueNominations, processQueue } from '@repo/memory'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'
import { buildNominationsFromCoo } from '@/lib/coo-to-nominations'
import { buildNegativePatternNominationsFromToneAnti } from '@/lib/tone-anti-to-negative-patterns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ScraperExtraction = z
  .object({
    handle: z.string().nullable().optional(),
    followers: z.number().nullable().optional(),
    engagement_rate: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    color_palette: z.array(z.string()).nullable().optional(),
    name: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
  })
  .passthrough()

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    form_answers: z.record(z.unknown()),
    // Nullable + optional — A03 sends `null` when a lane was skipped (no
    // IG handle, no website, no Places candidate). `.optional()` alone
    // would reject `null` and 400 the route.
    instagram_extraction:       ScraperExtraction.nullable().optional(),
    website_extraction:         ScraperExtraction.nullable().optional(),
    google_business_extraction: ScraperExtraction.nullable().optional(),
    // A03 rev3 enrichments (Three-Axis Framework v2 + pre-launch handling).
    raw_instagram:          z.unknown().optional(),
    request_axes:           z.record(z.boolean()).optional(),
    method_profile_request: z.object({
      compose:         z.boolean().optional(),
      default_method:  z.string().nullable().optional(),
      score_threshold: z.number().optional(),
    }).optional(),
    data_richness:  z.enum(['form_only', 'single_source', 'partial', 'rich']).optional(),
    is_pre_launch:  z.boolean().optional(),
    form_dialect:   z.string().nullable().optional(),
    // Three-Axis Framework v2 form priors — user-stated values that anchor
    // axis_inference and method composition (Gap #9). All optional.
    form_priors:    z.record(z.unknown()).nullable().optional(),
  }).passthrough(),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A03',
  handler: async (input, ctx) => {
    const db = adminClient()

    // ── Normalize form_answers ────────────────────────────────────────────────
    // A03's "Build COO body" sends form_answers: d.form_payload which is a
    // nested { flow_version, submitted_at, seed:{}, review:{} } object.
    // COO prompt expects form_answers to be a FLAT key-value map of 21 fields.
    // Flatten here so any A03 version (old or new) works correctly.
    // Also enrich from brand_profiles DB so COO always has the full picture.
    let normalizedPayload = { ...input.payload }
    try {
      const rawFormAnswers = input.payload.form_answers as Record<string, unknown> | null | undefined
      let flat: Record<string, unknown> = {}

      if (rawFormAnswers && typeof rawFormAnswers === 'object') {
        // If already flat (has direct field keys like arabic_dialect), use as-is
        if ('arabic_dialect' in rawFormAnswers || 'brand_differentiator' in rawFormAnswers) {
          flat = rawFormAnswers
        } else {
          // Nested structure: merge seed + review into flat map
          const seed   = (rawFormAnswers.seed   ?? {}) as Record<string, unknown>
          const review = (rawFormAnswers.review ?? {}) as Record<string, unknown>
          flat = { ...seed, ...review }
        }
      }

      // Always enrich from DB — ensures COO gets all fields even if form_answers is sparse
      if (input.brand_id) {
        const { data: bp } = await db
          .from('brand_profiles')
          .select('brand_name_ar, brand_name_en, sector, city_primary, arabic_dialect, brand_differentiator, price_position, primary_channel, primary_kpi_type, religious_sensitivity, bilingual_ratio, formality_level, humor_tolerance, tone_anti_attribute_ids, ramadan_relevance, intent_state, archetype_primary, archetype_family, lifecycle_stage, lifestyle, emotions, occasions_ranked, bilingual_ratio, primary_color_hex, founding_story')
          .eq('brand_id', input.brand_id)
          .maybeSingle()
        if (bp) {
          const bpMap = bp as Record<string, unknown>
          // DB values fill gaps — form_answers values take priority if present
          for (const [k, v] of Object.entries(bpMap)) {
            if (v !== null && v !== undefined && v !== '' && !(flat[k] != null && flat[k] !== '')) {
              flat[k] = v
            }
          }
        }
      }

      normalizedPayload = { ...input.payload, form_answers: flat }
    } catch (e) {
      console.warn(`[coo/build-branddna] form_answers normalization failed: ${(e as Error).message}`)
    }

    const result = await coo.buildBrandDna(normalizedPayload, {
      flow_id: ctx.flowId,
      brand_id: input.brand_id,
      db,
    })

    // Defense-in-depth: re-derive completeness_score from field_nominations.
    // The COO prompt asks the model to compute it ("% of 10 fields with
    // confidence ≥ inferred_medium"), but trusting one self-reported number
    // is fragile. We count the same way and override if the model drifted.
    //
    // Floor (Gap #3): every form_priors field the user supplied counts as
    // `explicitly_confirmed` regardless of what COO says. The form is the
    // single most authoritative source for the 10 critical fields — if the
    // user typed in `arabic_dialect=MSA_accessible`, it doesn't matter that
    // COO downgraded it to `inferred_medium` based on scraped captions.
    const formPriors = (input.payload.form_priors ?? {}) as Record<string, unknown>
    const formAnswers = (input.payload.form_answers ?? {}) as Record<string, unknown>
    // Build the explicit-confirmed set from BOTH form_priors AND form_answers.
    // The form_priors dict is best-effort; form_answers is the raw payload and
    // may carry e.g. `audience_female_pct`+`audience_male_pct` (which should
    // count as `primary_audience_gender` evidence) without those being in
    // form_priors. We normalise here so the completeness floor is symmetrical
    // with what the user actually answered.
    const formPriorStates: Array<{ field_path: string; confidence_state: string }> = []
    const seen = new Set<string>()
    function add(key: string) {
      if (seen.has(key)) return
      seen.add(key)
      formPriorStates.push({ field_path: key, confidence_state: 'explicitly_confirmed' })
    }
    for (const [k, v] of Object.entries(formPriors)) {
      if (v === null || v === undefined || v === '') continue
      add(k)
    }
    // Derived form-priors from raw form_answers:
    //  • audience_female_pct + audience_male_pct → primary_audience_gender
    //  • arabic_dialect under review.* → arabic_dialect
    const review = (formAnswers.review ?? {}) as Record<string, unknown>
    if (
      (typeof review.audience_female_pct === 'number' || typeof formAnswers.audience_female_pct === 'number') &&
      (typeof review.audience_male_pct === 'number' || typeof formAnswers.audience_male_pct === 'number')
    ) {
      add('primary_audience_gender')
    }
    if (review.arabic_dialect || formAnswers.arabic_dialect) add('arabic_dialect')
    if (review.brand_differentiator || formAnswers.brand_differentiator) add('brand_differentiator')
    if (review.price_position || formAnswers.price_position) add('price_position')
    if (review.primary_channel || formAnswers.primary_channel) add('primary_channel')
    if (review.primary_kpi_type || formAnswers.primary_kpi_type) add('primary_kpi_type')
    if (review.formality_level || formAnswers.formality_level) add('formality_level')
    if (review.humor_tolerance || formAnswers.humor_tolerance) add('humor_tolerance')
    if (review.religious_sensitivity || formAnswers.religious_sensitivity) add('religious_sensitivity')
    if (review.bilingual_ratio || formAnswers.bilingual_ratio) add('bilingual_ratio')
    if (review.ramadan_relevance || formAnswers.ramadan_relevance) add('ramadan_relevance')
    const antiAttrs = (review.tone_anti_attribute_ids ?? formAnswers.tone_anti_attribute_ids) as unknown
    if (Array.isArray(antiAttrs) && antiAttrs.length > 0) add('tone_anti_attribute_ids')
    const cooStates = result.field_nominations.map((n) => ({
      field_path: n.field_path,
      confidence_state: n.confidence_state,
    }))
    // Union: COO + form floor. computeCompletenessScore dedupes by field name.
    const derivedScore = computeCompletenessScore([...cooStates, ...formPriorStates])
    if (Math.abs(derivedScore - result.completeness_score) >= 10) {
      console.warn(
        `[coo/build-branddna] completeness drift for brand=${input.brand_id}: ` +
          `model=${result.completeness_score} derived=${derivedScore} (form-priors=${formPriorStates.length}) ` +
          `— using derived value`,
      )
    }
    result.completeness_score = derivedScore

    // Doc §5.3 step 5: persist raw evidence tables. These are RLS-write-only
    // fact rows — they are NOT BrandDNA decisions, so Memory Controller is
    // not in the loop. Failures here are non-fatal: log and continue so the
    // flow doesn't lose the COO output it just paid for.
    let source_records_inserted = 0
    let source_ids_by_origin: Record<string, string> = {}
    let satellites_bootstrapped = false
    try {
      const sr = await onboardingWritesQ.persistSourceRecords(
        db,
        input.brand_id,
        result.source_records_to_create,
      )
      source_records_inserted = sr.inserted
      source_ids_by_origin = sr.source_ids_by_origin
    } catch (e) {
      console.warn(`[coo/build-branddna] source_records insert failed: ${(e as Error).message}`)
    }

    // Critical: hydrate the `form` source_id from the brand's existing
    // source_records row (written at form-submit time, NOT by COO).
    // Without this, confidence_upgrade nominations have no evidence_source_ids
    // to attach to → evidence_bundles stays empty → completeness_score=0.
    if (!source_ids_by_origin.form) {
      try {
        const { data: formSrc } = await db
          .from('source_records')
          .select('source_id')
          .eq('brand_id', input.brand_id)
          .eq('source_type', 'form')
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const formId = (formSrc as { source_id: string } | null)?.source_id
        if (formId) {
          source_ids_by_origin.form = formId
          console.info(`[coo/build-branddna] hydrated source_ids_by_origin.form=${formId}`)
        } else {
          console.warn(`[coo/build-branddna] no form source_record found for brand=${input.brand_id} — evidence_bundles will be empty`)
        }
      } catch (e) {
        console.warn(`[coo/build-branddna] form source_id lookup failed: ${(e as Error).message}`)
      }
    }

    // Also hydrate the scraper source_ids if they exist. COO's `sources`
    // arrays usually reference origin tags like "instagram_profile",
    // "website_homepage", etc. — but our source_records.raw_payload may
    // not carry exactly those origin labels. Map by source_type so the
    // fallback in coo-to-nominations can find SOMETHING to attach.
    try {
      const { data: scraperSrcs } = await db
        .from('source_records')
        .select('source_id, source_type')
        .eq('brand_id', input.brand_id)
        .in('source_type', ['instagram', 'website', 'google_places'])
      for (const r of (scraperSrcs ?? []) as Array<{ source_id: string; source_type: string }>) {
        if (!source_ids_by_origin[r.source_type]) source_ids_by_origin[r.source_type] = r.source_id
      }
    } catch (e) {
      console.warn(`[coo/build-branddna] scraper source_id hydrate failed: ${(e as Error).message}`)
    }

    try {
      await onboardingWritesQ.bootstrapBrandSatelliteRows(db, input.brand_id, {
        instagram: input.payload.instagram_extraction ?? null,
        website: input.payload.website_extraction ?? null,
        places: input.payload.google_business_extraction ?? null,
      })
      satellites_bootstrapped = true
    } catch (e) {
      console.warn(`[coo/build-branddna] satellite bootstrap failed: ${(e as Error).message}`)
    }

    // ── Enqueue 10-12 field nominations + confidence upgrades (Cluster A) ──
    // Hard Rule #2: brand_profiles / audience_profiles / evidence_bundles are
    // BrandDNA-bearing tables. COO can't write them — it nominates via the
    // queue and Memory Controller validates + writes. Without these, the 10
    // critical fields produced by COO never reach brand_profiles and the
    // evidence_bundles table stays empty (which is exactly what we observed
    // in the live audit).
    let field_nominations_enqueued = 0
    let confidence_upgrades_enqueued = 0
    let negative_patterns_enqueued = 0
    try {
      const nominations = buildNominationsFromCoo(result, {
        brand_id: input.brand_id,
        source_ids_by_origin,
      })

      // Enqueue confidence_upgrade for ALL form-confirmed critical fields,
      // regardless of whether COO also nominated them (Fix #4 — removing the
      // cooNominatedFields skip). Memory Controller's upsert is idempotent and
      // never downgrades, so upgrading a COO-nominated field to
      // explicitly_confirmed is always safe and correct.
      {
        const formSourceId = source_ids_by_origin.form
        const FORM_KEY_TO_EVIDENCE: Record<string, string> = {
          primary_audience_gender: 'primary_audience_gender',
          arabic_dialect:           'arabic_dialect',
          brand_differentiator:     'brand_differentiator',
          price_position:           'price_position',
          primary_channel:          'primary_channel',
          ramadan_relevance:        'ramadan_relevance',
          primary_kpi_type:         'primary_kpi_type',
          religious_sensitivity:    'religious_sensitivity',
          tone_anti_attribute_ids:  'tone_anti_attribute_ids',
          bilingual_ratio:          'bilingual_ratio',
          archetype_primary:        'archetype_primary',
          lifecycle_stage:          'lifecycle_stage',
        }
        for (const { field_path } of formPriorStates) {
          const evidenceName = FORM_KEY_TO_EVIDENCE[field_path]
          if (!evidenceName) continue
          const evidenceIds = formSourceId ? [formSourceId] : []
          if (evidenceIds.length === 0) continue
          nominations.push({
            nomination_type: 'confidence_upgrade',
            brand_id: input.brand_id,
            data: {
              field_name: evidenceName,
              new_state: 'explicitly_confirmed',
              evidence_source_ids: evidenceIds,
              agreement_ratio: 1,
              recency_score: 1,
              conflict_score: 0,
            },
          } as Parameters<typeof enqueueNominations>[1][number])
        }

        // Fix #3 — axis fields (archetype_primary, lifecycle_stage) are inferred
        // by COO, not answered in the form, so they never appear in formPriorStates.
        // Enqueue evidence_bundles rows for them whenever COO produced a confident
        // axis_inference — this is what makes them count toward completeness_score.
        const axisInf = result.axis_inference
        if (axisInf) {
          const axisSourceId = source_ids_by_origin.instagram ?? source_ids_by_origin.form
          const axisSourceIds = axisSourceId ? [axisSourceId] : []
          if (axisSourceIds.length > 0) {
            // archetype_primary — use archetype_confidence
            if (axisInf.archetype_primary && axisInf.archetype_confidence !== 'inferred_low' && axisInf.archetype_confidence !== 'missing') {
              nominations.push({
                nomination_type: 'confidence_upgrade',
                brand_id: input.brand_id,
                data: {
                  field_name: 'archetype_primary',
                  new_state: axisInf.archetype_confidence,
                  evidence_source_ids: axisSourceIds,
                  agreement_ratio: 0.85,
                  recency_score: 1,
                  conflict_score: 0,
                },
              } as Parameters<typeof enqueueNominations>[1][number])
            }
            // lifecycle_stage — use lifecycle_confidence
            if (axisInf.lifecycle_stage && axisInf.lifecycle_confidence !== 'inferred_low' && axisInf.lifecycle_confidence !== 'missing') {
              nominations.push({
                nomination_type: 'confidence_upgrade',
                brand_id: input.brand_id,
                data: {
                  field_name: 'lifecycle_stage',
                  new_state: axisInf.lifecycle_confidence,
                  evidence_source_ids: axisSourceIds,
                  agreement_ratio: 0.85,
                  recency_score: 1,
                  conflict_score: 0,
                },
              } as Parameters<typeof enqueueNominations>[1][number])
            }
          }
        }
      }

      // Gap #3: surface the form's tone_anti_attribute_ids as concrete
      // negative_patterns the A01/V01 quality gates can check against.
      // form_answers has TWO shapes: flat (legacy) and nested under .review
      // (v2). Try both — the v2 shape is what submitFinal actually sends.
      const formAnswers = (input.payload.form_answers ?? {}) as Record<string, unknown>
      const review = (formAnswers.review && typeof formAnswers.review === 'object')
        ? (formAnswers.review as Record<string, unknown>)
        : null
      const toneAntiRaw = review?.tone_anti_attribute_ids ?? formAnswers.tone_anti_attribute_ids
      const toneAnti = Array.isArray(toneAntiRaw)
        ? (toneAntiRaw.filter((x) => typeof x === 'string') as string[])
        : null
      const negativePatternNoms = buildNegativePatternNominationsFromToneAnti(input.brand_id, toneAnti)
      nominations.push(...negativePatternNoms)
      const r = await enqueueNominations(db, nominations, { nominated_by: 'COO_pass1' })
      // Per-type breakdown — we count details to telemetry.
      for (const d of r.details) {
        if (d.ok && !d.duplicate) {
          // We don't know which type from the result alone; recount by tag.
        }
      }
      field_nominations_enqueued = nominations.filter(
        (n) => (n as { nomination_type?: string }).nomination_type === 'field_update',
      ).length
      confidence_upgrades_enqueued = nominations.filter(
        (n) => (n as { nomination_type?: string }).nomination_type === 'confidence_upgrade',
      ).length
      negative_patterns_enqueued = negativePatternNoms.length
      console.info(
        `[coo/build-branddna] enqueued nominations for brand=${input.brand_id}: ` +
          `enqueued=${r.enqueued} skipped_duplicates=${r.skipped_duplicates} rejected=${r.rejected_at_input}`,
      )
    } catch (e) {
      console.warn(`[coo/build-branddna] field nominations enqueue failed: ${(e as Error).message}`)
    }

    // ── v2: enqueue the method profile for the Memory Controller ──────
    // Hard Rule #2: brand_method_profiles is a BrandDNA-bearing table, so
    // this route does NOT write it directly. We push a method_profile_update
    // nomination onto memory_controller_queue and the next /api/memory/process
    // call (typically fired by N8N-A03 immediately after this) drains it.
    let method_profile_enqueued = false
    // Skip the method-profile nomination entirely if COO couldn't decide any
    // of the 5 anatomy components (any null). Memory's MethodProfileUpdateData
    // requires non-null enums; writing a partial profile would either crash
    // validation or, worse, plant a half-baked creative direction. Better to
    // leave brand_method_profiles unset and let CEO re-route the brand to a
    // human gate on the next pass.
    const mp = result.method_profile
    const allComponentsDecided = !!(mp && mp.voice_register && mp.diagnostic_pattern && mp.visual_idiom && mp.cadence_rule && mp.closing_pattern)
    if (mp && allComponentsDecided && result.axis_inference) {
      try {
        const r = await enqueueNominations(
          db,
          [
            {
              nomination_type: 'method_profile_update',
              brand_id: input.brand_id,
              data: {
                voice_register:          mp.voice_register,
                diagnostic_pattern:      mp.diagnostic_pattern,
                visual_idiom:            mp.visual_idiom,
                cadence_rule:            mp.cadence_rule,
                closing_pattern:         mp.closing_pattern,
                composition_blend:       mp.composition_blend,
                composition_score:       mp.composition_score,
                creative_direction_text: mp.creative_direction_text,
                change_reason:           'onboarding',
                reasoning:               result.reasoning,
              },
            },
          ],
          { nominated_by: 'COO_pass3' },
        )
        method_profile_enqueued = r.enqueued > 0

        // Operations alert if composition is below the floor — surfaces in
        // /admin/anomalies and the Production Copilot. We write a real
        // anomaly_records row so admins can triage + dismiss from the UI
        // (vs the previous behaviour of console-warn only, which had no
        // signal anywhere visible).
        //
        // De-dup: if an unresolved row of the same type already exists for
        // this brand, skip — re-running A03 shouldn't pile up duplicate
        // alerts. The admin can resolve the existing one once they've made
        // the fix; the next run that's still below floor will then create a
        // fresh row.
        if (result.method_profile.composition_score < COMPOSITION_FLOOR) {
          const { data: existingAnom } = await db
            .from('anomaly_records')
            .select('anomaly_id')
            .eq('brand_id', input.brand_id)
            .eq('anomaly_type', 'composition_score_below_floor')
            .eq('resolved', false)
            .limit(1)
          if (existingAnom && existingAnom.length > 0) {
            console.info(
              `[coo/build-branddna] composition floor still below ${COMPOSITION_FLOOR} for brand=${input.brand_id} ` +
                `but an unresolved anomaly already exists — skipping duplicate insert.`,
            )
          } else {
          const { error: anomErr } = await db.from('anomaly_records').insert({
            brand_id: input.brand_id,
            anomaly_type: 'composition_score_below_floor',
            severity: 'warning',
            details: {
              composition_score: result.method_profile.composition_score,
              floor:             COMPOSITION_FLOOR,
              composition_blend: result.method_profile.composition_blend,
              archetype_primary: result.axis_inference?.archetype_primary ?? null,
              lifecycle_stage:   result.axis_inference?.lifecycle_stage ?? null,
              intent_state:      result.axis_inference?.intent_state ?? null,
              flow_id:           ctx.flowId,
              captured_at:       new Date().toISOString(),
            },
          } as never)
          if (anomErr) {
            console.warn(
              `[coo/build-branddna] composition floor anomaly insert failed for brand=${input.brand_id}: ${anomErr.message}`,
            )
          }
          }
        }
      } catch (e) {
        console.warn(`[coo/build-branddna] method_profile enqueue failed: ${(e as Error).message}`)
      }
    }

    // ── Drain the queue inline (Gap #1 fix) ───────────────────────────
    // n8n calls /api/memory/process right after this route anyway, but we
    // drain HERE too so the snapshot (built moments later) shows real
    // evidence_bundles + completeness. Idempotent: a second drain by n8n is
    // a no-op (status='pending' filter).
    //
    // Timeout safety: n8n's HTTP node timeout for this route is 120s. The COO
    // call itself can take ~30-60s. If we then try to drain a queue with
    // method_profile_update + 10 field_updates + 10 confidence_upgrades + N
    // negative_patterns, the cumulative time can push past the ceiling. We
    // race the drain against a soft deadline; if we run long, return early
    // and let n8n's next /api/memory/process call finish the work.
    let memory_drained_inline = { written: 0, rejected: 0, partial: false }
    try {
      const DRAIN_DEADLINE_MS = 30_000
      type DrainOutcome = { kind: 'done'; written: number; rejected: number } | { kind: 'timeout' }
      const drainPromise: Promise<DrainOutcome> = processQueue(db, { batch_size: 100 })
        .then((r) => ({ kind: 'done' as const, written: r.written, rejected: r.rejected }))
      const timeoutPromise: Promise<DrainOutcome> = new Promise((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' as const }), DRAIN_DEADLINE_MS),
      )
      const raceResult = await Promise.race([drainPromise, timeoutPromise])
      if (raceResult.kind === 'timeout') {
        memory_drained_inline = { written: 0, rejected: 0, partial: true }
        console.warn(
          `[coo/build-branddna] inline drain hit ${DRAIN_DEADLINE_MS}ms deadline for brand=${input.brand_id} — ` +
            `n8n's next /api/memory/process call will finish the remaining queue rows.`,
        )
      } else {
        memory_drained_inline = { written: raceResult.written, rejected: raceResult.rejected, partial: false }
      }
    } catch (e) {
      console.warn(`[coo/build-branddna] inline memory drain failed: ${(e as Error).message}`)
    }

    // ── Link sector baseline (Gap #11) ───────────────────────────────
    // After Memory writes arabic_dialect onto brand_profiles, the brand has
    // (sector, dialect) — both required to attach a baseline row.
    let sector_baseline_linked = false
    try {
      const linked = await onboardingWritesQ.linkSectorBaseline(db, input.brand_id)
      sector_baseline_linked = linked.linked
    } catch (e) {
      console.warn(`[coo/build-branddna] linkSectorBaseline failed: ${(e as Error).message}`)
    }

    // ── Set Layer 4 strategy fields from sector baseline + brand axis ─────
    // permission_level, goal_phase, content_mix_ratios, platform_weights,
    // occasion_approach. These were previously only set by the admin backfill
    // route. Now computed inline so every brand has them after onboarding.
    try {
      const { data: bpRow } = await db
        .from('brand_profiles')
        .select('sector, intent_state, lifecycle_stage, arabic_dialect, instagram_handle, permission_level')
        .eq('brand_id', input.brand_id)
        .maybeSingle()
      const bp = bpRow as Record<string, unknown> | null
      if (bp && !bp.permission_level) {
        const SECTOR_PERMISSION: Record<string, string> = {
          'Healthcare': 'institutional', 'Finance': 'institutional', 'Government': 'institutional',
          'F&B': 'sme_local', 'Retail': 'challenger', 'Beauty_Wellness': 'challenger',
        }
        const INTENT_TO_GOAL: Record<string, string> = {
          launch: 'launch', grow: 'awareness', defend: 'retention', harvest: 'conversion', recover: 'retention',
        }
        const permission_level = SECTOR_PERMISSION[String(bp.sector ?? '')] ?? 'sme_local'
        // Launch/pre-launch brands always start at awareness regardless of intent_state
        const lifecycle = String(bp.lifecycle_stage ?? '')
        const isLaunchBrand = lifecycle === 'launch' || lifecycle === 'pre_launch'
        const goal_phase = isLaunchBrand
          ? 'awareness'
          : (bp.intent_state ? (INTENT_TO_GOAL[String(bp.intent_state)] ?? 'awareness') : 'awareness')
        const primaryChannel = bp.instagram_handle ? 'Instagram' : 'Unknown'

        // Load sector baseline for content_mix_ratios
        const { data: baseline } = await db
          .from('sector_baselines')
          .select('recommended_content_mix, occasion_insights')
          .eq('sector' as never, String(bp.sector ?? ''))
          .eq('dialect' as never, String(bp.arabic_dialect ?? 'MSA_accessible'))
          .maybeSingle()
        const bsl = baseline as Record<string, unknown> | null
        const contentMix = (bsl?.recommended_content_mix as Record<string, number> | null) ??
          { emotional: 0.40, lifestyle: 0.35, offer: 0.25 }
        const occasionInsights = (bsl?.occasion_insights as Record<string, unknown> | null) ?? {}
        const occasionApproach: Record<string, string> = {}
        for (const [key] of Object.entries(occasionInsights)) {
          // Normalize to lowercase_underscore to avoid duplicate keys (e.g. Ramadan vs ramadan)
          occasionApproach[key.toLowerCase().replace(/\s+/g, '_')] = 'medium_priority'
        }
        // Ramadan always high priority for Saudi brands
        if (!occasionApproach.ramadan) occasionApproach.ramadan = 'high_priority'

        await db.from('brand_profiles').update({
          permission_level,
          goal_phase,
          content_mix_ratios:   contentMix as never,
          platform_weights:     { [primaryChannel]: 1.0 } as never,
          occasion_approach:    occasionApproach as never,
          brave_safe_default:   false,
        } as never).eq('brand_id', input.brand_id)
        console.info(`[coo/build-branddna] strategy fields set for brand=${input.brand_id} permission=${permission_level} goal=${goal_phase}`)
      }
    } catch (e) {
      console.warn(`[coo/build-branddna] strategy fields write failed: ${(e as Error).message}`)
    }

    return {
      ...result,
      _persisted: {
        source_records_inserted,
        satellites_bootstrapped,
        method_profile_enqueued,
        field_nominations_enqueued,
        confidence_upgrades_enqueued,
        negative_patterns_enqueued,
        memory_drained_inline,
        sector_baseline_linked,
        critical_fields_total: CRITICAL_BRANDDNA_FIELDS.length,
        form_priors_provided: Object.keys((input.payload.form_priors ?? {})).filter((k) => {
          const v = (input.payload.form_priors as Record<string, unknown>)[k]
          return v !== null && v !== undefined && v !== ''
        }).length,
      },
    }
  },
})
