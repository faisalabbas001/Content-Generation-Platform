/**
 * POST /api/agents/ceo/classify
 *
 * CEO routing decision (Doc §6.1, Steps 1-6 of the 8-step protocol).
 * Called by every n8n trigger flow as the FIRST step:
 *   - N8N-A01 (Sunday batch — once per shard)
 *   - N8N-A02 (on-demand single post)
 *   - N8N-A03 (onboarding — request_type=onboarding_new)
 *   - N8N-A04 (brand correction)
 *   - N8N-A05 (upgrade signal)
 *   - N8N-B03 (revision request)
 *
 * Hard Rule #1: n8n NEVER calls COO/CCO/DeepSeek directly. Every flow goes
 * CEO first; the response's `agents_to_dispatch` tells n8n what to call next.
 */
import { adminClient, onboardingWritesQ } from '@repo/db'
import { ceo } from '@repo/ai'
import { enqueueNominations, translateCeoNominations } from '@repo/memory'
import { z } from 'zod'
import { schemas } from '@repo/core'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid().nullable(),
  payload: z.object({
    request_type: schemas.RequestType,
    trigger_payload: z.record(z.unknown()).default({}),
    evidence_bundle_states: z.record(z.string()).optional(),
    occasion_flags: z.array(z.string()).optional(),
    current_month_spend_usd: z.number().nonnegative().optional(),
    monthly_ceiling_usd: z.number().positive().optional(),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'unknown_flow',
  handler: async (input, ctx) => {
    const db = adminClient()

    // ── Chain pre-filtering (calendar_ondemand only) ──────────────────────────
    // Signals 1-3 are hard deterministic filters — run in code so the CEO
    // prompt only sees chains that are actually eligible for this brand/request.
    // CEO then applies signals 4-5 (occasion + content type) and scores to pick.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let availableChains: any[] | undefined
    let brandQualityTier: string | undefined

    if (input.payload.request_type === 'calendar_ondemand' && input.brand_id) {
      try {
        // Load brand sector + quality_tier for filtering
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: brand } = await (db as any)
          .from('brand_profiles')
          .select('sector, quality_tier')
          .eq('brand_id', input.brand_id)
          .maybeSingle()

        const sector: string = (brand as { sector?: string; quality_tier?: string } | null)?.sector ?? ''
        const qualityTier: string = (brand as { sector?: string; quality_tier?: string } | null)?.quality_tier ?? 'starter'
        brandQualityTier = qualityTier
        const isStarter = qualityTier === 'starter'

        // Load all active chains — select only the flat columns that actually exist
        // (0066 schema: eligible_sectors, excluded_sectors, quality_tiers, eligible_occasions,
        //  excluded_occasions, fal_model_primary, fal_model_secondary — NOT models_used/eligibility_filters)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: allChains } = await (db as any)
          .from('chains')
          .select([
            'chain_id', 'name_en', 'family', 'output_type', 'purpose',
            'cost_estimate_usd', 'fal_model_primary', 'fal_model_secondary',
            'eligible_sectors', 'excluded_sectors',
            'eligible_occasions', 'excluded_occasions',
            'quality_tiers', 'cultural_constraints', 'is_active',
          ].join(', '))
          .eq('is_active', true)

        if (allChains && Array.isArray(allChains)) {
          type RawChain = {
            chain_id: string; name_en: string; family: string; output_type: string
            purpose: string | null; cost_estimate_usd: number | null
            fal_model_primary: string; fal_model_secondary: string | null
            eligible_sectors: string[] | null; excluded_sectors: string[] | null
            eligible_occasions: string[] | null; excluded_occasions: string[] | null
            quality_tiers: string[]; cultural_constraints: Record<string, unknown> | null
          }

          availableChains = (allChains as RawChain[])
            .filter((chain) => {
              const cc = (chain.cultural_constraints ?? {}) as {
                requires_wardrobe_check?: boolean
                requires_gesture_check?: boolean
                high_gender_sensitivity?: boolean
                high_religious_sensitivity?: boolean
              }

              // Signal 1 — Sector hard filter (null = all sectors allowed)
              if (sector && chain.eligible_sectors && !chain.eligible_sectors.includes(sector)) return false
              if (sector && chain.excluded_sectors && chain.excluded_sectors.includes(sector)) return false

              // Signal 2 — Quality tier hard filter
              const tiersAllowed = chain.quality_tiers ?? ['starter', 'growth', 'enterprise']
              if (!tiersAllowed.includes(qualityTier)) return false

              // Signal 3 — Cultural safety gate: starter brands cannot use flagged chains
              if (isStarter && (
                cc.requires_wardrobe_check ||
                cc.requires_gesture_check ||
                cc.high_gender_sensitivity ||
                cc.high_religious_sensitivity
              )) return false

              return true
            })
            .map((chain) => ({
              chain_id:          chain.chain_id,
              name_en:           chain.name_en,
              family:            chain.family,
              output_type:       chain.output_type,
              purpose:           chain.purpose ?? '',
              cost_estimate_usd: chain.cost_estimate_usd ?? 0,
              // Map flat DB columns → models_used shape expected by CEO prompt
              models_used: [
                { provider: 'fal', model_id: chain.fal_model_primary,   role: 'primary' },
                ...(chain.fal_model_secondary
                  ? [{ provider: 'fal', model_id: chain.fal_model_secondary, role: 'secondary' }]
                  : []),
              ],
              // Map flat DB columns → eligibility_filters shape expected by CEO prompt
              eligibility_filters: {
                sectors_allowed:    chain.eligible_sectors    ?? [],
                occasions_allowed:  chain.eligible_occasions  ?? [],
                occasions_excluded: chain.excluded_occasions  ?? [],
                quality_tiers_allowed: chain.quality_tiers   ?? ['starter', 'growth', 'enterprise'],
              },
              cultural_constraints: {
                requires_wardrobe_check:           !!(chain.cultural_constraints?.requires_wardrobe_check),
                requires_gesture_check:            !!(chain.cultural_constraints?.requires_gesture_check),
                high_gender_sensitivity:           !!(chain.cultural_constraints?.high_gender_sensitivity),
                high_religious_sensitivity:        !!(chain.cultural_constraints?.high_religious_sensitivity),
                requires_cultural_coherence_check: !!(chain.cultural_constraints?.requires_cultural_coherence_check),
              },
            }))
        }
      } catch (e) {
        // Non-fatal — CEO falls back to null selected_chain if no chains passed
        console.warn(`[ceo/classify] chain pre-filter failed: ${(e as Error).message}`)
      }
    }

    // Signal 0 — media_type hard filter (video requests only).
    // The on-demand brief carries media_type inside trigger_payload (set by the
    // N8N-A02 "Prepare CEO classify" node). Without this, the CEO is handed image
    // AND video chains with no media-type signal and routinely picks an image
    // chain (e.g. T13) for a video request — the downstream pipeline then gets no
    // output_duration_s and defaults to a 5s clip. Restricting the candidate set
    // to output_type='video' forces a video chain (V01..V05) so the chain-driven
    // length is honoured.
    //
    // Scope: only narrows the set when media_type === 'video'. Image / undefined
    // requests are left exactly as before (the existing downstream guard in
    // /api/image/generate already skips video chains for image), so image routing
    // is unchanged. If no eligible video chain survives, we keep the full set so
    // the CEO can still route rather than failing with an empty list.
    const requestedMediaType =
      (input.payload.trigger_payload as { media_type?: string } | undefined)?.media_type
    if (requestedMediaType === 'video' && Array.isArray(availableChains)) {
      const videoOnly = availableChains.filter((c) => c.output_type === 'video')
      if (videoOnly.length > 0) {
        availableChains = videoOnly
      } else {
        console.warn(
          '[ceo/classify] media_type=video but no eligible video chains after sector/tier filtering — ' +
          'leaving full chain set so the CEO can still route (video length will fall back to default)',
        )
      }
    }

    const decision = await ceo.classify(
      {
        flow_id: input.flow_id,
        request_type: input.payload.request_type,
        brand_id: input.brand_id,
        trigger_payload: input.payload.trigger_payload,
        evidence_bundle_states: input.payload.evidence_bundle_states,
        occasion_flags: input.payload.occasion_flags,
        current_month_spend_usd: input.payload.current_month_spend_usd,
        monthly_ceiling_usd:     input.payload.monthly_ceiling_usd,
        available_chains: availableChains,
        brand_quality_tier: brandQualityTier,
      },
      { flow_id: ctx.flowId, brand_id: input.brand_id, db },
    )

    // Deterministic VIDEO chain guarantee: selected_chain is optional and unvalidated
    // in the LLM output, but the video pipeline HARD-requires a real chain —
    // /api/image/generate-video rejects chain_id null (Zod min(1)) and throws without
    // fal_model_secondary, so a null/hallucinated pick silently kills the render.
    // Validate the pick against the pre-filtered eligible set and fall back to the
    // first video-capable chain. Image requests are deliberately left untouched —
    // image generation degrades gracefully without a chain (resolveModel routing).
    if (requestedMediaType === 'video' && Array.isArray(availableChains) && availableChains.length > 0) {
      const isEligible = availableChains.some((c) => c.chain_id === decision.selected_chain)
      if (!decision.selected_chain || !isEligible) {
        const fallback = availableChains.find((c) => c.output_type === 'video') ?? availableChains[0]
        console.warn(
          `[ceo/classify] video request but selected_chain=${decision.selected_chain ?? 'null'} ` +
          `is not in the eligible set — falling back to ${fallback.chain_id}`,
        )
        decision.selected_chain = fallback.chain_id
      }
    }

    // Auto-enqueue any memory_nominations the CEO returned. Per Hard Rule #2
    // we never write to BrandDNA from here — we only put pending rows on
    // memory_controller_queue. processQueue() drains them async via
    // /api/memory/process or n8n's N8N-D02 maintenance flow.
    let nominations_enqueued = 0
    let nominations_dropped = 0
    if (Array.isArray(decision.memory_nominations) && decision.memory_nominations.length > 0) {
      const translated = translateCeoNominations(decision.brand_id, decision.memory_nominations)
      nominations_dropped = translated.dropped.length
      if (translated.nominations.length > 0) {
        const r = await enqueueNominations(db, translated.nominations, { nominated_by: 'CEO' })
        nominations_enqueued = r.enqueued + r.skipped_duplicates
      }
    }

    // Doc §5.3 step 8 + §5.4: every brand-scoped routing decision snapshots
    // the resolved confidence_mode + human_gate_reasons into
    // confidence_classifications so /profile and admin tools render the
    // latest verdict. System-level routing (no brand) skips this.
    let classification_id: string | null = null
    if (decision.brand_id) {
      const reasons = [
        ...decision.human_gate_reasons,
        ...(decision.anomaly_flag ? [`anomaly:${decision.anomaly_flag}`] : []),
      ]
      const r = await onboardingWritesQ.recordConfidenceClassification(
        db,
        decision.brand_id,
        decision.confidence_mode,
        reasons,
      )
      classification_id = r.classification_id
    }

    // Doc §6.1 — every CEO call appends an immutable row to routing_decisions
    // (append-only audit table). Used by admin dashboards, copilot context,
    // anomaly post-mortems. No-op outcome string here — it's filled in later
    // by /api/webhooks/n8n when the workflow finishes (success/failure).
    const { error: routeErr } = await db.from('routing_decisions').insert({
      decision_id:       decision.decision_id,
      brand_id:          decision.brand_id,
      flow_id:           input.flow_id,
      request_type:      decision.request_type,
      pipeline_assigned: decision.pipeline,
      agents_dispatched: decision.agents_to_dispatch as never,
      constraints_applied: {
        confidence_mode: decision.confidence_mode,
        cost_status:     decision.cost_status,
        occasion_flags:  decision.occasion_flags,
        human_gate_required: decision.human_gate_required,
        human_gate_reasons:  decision.human_gate_reasons,
        anomaly_flag:        decision.anomaly_flag,
        constraint_payload:  decision.constraint_payload,
      } as never,
      confidence_mode: decision.confidence_mode,
      outcome: 'pending',
    } as never)
    if (routeErr) {
      // Non-fatal — the decision is already in confidence_classifications;
      // routing_decisions is for audit. Log and continue.
      console.warn(`[ceo/classify] routing_decisions insert failed: ${routeErr.message}`)
    }

    return {
      decision,
      memory: { enqueued: nominations_enqueued, dropped: nominations_dropped },
      classification_id,
    }
  },
})