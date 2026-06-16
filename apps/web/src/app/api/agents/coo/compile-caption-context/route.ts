/**
 * POST /api/agents/coo/compile-caption-context
 *
 * COO Job 2 (Doc §6.2). Called by N8N-A01 / N8N-A02 BEFORE DeepSeek.
 * Returns the 1200-2000 token CaptionContext that DeepSeek reads.
 *
 * Server-side enrichment:
 *   • Caller supplies only the per-call inputs (occasion_flags, platform_spec,
 *     content_mix, post_count, confidence_mode). The route LOADS all BrandDNA:
 *     brand identity, method_profile, negative_patterns, override_rules,
 *     channels, evidence_bundles (confidence per field), sources summary,
 *     sector_baseline (tone benchmarks), and occasion_intelligence for any
 *     active occasion_flags.
 *   • Reads the Qdrant CaptionContext cache by cache_prefix_hash; on hit, the
 *     LLM call is skipped (Doc §3.2 cache layer).
 *   • Cache key covers brand version, method version, evidence state, channel
 *     state, and latest source ingestion — any BrandDNA write produces a miss.
 *   • Writes the compile result back into the same cache namespace.
 *
 * Token target: 1,200–2,000 tokens (raised from 800–1,200 to carry all 6 layers
 * fully — identity + v6 enrichment + creative direction + constraints + policy +
 * saudi guidance + visual palette + strategy + performance signals).
 */
