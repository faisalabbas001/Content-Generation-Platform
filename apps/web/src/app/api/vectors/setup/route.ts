/**
 * POST /api/vectors/setup
 *
 * Creates the per-brand Qdrant collection (Doc §3.2, §5.3 step 4).
 * Called by N8N-A03 once after BrandDNA is built and Memory Controller has
 * drained. Idempotent — safe to call again on retry.
 *
 * Body: { brand_id }
 * Response: { ok, request_id, result: { collection, created } }
 *
 * Security: HMAC-signed (n8n-only, same scheme as /api/agents/*).
 */
import { z } from 'zod'
import { setupBrandNamespace, isVectorsConfigured, upsertCaptionContext } from '@repo/vectors'
import { adminClient } from '@repo/db/client'
import { brandDnaQ } from '@repo/db'
import { coo } from '@repo/ai'
import { createHash } from 'node:crypto'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id: z.string().min(1).default('vectors_setup'),
  brand_id: z.string().uuid(),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'vectors_setup',
  handler: async (input) => {
    if (!isVectorsConfigured()) {
      return { collection: null, created: false, skipped: true, reason: 'qdrant_not_configured' }
    }
    const result = await setupBrandNamespace(input.brand_id)
    const db = adminClient()

    // Persist the collection name on brand_profiles.vector_namespace (mig 0030)
    // so downstream readers know setup actually succeeded. Non-fatal: a write
    // failure here doesn't unmake the Qdrant collection.
    if (result.collection) {
      const { error } = await db
        .from('brand_profiles')
        .update({ vector_namespace: result.collection } as never)
        .eq('brand_id', input.brand_id)
      if (error) console.warn('[vectors/setup] vector_namespace update failed:', error.message)
    }

    // ── Onboarding caption seed (Cluster D) ───────────────────────────
    // A01 retrieves caption examples from the brand's Qdrant collection. If
    // the namespace is empty (which it is post-setup), the very first calendar
    // run has no retrieval context. Seed it now with every scraped post from
    // brand_post_observations, so A01 / V01 have something to anchor against
    // from day one. Payload-only points (no vector) — A01 will overwrite with
    // real embeddings when it generates its own captions.
    //
    // Idempotent: deterministicPointId(key) means re-running this route
    // doesn't duplicate points. Non-fatal: a Qdrant failure here doesn't
    // unmake the brand_profiles update.
    let captions_seeded = 0
    let captions_skipped: string | undefined
    try {
      const { data: posts, error: postsErr } = await db
        .from('brand_post_observations')
        .select('ig_post_id, caption, hashtags, mentions, likes_count, comments_count, posted_at, post_type')
        .eq('brand_id', input.brand_id)
        .order('posted_at', { ascending: false })
        .limit(30)
      if (postsErr) {
        captions_skipped = `post_load_failed: ${postsErr.message}`
      } else if (!posts || posts.length === 0) {
        captions_skipped = 'no_posts'
      } else {
        for (const p of posts as Array<{
          ig_post_id: string; caption: string | null; hashtags: string[]; mentions: string[];
          likes_count: number; comments_count: number; posted_at: string | null; post_type: string;
        }>) {
          if (!p.caption || p.caption.length < 4) continue
          try {
            await upsertCaptionContext(
              input.brand_id,
              `onboarding_seed:${p.ig_post_id}`,
              {
                kind:       'scraped_caption',
                source:     'instagram',
                ig_post_id: p.ig_post_id,
                caption:    p.caption,
                hashtags:   p.hashtags ?? [],
                mentions:   p.mentions ?? [],
                likes:      p.likes_count,
                comments:   p.comments_count,
                posted_at:  p.posted_at,
                post_type:  p.post_type,
              },
            )
            captions_seeded++
          } catch (e) {
            console.warn(`[vectors/setup] caption seed failed for ${p.ig_post_id}: ${(e as Error).message}`)
          }
        }
      }
    } catch (e) {
      console.warn(`[vectors/setup] caption seeding crashed: ${(e as Error).message}`)
      captions_skipped = (e as Error).message
    }

    // ── Pre-warm the default CaptionContext (FIRE-AND-FORGET) ─────
    // The COO LLM call takes ~8-12s. If we await it, the HTTP response
    // arrives after n8n's node timeout fires (10s) and n8n reports
    // "connection aborted" even though the server returned 200.
    //
    // Solution: kick off the pre-warm in a background microtask and
    // return immediately. The compiled context lands in Qdrant within
    // ~15s of the 200 response — well before A01 / A02 would query it.
    // A 25s AbortSignal guards against runaway LLM calls.
    const caption_context_compiled  = false   // always false in response body;
    const caption_context_token_count = 0     // background task owns the real value.
    const caption_context_skipped: string | undefined = undefined

    // Snapshot inputs needed by the background closure before we return.
    const brandIdForPrewarm = input.brand_id
    void (async () => {
      try {
        const dna = await brandDnaQ.getBrandDna(brandIdForPrewarm, db)
        if (!dna) {
          console.info(`[vectors/setup] prewarm skip: brand_dna_not_found brand=${brandIdForPrewarm}`)
          return
        }
        const defaultInputs = {
          confidence_mode: dna.current_confidence?.mode ?? 'Cautious',
          occasion_flags: [] as string[],
          platform_spec: dna.brand.primary_channel ?? 'Instagram',
          post_count: 20,
        }
        const cacheInput = JSON.stringify({
          brand_id: brandIdForPrewarm,
          confidence_mode: defaultInputs.confidence_mode,
          occasion_flags: [...defaultInputs.occasion_flags].sort(),
          platform_spec: defaultInputs.platform_spec,
          post_count: defaultInputs.post_count,
          method_version: dna.method_profile?.updated_at ?? null,
          brand_version: dna.brand.updated_at,
        })
        const computedCacheKey = createHash('sha256').update(cacheInput).digest('hex').slice(0, 32)

        const enrichedPayload = {
          confidence_mode: defaultInputs.confidence_mode,
          occasion_flags:  defaultInputs.occasion_flags,
          platform_spec:   defaultInputs.platform_spec,
          content_mix:     { educational: 0.3, experiential: 0.4, promotional: 0.3 } as Record<string, number>,
          post_count:      defaultInputs.post_count,
          brand: {
            brand_id:               dna.brand.brand_id,
            brand_name_ar:          dna.brand.brand_name_ar,
            brand_name_en:          dna.brand.brand_name_en,
            sector:                 dna.brand.sector,
            city_primary:           dna.brand.city_primary,
            arabic_dialect:         dna.brand.arabic_dialect,
            price_position:         dna.brand.price_position,
            bilingual_ratio:        (dna.brand as { bilingual_ratio?: string }).bilingual_ratio,
            formality_level:        (dna.brand as { formality_level?: string }).formality_level,
            humor_tolerance:        (dna.brand as { humor_tolerance?: string }).humor_tolerance,
            religious_sensitivity:  dna.brand.religious_sensitivity,
            ramadan_relevance:      (dna.brand as { ramadan_relevance?: string }).ramadan_relevance,
            brand_differentiator:   dna.brand.brand_differentiator,
            primary_channel:        dna.brand.primary_channel,
            primary_kpi_type:       (dna.brand as { primary_kpi_type?: string }).primary_kpi_type,
            tone_anti_attribute_ids: (dna.brand as { tone_anti_attribute_ids?: string[] }).tone_anti_attribute_ids,
            primary_color_hex:      dna.brand.primary_color_hex,
            archetype_primary:      dna.brand.archetype_primary,
            archetype_secondary:    dna.brand.archetype_secondary,
            lifecycle_stage:        dna.brand.lifecycle_stage,
            intent_state:           dna.brand.intent_state,
            completeness_score:     dna.brand.completeness_score,
          },
          method_profile:    dna.method_profile,
          negative_patterns: dna.negative_patterns,
          override_rules:    dna.override_rules,
          audience:          dna.audience,
          visual_style:      dna.visual_style,
        } as Record<string, unknown>

        const compiled = await coo.compileCaptionContext(enrichedPayload, {
          flow_id: 'N8N-A03',
          brand_id: brandIdForPrewarm,
          db,
        })

        await upsertCaptionContext(
          brandIdForPrewarm,
          `caption_context:${computedCacheKey}`,
          {
            kind:                   'compiled_caption_context',
            caption_context:        compiled.caption_context,
            token_count:            compiled.token_count,
            layers_included:        compiled.layers_included,
            watermark_flag:         compiled.watermark_flag,
            cautious_register_flag: compiled.cautious_register_flag,
            cache_prefix_hash:      computedCacheKey,
            compiled_at:            new Date().toISOString(),
            flow_id:                'N8N-A03',
            prewarmed:              true,
          },
        )
        console.info(`[vectors/setup] prewarm ok brand=${brandIdForPrewarm} tokens=${compiled.token_count}`)
      } catch (e) {
        console.warn(`[vectors/setup] prewarm failed brand=${brandIdForPrewarm}: ${(e as Error).message}`)
      }
    })()

    return {
      ...result,
      captions_seeded,
      captions_skipped,
      caption_context_compiled,
      caption_context_token_count,
      caption_context_skipped,
    }
  },
})