import { adminClient, brandDnaQ, adminQ, occasionsQ } from '@repo/db'
import { coo } from '@repo/ai'
import { loadGestureBlocks } from '@repo/compliance'
import { z } from 'zod'
import { schemas, computeActiveOccasions, getDominantContentMix, type OccasionContext } from '@repo/core'
import { upsertCaptionContext, getCaptionContext, isVectorsConfigured } from '@repo/vectors'
import { createHash } from 'node:crypto'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    confidence_mode:    schemas.ConfidenceMode,
    occasion_flags:     z.array(z.string()).default([]),
    platform_spec:      z.string().default('Instagram'),
    content_mix:        z.record(z.number()).optional(),
    post_count:         z.number().int().positive().default(20),
    // `brand` and `negative_patterns` are accepted for back-compat but
    // ignored — we re-load them server-side for consistency.
    brand:              z.record(z.unknown()).optional(),
    negative_patterns:  z.array(z.record(z.unknown())).optional(),
    cost_constraint:    schemas.CostStatus.optional(),
  }).passthrough(),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input, ctx) => {
    const db = adminClient()

    // ── Load BrandDNA + supporting data in parallel ────────────────
    // getBrandDna() returns channels, evidence bundles, sources, method
    // profile, audience, visual style — everything in one shot.
    // Sector baseline and active occasion intelligence are loaded alongside.
    const [dna, allSectorBaselines, upcomingOccasions, gestureBlocks] = await Promise.all([
      brandDnaQ.getBrandDna(input.brand_id, db),
      adminQ.getSectorBaselines(),
      occasionsQ.getUpcomingOccasions(),
      loadGestureBlocks(db),
    ])
    if (!dna) {
      return {
        task_type: 'compile_caption_context' as const,
        brand_id: input.brand_id,
        caption_context: '',
        token_count: 1,
        layers_included: [] as Array<'identity' | 'direction' | 'constraints' | 'policy' | 'saudi_guidance'>,
        watermark_flag: false,
        cautious_register_flag: false,
        cache_prefix_hash: 'brand_not_found',
        reasoning: 'brand_not_found — cannot compile context',
        refusal: 'cost_ceiling_breached' as const,
      }
    }

    // ── Compute a stable cache key BEFORE the LLM call ─────────────
    // Key covers everything that affects the compiled context:
    //   brand_version       — bumps on any brand_profiles write
    //   method_version      — bumps on any method_profile write
    //   evidence_version    — bumps when any evidence bundle changes confidence
    //   channel_version     — bumps on channel scrape / follower update
    //   source_version      — bumps when a new source record is ingested
    //   occasion_flags      — different occasions → different Layer 2 content
    //   confidence_mode     — Cautious/Minimal adds watermark/register flags
    //   platform + post_count — structural Layer 2 inputs
    const evidenceVersion = dna.evidence.bundles.length > 0
      ? dna.evidence.bundles.map(b => `${b.field_name}:${b.field_confidence}`).sort().join('|')
      : 'no_evidence'
    const channelVersion = dna.channels.length > 0
      ? dna.channels.map(c => `${c.channel}:${c.followers_count ?? 0}:${c.synced_at ?? ''}`).sort().join('|')
      : 'no_channels'
    const sourceVersion = dna.sources.recent.length > 0
      ? dna.sources.recent[0].captured_at
      : 'no_sources'
    // policy_version covers negative_patterns + global_negative_patterns + override_rules.
    // Any change to these tables produces a cache miss so the LLM re-compiles
    // the policy layer with the updated blocklist/rules.
    const policyVersion = [
      ...(dna.negative_patterns.map(p => `np:${p.pattern_id}:${p.updated_at ?? p.created_at}`)),
      ...(dna.global_negative_patterns.map(p => `gp:${p.pattern_id}:${p.updated_at}`)),
      ...(dna.override_rules.map(r => `or:${r.rule_id}:${r.updated_at ?? r.created_at}`)),
    ].sort().join('|') || 'no_policy'
    const bxCache = dna.brand as unknown as Record<string, unknown>
    const cacheInput = JSON.stringify({
      brand_id:         input.brand_id,
      confidence_mode:  input.payload.confidence_mode,
      occasion_flags:   [...(input.payload.occasion_flags ?? [])].sort(),
      platform_spec:    input.payload.platform_spec,
      post_count:       input.payload.post_count,
      method_version:   dna.method_profile?.updated_at ?? null,
      brand_version:    dna.brand.updated_at,
      evidence_version: evidenceVersion,
      channel_version:  channelVersion,
      source_version:   sourceVersion,
      policy_version:   policyVersion,
      // Layer 2+4 fields — any change busts the context cache
      permission_level:       dna.brand.permission_level ?? null,
      goal_phase:             dna.brand.goal_phase ?? null,
      brave_safe_default:     dna.brand.brave_safe_default ?? false,
      cultural_tension_owned: dna.brand.cultural_tension_owned ?? null,
      strategy_version:       dna.brand.strategy_version ?? 0,
      way_of_speaking:        dna.brand.way_of_speaking ?? null,
      communication_style:    dna.brand.communication_style ?? null,
      brand_goals:            dna.brand.brand_goals ?? null,
      sub_sector:             dna.brand.sub_sector ?? null,
      founded_year:           dna.brand.founded_year ?? null,
      region_primary:         dna.brand.region_primary ?? null,
      // Brand-insight fields — changes here must also bust the cache
      products_list:          bxCache.products_list ?? null,
      cust_desc:              bxCache.cust_desc ?? null,
      caption_ex:             bxCache.caption_ex ?? null,
      custom_restriction:     bxCache.custom_restriction ?? null,
      tagline:                bxCache.tagline ?? null,
      restrictions:           bxCache.restrictions ?? null,
      anything:               bxCache.anything ?? null,
      problems:               bxCache.problems ?? null,
      metric:                 bxCache.metric ?? null,
      brand_assets_bundle:    bxCache.brand_assets_bundle ?? null,
      vision:                 bxCache.vision ?? null,
      vision_text:            bxCache.vision_text ?? null,
    })
    const computedCacheKey = createHash('sha256').update(cacheInput).digest('hex').slice(0, 32)

    const evidenceConfidenceMap: Record<string, string> = {}
    for (const b of dna.evidence.bundles) {
      evidenceConfidenceMap[b.field_name] = b.field_confidence
    }

    const dialectConfirmed = evidenceConfidenceMap['arabic_dialect'] === 'explicitly_confirmed' || 
                             evidenceConfidenceMap['arabic_dialect'] === 'inferred_high' || 
                             !!dna.brand.arabic_dialect;

    // ── Cache read (Doc §3.2) ──────────────────────────────────────
    // Skip the LLM call if a matching compile already exists. Saves
    // ~$0.05 + 20-30s per A01 / A02 call on warm brands.
    if (isVectorsConfigured()) {
      try {
        const cached = await getCaptionContext<{
          caption_context: string
          token_count: number
          layers_included: Array<'identity' | 'direction' | 'constraints' | 'policy' | 'saudi_guidance'>
          watermark_flag: boolean
          cautious_register_flag: boolean
        }>(input.brand_id, `caption_context:${computedCacheKey}`)
        if (cached) {
          return {
            task_type: 'compile_caption_context' as const,
            brand_id: input.brand_id,
            caption_context: cached.caption_context,
            token_count: cached.token_count,
            layers_included: cached.layers_included,
            watermark_flag: cached.watermark_flag,
            cautious_register_flag: cached.cautious_register_flag,
            cache_prefix_hash: computedCacheKey,
            reasoning: 'cache_hit',
            dialect_confirmed: dialectConfirmed,
            // Attach the structured method profile on the cache-hit path too —
            // it's read fresh from `dna` each call (not cached), so warm brands
            // (most A01 runs) still forward method components to the CCO.
            method_profile: dna.method_profile
              ? {
                  voice_register:     dna.method_profile.voice_register,
                  diagnostic_pattern: dna.method_profile.diagnostic_pattern,
                  visual_idiom:       dna.method_profile.visual_idiom,
                  cadence_rule:       dna.method_profile.cadence_rule,
                  closing_pattern:    dna.method_profile.closing_pattern,
                }
              : null,
          }
        }
      } catch (e) {
        console.warn(`[coo/compile-caption-context] cache read failed: ${(e as Error).message}`)
      }
    }

    // ── Derive supporting context from loaded data ────────────────

    // Sector baseline for this brand (tone benchmarks + compliance defaults).
    const sectorBaseline = allSectorBaselines.find(
      b => b.sector === dna.brand.sector &&
           (!dna.brand.arabic_dialect || b.dialect === dna.brand.arabic_dialect),
    ) ?? allSectorBaselines.find(b => b.sector === dna.brand.sector) ?? null

    // Active occasion intelligence — filter upcoming occasions to those named
    // in the caller's occasion_flags. Provides content approach guidance,
    // lead weeks, and recommended mix (COO Layer 2 spec requires this).
    const activeOccasionFlags = input.payload.occasion_flags ?? []
    const activeOccasions = upcomingOccasions.filter(o =>
      activeOccasionFlags.includes(o.occasion_key) ||
      activeOccasionFlags.includes(o.occasion_name_en ?? '') ||
      activeOccasionFlags.includes(o.occasion_name_ar),
    )

    // Primary Instagram channel (most followers if multiple).
    const instagramChannel = dna.channels
      .filter(c => c.channel === 'Instagram')
      .sort((a, b) => (b.followers_count ?? 0) - (a.followers_count ?? 0))[0] ?? null

    // ── Build the enriched payload ────────────────────────────────
    const enrichedPayload: Record<string, unknown> = {
      ...input.payload,
      brand: {
        // Identity
        brand_id:                dna.brand.brand_id,
        brand_name_ar:           dna.brand.brand_name_ar,
        brand_name_en:           dna.brand.brand_name_en,
        sector:                  dna.brand.sector,
        sub_sector:              dna.brand.sub_sector ?? null,
        city_primary:            dna.brand.city_primary,
        region_primary:          dna.brand.region_primary ?? null,
        founded_year:            dna.brand.founded_year ?? null,
        tone_register:           dna.brand.tone_register ?? null,
        // BrandDNA Lite
        arabic_dialect:          dna.brand.arabic_dialect,
        price_position:          dna.brand.price_position,
        bilingual_ratio:         dna.brand.bilingual_ratio,
        formality_level:         dna.brand.formality_level,
        humor_tolerance:         dna.brand.humor_tolerance,
        religious_sensitivity:   dna.brand.religious_sensitivity,
        ramadan_relevance:       dna.brand.ramadan_relevance,
        brand_differentiator:    dna.brand.brand_differentiator,
        primary_channel:         dna.brand.primary_channel,
        primary_kpi_type:        dna.brand.primary_kpi_type,
        tone_anti_attribute_ids: dna.brand.tone_anti_attribute_ids,
        primary_color_hex:       dna.brand.primary_color_hex,
        // v2 axis fields
        archetype_primary:       dna.brand.archetype_primary,
        archetype_secondary:     dna.brand.archetype_secondary,
        lifecycle_stage:         dna.brand.lifecycle_stage,
        intent_state:            dna.brand.intent_state,
        completeness_score:      dna.brand.completeness_score,
        // Layer 2 — Owner Profile
        founding_story:          dna.brand.founding_story ?? null,
        comfort_on_camera:       dna.brand.comfort_on_camera ?? null,
        way_of_speaking:         dna.brand.way_of_speaking ?? null,
        content_preferences:     dna.brand.content_preferences ?? [],
        owner_values:            dna.brand.owner_values ?? null,
        communication_style:     dna.brand.communication_style ?? null,
        brand_goals:             dna.brand.brand_goals ?? null,
        // Layer 3 — Visual/Content Identity
        posting_rhythm:          dna.brand.posting_rhythm ?? null,
        caption_style:           dna.brand.caption_style ?? null,
        // Layer 4 — Strategic Intelligence
        permission_level:        dna.brand.permission_level ?? null,
        goal_phase:              dna.brand.goal_phase ?? null,
        brave_safe_default:      dna.brand.brave_safe_default ?? false,
        cultural_tension_owned:  dna.brand.cultural_tension_owned ?? null,
        creative_formulas_approved: dna.brand.creative_formulas_approved ?? [],
        content_mix_ratios:      dna.brand.content_mix_ratios ?? null,
        platform_weights:        dna.brand.platform_weights ?? null,
        occasion_approach:       dna.brand.occasion_approach ?? null,
        strategy_version:        dna.brand.strategy_version ?? 0,
        // v6 fields — BrandProfile lacks index signature; use double-cast
        ...(() => {
          const bx = dna.brand as unknown as Record<string, unknown>
          return {
            emotions:        bx.emotions        ?? [],
            lifestyle:       bx.lifestyle        ?? null,
            occasions_ranked: bx.occasions_ranked ?? [],
            platforms:       bx.platforms        ?? [],
            music:           bx.music            ?? null,
            music_link:      bx.music_link       ?? null,
            scale_minmax:    bx.scale_minmax     ?? null,
            scale_quietloud: bx.scale_quietloud  ?? null,
            scale_localglobal: bx.scale_localglobal ?? null,
            scale_tradmod:   bx.scale_tradmod    ?? null,
            scale_custom:    bx.scale_custom     ?? null,
            brand_refs:      bx.brand_refs       ?? [],
            price_nums:      bx.price_nums       ?? null,
            vision:          bx.vision           ?? null,
            vision_text:     bx.vision_text      ?? null,
            respected_brands: bx.respected_brands ?? null,
            respected_why:   bx.respected_why    ?? null,
            hero_why:        bx.hero_why         ?? null,
            name_meaning:    bx.name_meaning     ?? null,
            tagline:         bx.tagline          ?? null,
            social:          bx.social           ?? null,
            // Brand-insight wizard fields — collected after onboarding
            products_list:   bx.products_list    ?? null,
            cust_desc:       bx.cust_desc        ?? null,
            cust_quote:      bx.cust_quote       ?? null,
            caption_ex:      bx.caption_ex       ?? null,
            custom_restriction: bx.custom_restriction ?? null,
            metric:          bx.metric           ?? null,
            // v6 additional enrichment
            restrictions:    bx.restrictions     ?? [],   // absolute brand restrictions
            anything:        bx.anything         ?? null, // owner free-text brand words
            problems:        bx.problems         ?? [],   // past content problems to avoid
            // Channel performance stats (from extraction_prefill + direct fields)
            ig_post_count:                bx.ig_post_count                ?? null,
            posting_frequency_per_week:   bx.posting_frequency_per_week   ?? null,
            content_type_distribution:    bx.content_type_distribution    ?? null,
            caption_avg_length:           bx.caption_avg_length           ?? null,
            primary_content_format:       bx.primary_content_format       ?? null,
            // Brand visual asset references for image prompt grounding
            brand_assets_bundle: (() => {
              const bundle = bx.brand_assets_bundle
              if (!Array.isArray(bundle) || bundle.length === 0) return []
              // Pass only URL + name — no binary data, just references
              return (bundle as Array<Record<string, unknown>>).slice(0, 6).map(a => ({
                url:  a.url,
                name: a.name,
                mime: a.mime,
              }))
            })(),
          }
        })(),
      },
      method_profile:             dna.method_profile,
      negative_patterns:          dna.negative_patterns,
      global_negative_patterns:   dna.global_negative_patterns,
      override_rules:             dna.override_rules,
      // Cultural gesture hard blocks (doc §11.1) — COO emits these in Layer 4
      // so DeepSeek's visual_brief_en avoids them. occasion_scope rows (e.g.
      // ramadan_daylight) are activated by the matching occasion_flag.
      cultural_gesture_blocks:    gestureBlocks,
      audience:          dna.audience,
      visual_style:      dna.visual_style,

      // ── Newly added: evidence, channel, sector, occasion context ──

      // Field-level confidence — tells COO which fields are weak/strong so
      // it can weight them correctly in the compiled context.
      evidence_confidence: evidenceConfidenceMap,
      evidence_summary:    dna.evidence.summary,

      // Primary Instagram channel for follower count, engagement rate, bio.
      primary_channel_profile: instagramChannel,

      // Sector baseline — tone benchmarks, recommended content mix defaults,
      // compliance rules for sectors like Healthcare/Finance/Government.
      sector_baseline: sectorBaseline ? {
        sector:                   sectorBaseline.sector,
        dialect:                  sectorBaseline.dialect,
        recommended_content_mix:  sectorBaseline.recommended_content_mix,
        top_performing_tones:     sectorBaseline.top_performing_tones,
        worst_performing_tones:   sectorBaseline.worst_performing_tones,
        occasion_insights:        sectorBaseline.occasion_insights,
        confidence_benchmarks:    sectorBaseline.confidence_benchmarks,
      } : null,

      // Active occasion intelligence — Calendar Engine phase-adjusted mixes.
      // Replaces raw recommended_mix with phase-aware, goal-phase-modified values.
      // e.g. Ramadan build-up gets spiritual_warmth register + 60% emotional mix;
      // National Day peak gets 80% occasion content; etc. (spec §5.2)
      active_occasions: (() => {
        const occasionCtxs: OccasionContext[] = activeOccasions.map(o => ({
          occasion_key:         o.occasion_key,
          occasion_name_ar:     o.occasion_name_ar,
          gregorian_date:       o.gregorian_date,
          lead_weeks:           o.lead_weeks,
          base_mix:             (o.recommended_mix as Record<string, number>) ?? {},
          sector_applicability: (o.sector_applicability as Record<string, boolean>) ?? {},
        }))
        const goalPhase = (dna.brand.goal_phase as string | null) ?? null
        const sector    = dna.brand.sector ?? null
        const adjusted  = computeActiveOccasions(occasionCtxs, new Date(), goalPhase, sector)
        return adjusted.map((adj, i) => {
          const raw = activeOccasions[i]
          return {
            occasion_key:      adj.occasion_key,
            occasion_name_ar:  raw?.occasion_name_ar ?? adj.occasion_key,
            occasion_name_en:  raw?.occasion_name_en ?? null,
            gregorian_date:    raw?.gregorian_date ?? '',
            lead_weeks:        raw?.lead_weeks ?? 2,
            priority:          raw?.priority ?? 'Medium',
            // Phase-adjusted mix — this is what COO should use for content planning
            recommended_mix:   adj.adjusted_mix,
            // Raw base mix — for reference / override
            base_mix:          raw?.recommended_mix ?? {},
            // Calendar Engine metadata
            phase:             adj.phase,
            days_until:        adj.days_until,
            frequency_boost:   adj.frequency_boost,
            register_shift:    adj.register_shift,
            sector_applicability: raw?.sector_applicability ?? {},
          }
        })
      })(),

      // Dominant content mix — Calendar Engine blend of brand base mix + top occasion
      dominant_content_mix: (() => {
        const brandBaseMix = (dna.brand.content_mix_ratios as Record<string, number> | null) ?? {}
        const occasionCtxs: OccasionContext[] = activeOccasions.map(o => ({
          occasion_key:         o.occasion_key,
          occasion_name_ar:     o.occasion_name_ar,
          gregorian_date:       o.gregorian_date,
          lead_weeks:           o.lead_weeks,
          base_mix:             (o.recommended_mix as Record<string, number>) ?? {},
          sector_applicability: (o.sector_applicability as Record<string, boolean>) ?? {},
        }))
        const goalPhase = (dna.brand.goal_phase as string | null) ?? null
        const adjusted  = computeActiveOccasions(occasionCtxs, new Date(), goalPhase, dna.brand.sector ?? null)
        return getDominantContentMix(brandBaseMix, adjusted)
      })(),

      // Source record freshness — tells COO how recent the scraper data is.
      sources_summary: {
        count:   dna.sources.count,
        by_type: dna.sources.by_type,
        most_recent_captured_at: dna.sources.recent[0]?.captured_at ?? null,
      },

      // ── Additional Layer data for richer caption context ──────────────
      // Signature phrases/hashtags from IG posts (brand's own catchphrases)
      signature_phrases:   (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.signature_phrases as string[] | null) ?? [] })(),
      signature_hashtags:  (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.signature_hashtags as string[] | null) ?? [] })(),
      brand_reply_samples: (() => { const bx = dna.brand as unknown as Record<string,unknown>; return ((bx.brand_reply_samples as string[] | null) ?? []).slice(0, 5) })(),
      top_hashtags:        (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.top_hashtags as string[] | null) ?? [] })(),
      bio_text:            (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.bio_text as string | null) ?? null })(),

      // Engagement baselines — for calibrating post score targets
      engagement_baseline: {
        likes:    (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.engagement_baseline_likes as number | null) ?? null })(),
        comments: (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.engagement_baseline_comments as number | null) ?? null })(),
        followers: (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.followers_count as number | null) ?? null })(),
        avg_engagement_rate: (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.avg_engagement_rate as number | null) ?? null })(),
        primary_content_format: (() => { const bx = dna.brand as unknown as Record<string,unknown>; return (bx.primary_content_format as string | null) ?? null })(),
      },

      // Sector knowledge corpus — gold patterns for this sector
      knowledge_corpus: await (async () => {
        try {
          const { data: kc } = await db
            .from('knowledge_corpus')
            .select('pattern_key, pattern_type, description, content_type, confidence')
            .eq('sector', dna.brand.sector ?? '')
            .eq('is_active' as never, true)
            .order('confidence', { ascending: false })
            .limit(10)
          return (kc ?? []) as Array<{ pattern_key: string; pattern_type: string; description: string; confidence: number }>
        } catch { return [] }
      })(),

      // ── Layer 1: brand_post_observations — actual scraped post archive ──
      // Prompt §Layer-1 says "Use this — NOT the truncated posts_sample[]".
      // Pass top 10 by engagement (likes+comments) with actual Arabic captions
      // so COO can analyze voice register, cadence, opening/closing patterns.
      recent_post_observations: await (async () => {
        try {
          const { data: posts } = await db
            .from('brand_post_observations')
            .select('ig_post_id, post_type, caption, hashtags, likes_count, comments_count, posted_at, emoji_count, language_detected')
            .eq('brand_id', input.brand_id)
            .order('likes_count', { ascending: false })
            .limit(10)
          return (posts ?? []).map((p) => ({
            id:         (p as Record<string,unknown>).ig_post_id,
            type:       (p as Record<string,unknown>).post_type,
            caption:    (p as Record<string,unknown>).caption,
            hashtags:   (p as Record<string,unknown>).hashtags,
            likes:      (p as Record<string,unknown>).likes_count,
            comments:   (p as Record<string,unknown>).comments_count,
            posted_at:  (p as Record<string,unknown>).posted_at,
            emoji_count:(p as Record<string,unknown>).emoji_count,
            language:   (p as Record<string,unknown>).language_detected,
          }))
        } catch { return [] }
      })(),

      // ── Layer 5: Asset library — approved visual/caption examples ──────
      // Examples the brand has approved (or rejected) — tells COO what works.
      asset_library: (() => {
        const assets = dna.assets ?? { approved: [], rejected: [], lora_candidates: [] }
        return {
          approved_count: assets.approved?.length ?? 0,
          rejected_count: assets.rejected?.length ?? 0,
          // Pass up to 5 approved asset descriptions for style reference
          approved_samples: (assets.approved ?? []).slice(0, 5).map((a) => {
            const ax = a as unknown as Record<string,unknown>; return {
            asset_type: ax.asset_type,
            caption_ar: ax.caption_ar,
            score:      ax.score,
          }}),
        }
      })(),

      // ── Layer 5: Competitor intelligence ────────────────────────────────
      competitors: (() => {
        const comp = dna.competitors ?? { accounts: [], latest_snapshots: [] }
        return {
          count: comp.accounts?.length ?? 0,
          accounts: (comp.accounts ?? []).slice(0, 3).map((a) => {
            const ax = a as unknown as Record<string,unknown>
            return { handle: ax.handle_instagram, sector: ax.sector }
          }),
          snapshots: (comp.latest_snapshots ?? []).slice(0, 3).map((s) => {
            const sx = s as unknown as Record<string,unknown>
            return { handle: sx.handle_instagram, avg_engagement: sx.avg_engagement_rate,
              top_content_type: sx.top_content_type, posting_frequency: sx.posting_frequency, content_gaps: sx.content_gaps }
          }),
        }
      })(),

      // ── Layer 6: Brand content patterns ─────────────────────────────────
      content_patterns: (() => {
        const cp = dna.content_patterns ?? { winners: [], losers: [] }
        const mapP = (p: unknown) => {
          const px = p as unknown as Record<string,unknown>
          return { pattern_key: px.pattern_key, content_type: px.content_type, avg_score: px.avg_performance_score, description: px.description }
        }
        return {
          winners: (cp.winners ?? []).slice(0, 5).map(mapP),
          losers:  (cp.losers  ?? []).slice(0, 3).map(mapP),
          has_performance_data: ((cp.winners?.length ?? 0) + (cp.losers?.length ?? 0)) > 0,
        }
      })(),

      // ── Occasion intelligence raw data ───────────────────────────────────
      occasion_intelligence_raw: upcomingOccasions
        .filter((o) => {
          const flags = input.payload.occasion_flags ?? []
          return flags.length === 0 || flags.includes(o.occasion_key) || flags.includes('none') === false
        })
        .slice(0, 6)
        .map((o) => {
          const ox = o as unknown as Record<string,unknown>
          return {
          occasion_key:         o.occasion_key,
          occasion_name_ar:     o.occasion_name_ar,
          occasion_name_en:     ox.occasion_name_en,
          gregorian_date:       o.gregorian_date,
          lead_weeks:           o.lead_weeks,
          priority:             ox.priority,
          recommended_mix:      o.recommended_mix,
          sector_applicability: o.sector_applicability,
        }}),

      // ── Composition matrix result for this brand's archetype/lifecycle/intent ──
      // Pre-compute the recommended method score so COO doesn't need a tool call.
      // This surfaces the Three-Axis Framework v2 composition decision directly.
      composition_matrix_hint: await (async () => {
        try {
          const archetype  = dna.brand.archetype_primary ?? null
          const lifecycle  = dna.brand.lifecycle_stage   ?? null
          const intent     = dna.brand.intent_state      ?? null
          if (!archetype || !lifecycle || !intent) return null
          const { data: row } = await db
            .from('composition_matrix')
            .select('recommended_method, is_hybrid_recommended, hybrid_composition, authenticity_score, vulnerability_score, diagnostic_score, metaphor_score, paradox_score, heritage_score')
            .eq('archetype'       as never, archetype)
            .eq('lifecycle_stage' as never, lifecycle)
            .eq('intent_state'    as never, intent)
            .maybeSingle()
          return row as Record<string,unknown> | null
        } catch { return null }
      })(),

      // ── Onboarding responses — what the brand owner actually said ────────
      // Maps question → answer for all 55 questions. Lets COO cross-check
      // that critical fields came from explicit user answers vs AI inference.
      onboarding_responses: await (async () => {
        try {
          const { data: responses } = await db
            .from('onboarding_responses')
            .select('answer_raw, confidence_weight, onboarding_questions(maps_to_field, question_text_en)')
            .eq('brand_id', input.brand_id)
            .limit(60)
          return (responses ?? []).map((r) => {
            const q = (r as Record<string,unknown>).onboarding_questions as Record<string,unknown> | null
            return {
              field:      q?.maps_to_field ?? null,
              question:   q?.question_text_en ?? null,
              answer:     (r as Record<string,unknown>).answer_raw,
              confidence: (r as Record<string,unknown>).confidence_weight,
            }
          })
        } catch { return [] }
      })(),

      // ── Global negative patterns — pre-filtered HARD_BLOCKs ─────────────
      // Pre-filter by severity so COO sees the most critical rules first.
      global_negative_patterns_by_severity: (() => {
        const allGnp = (dna.global_negative_patterns ?? []) as unknown as Array<{ severity: string; pattern_text: string; category: string }>
        const toItem = (p: { pattern_text: string; category: string }) => ({ text: p.pattern_text, category: p.category })
        return {
          hard_blocks:  allGnp.filter((p) => p.severity === 'HARD_BLOCK').map(toItem),
          strong_warns: allGnp.filter((p) => p.severity === 'STRONG_WARN').map(toItem),
        }
      })(),
    }

    const result = await coo.compileCaptionContext(enrichedPayload, {
      flow_id: ctx.flowId,
      brand_id: input.brand_id,
      db,
    })

    // Override structural flags server-side — these are pipeline decisions
    // derived from confidence_mode, not LLM content decisions.
    //   watermark_flag      = true for Cautious or Minimal (COO spec §Layer 1)
    //   cautious_register_flag = true for Minimal only
    const confidenceMode = input.payload.confidence_mode

    const resultWithStableKey = {
      ...result,
      cache_prefix_hash:      computedCacheKey,
      watermark_flag:         confidenceMode === 'Cautious' || confidenceMode === 'Minimal',
      cautious_register_flag: confidenceMode === 'Minimal',
      dialect_confirmed:      dialectConfirmed,
      // Expose the brand's STRUCTURED method profile alongside the compiled
      // prose context. Already loaded above (dna.method_profile) — no extra DB
      // call. A01 forwards these five components to the CCO so the v2
      // method-adherence weight (30% of the score) can actually be graded,
      // instead of being lost when the prose context is truncated for the CCO.
      method_profile: dna.method_profile
        ? {
            voice_register:     dna.method_profile.voice_register,
            diagnostic_pattern: dna.method_profile.diagnostic_pattern,
            visual_idiom:       dna.method_profile.visual_idiom,
            cadence_rule:       dna.method_profile.cadence_rule,
            closing_pattern:    dna.method_profile.closing_pattern,
          }
        : null,
    }

    // Side-effect (Doc §3.2 cache layer): cache the compiled context into the
    // brand's Qdrant namespace so subsequent A01 runs with the same
    // cache_prefix_hash skip the LLM call. Best-effort: a Qdrant write
    // failure here is non-fatal — the compile already returned successfully.
    if (isVectorsConfigured() && resultWithStableKey.caption_context) {
      try {
        await upsertCaptionContext(
          input.brand_id,
          `caption_context:${resultWithStableKey.cache_prefix_hash}`,
          {
            kind:                   'compiled_caption_context',
            caption_context:        resultWithStableKey.caption_context,
            token_count:            resultWithStableKey.token_count,
            layers_included:        resultWithStableKey.layers_included,
            watermark_flag:         resultWithStableKey.watermark_flag,
            cautious_register_flag: resultWithStableKey.cautious_register_flag,
            cache_prefix_hash:      resultWithStableKey.cache_prefix_hash,
            compiled_at:            new Date().toISOString(),
            flow_id:                ctx.flowId,
            request_id:             ctx.requestId,
          },
        )
      } catch (e) {
        console.warn(`[coo/compile-caption-context] qdrant cache failed: ${(e as Error).message}`)
      }
    }

    return resultWithStableKey
  },
})
