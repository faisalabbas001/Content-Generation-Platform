/**
 * One-shot script: regenerate + verify caption context for zoi-q2sp
 * Run: pnpm tsx scripts/test-caption-context.ts
 */
import { config } from 'dotenv'
config({ path: 'apps/web/.env.local' })

import { adminClient, brandDnaQ, adminQ, occasionsQ } from '../packages/db/src/index'
import { coo } from '../packages/ai/src/index'
import { computeActiveOccasions, getDominantContentMix } from '../packages/core/src/index'
import { writeFileSync } from 'node:fs'

const BID = '3cf8ed28-ed1d-4f12-9a65-684f041e90a0'

async function main() {
const db = adminClient()

console.log('⏳ Loading BrandDNA for zoi-q2sp...')

const [dna, allSectorBaselines, upcomingOccasions] = await Promise.all([
  brandDnaQ.getBrandDna(BID, db),
  adminQ.getSectorBaselines(),
  occasionsQ.getUpcomingOccasions(),
])

if (!dna) { console.error('❌ brand not found'); process.exit(1) }

console.log('✅ DNA loaded')
console.log('   method_profile:', dna.method_profile?.voice_register ?? 'MISSING')
console.log('   channels:', dna.channels?.length ?? 0)
console.log('   evidence bundles:', dna.evidence?.bundles?.length ?? 0)
console.log('   negative_patterns:', dna.negative_patterns?.length ?? 0)
console.log('   visual_style:', !!dna.visual_style)
console.log('   audience:', !!dna.audience)

const bx = dna.brand as unknown as Record<string, unknown>
const sectorBaseline = allSectorBaselines.find(
  b => b.sector === dna.brand.sector && (!dna.brand.arabic_dialect || b.dialect === dna.brand.arabic_dialect)
) ?? allSectorBaselines.find(b => b.sector === dna.brand.sector) ?? null

const instagramChannel = dna.channels
  .filter((c) => c.channel === 'Instagram')
  .sort((a, b) => (b.followers_count ?? 0) - (a.followers_count ?? 0))[0] ?? null

const evidenceConfidenceMap: Record<string, string> = {}
for (const b of dna.evidence.bundles) {
  evidenceConfidenceMap[b.field_name] = b.field_confidence
}

// Compute occasions
const activeOccasionFlags: string[] = []
const activeOccasions = upcomingOccasions.filter(o =>
  activeOccasionFlags.includes(o.occasion_key) ||
  activeOccasionFlags.includes(o.occasion_name_en ?? '') ||
  activeOccasionFlags.includes(o.occasion_name_ar),
)

// Knowledge corpus
let knowledge_corpus: unknown[] = []
try {
  const { data: kc } = await db
    .from('knowledge_corpus')
    .select('pattern_key, pattern_type, description, content_type, confidence')
    .eq('sector', dna.brand.sector ?? '')
    .eq('is_active' as never, true)
    .order('confidence', { ascending: false })
    .limit(10)
  knowledge_corpus = kc ?? []
} catch { /**/ }

// Recent posts
let recent_post_observations: unknown[] = []
try {
  const { data: posts } = await db
    .from('brand_post_observations')
    .select('ig_post_id, post_type, caption, hashtags, likes_count, comments_count, posted_at, emoji_count, language_detected')
    .eq('brand_id', BID)
    .order('likes_count', { ascending: false })
    .limit(10)
  recent_post_observations = (posts ?? []).map((p) => {
    const px = p as Record<string, unknown>
    return { id: px.ig_post_id, type: px.post_type, caption: px.caption, hashtags: px.hashtags,
      likes: px.likes_count, comments: px.comments_count, posted_at: px.posted_at, emoji_count: px.emoji_count }
  })
} catch { /**/ }

// Composition matrix
let composition_matrix_hint: unknown = null
try {
  const archetype = dna.brand.archetype_primary ?? null
  const lifecycle = dna.brand.lifecycle_stage ?? null
  const intent    = dna.brand.intent_state ?? null
  if (archetype && lifecycle && intent) {
    const { data: row } = await db
      .from('composition_matrix')
      .select('recommended_method, is_hybrid_recommended, hybrid_composition, authenticity_score, vulnerability_score, diagnostic_score, metaphor_score, paradox_score, heritage_score')
      .eq('archetype' as never, archetype)
      .eq('lifecycle_stage' as never, lifecycle)
      .eq('intent_state' as never, intent)
      .maybeSingle()
    composition_matrix_hint = row
  }
} catch { /**/ }

// Onboarding responses
let onboarding_responses: unknown[] = []
try {
  const { data: responses } = await db
    .from('onboarding_responses')
    .select('answer_raw, confidence_weight, onboarding_questions(maps_to_field, question_text_en)')
    .eq('brand_id', BID)
    .limit(60)
  onboarding_responses = (responses ?? []).map((r) => {
    const rx = r as Record<string, unknown>
    const q = rx.onboarding_questions as Record<string, unknown> | null
    return { field: q?.maps_to_field ?? null, question: q?.question_text_en ?? null, answer: rx.answer_raw, confidence: rx.confidence_weight }
  })
} catch { /**/ }

// Build enriched payload — mirrors the route exactly
const enrichedPayload: Record<string, unknown> = {
  confidence_mode: 'Standard',
  occasion_flags: [],
  platform_spec: 'Instagram',
  post_count: 20,
  brand: {
    brand_id:                dna.brand.brand_id,
    brand_name_ar:           dna.brand.brand_name_ar,
    brand_name_en:           dna.brand.brand_name_en,
    sector:                  dna.brand.sector,
    sub_sector:              dna.brand.sub_sector ?? null,
    city_primary:            dna.brand.city_primary,
    region_primary:          dna.brand.region_primary ?? null,
    founded_year:            dna.brand.founded_year ?? null,
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
    archetype_primary:       dna.brand.archetype_primary,
    archetype_secondary:     dna.brand.archetype_secondary,
    lifecycle_stage:         dna.brand.lifecycle_stage,
    intent_state:            dna.brand.intent_state,
    completeness_score:      dna.brand.completeness_score,
    founding_story:          dna.brand.founding_story ?? null,
    comfort_on_camera:       dna.brand.comfort_on_camera ?? null,
    way_of_speaking:         dna.brand.way_of_speaking ?? null,
    content_preferences:     dna.brand.content_preferences ?? [],
    owner_values:            dna.brand.owner_values ?? null,
    communication_style:     dna.brand.communication_style ?? null,
    brand_goals:             dna.brand.brand_goals ?? null,
    posting_rhythm:          dna.brand.posting_rhythm ?? null,
    caption_style:           dna.brand.caption_style ?? null,
    permission_level:        dna.brand.permission_level ?? null,
    goal_phase:              dna.brand.goal_phase ?? null,
    brave_safe_default:      dna.brand.brave_safe_default ?? false,
    cultural_tension_owned:  dna.brand.cultural_tension_owned ?? null,
    creative_formulas_approved: dna.brand.creative_formulas_approved ?? [],
    content_mix_ratios:      dna.brand.content_mix_ratios ?? null,
    platform_weights:        dna.brand.platform_weights ?? null,
    occasion_approach:       dna.brand.occasion_approach ?? null,
    strategy_version:        dna.brand.strategy_version ?? 0,
    emotions:                bx.emotions        ?? [],
    lifestyle:               bx.lifestyle       ?? null,
    occasions_ranked:        bx.occasions_ranked ?? [],
    platforms:               bx.platforms       ?? [],
    music:                   bx.music           ?? null,
    brand_refs:              bx.brand_refs      ?? [],
    price_nums:              bx.price_nums      ?? null,
    vision:                  bx.vision          ?? null,
    vision_text:             bx.vision_text     ?? null,
    respected_brands:        bx.respected_brands ?? null,
    respected_why:           bx.respected_why   ?? null,
    hero_why:                bx.hero_why        ?? null,
    name_meaning:            bx.name_meaning    ?? null,
    tagline:                 bx.tagline         ?? null,
    social:                  bx.social          ?? null,
    products_list:           bx.products_list   ?? null,
    cust_desc:               bx.cust_desc       ?? null,
    cust_quote:              bx.cust_quote      ?? null,
    caption_ex:              bx.caption_ex      ?? null,
    custom_restriction:      bx.custom_restriction ?? null,
    metric:                  bx.metric          ?? null,
    restrictions:            bx.restrictions    ?? [],
    anything:                bx.anything        ?? null,
    problems:                bx.problems        ?? [],
    ig_post_count:           bx.ig_post_count   ?? null,
    posting_frequency_per_week: bx.posting_frequency_per_week ?? null,
    content_type_distribution:  bx.content_type_distribution  ?? null,
    caption_avg_length:      bx.caption_avg_length ?? null,
    primary_content_format:  bx.primary_content_format ?? null,
    brand_assets_bundle: (() => {
      const bundle = bx.brand_assets_bundle
      if (!Array.isArray(bundle) || bundle.length === 0) return []
      return (bundle as Array<Record<string, unknown>>).slice(0, 6).map(a => ({ url: a.url, name: a.name, mime: a.mime }))
    })(),
  },
  method_profile:           dna.method_profile,
  negative_patterns:        dna.negative_patterns,
  global_negative_patterns: dna.global_negative_patterns,
  override_rules:           dna.override_rules,
  audience:                 dna.audience,
  visual_style:             dna.visual_style,
  evidence_confidence:      evidenceConfidenceMap,
  evidence_summary:         dna.evidence.summary,
  primary_channel_profile:  instagramChannel,
  sector_baseline: sectorBaseline ? {
    sector: sectorBaseline.sector, dialect: sectorBaseline.dialect,
    recommended_content_mix: sectorBaseline.recommended_content_mix,
    top_performing_tones: sectorBaseline.top_performing_tones,
    worst_performing_tones: sectorBaseline.worst_performing_tones,
    occasion_insights: sectorBaseline.occasion_insights,
  } : null,
  active_occasions: [],
  dominant_content_mix: getDominantContentMix(
    (dna.brand.content_mix_ratios as Record<string, number> | null) ?? {},
    computeActiveOccasions([], new Date(), dna.brand.goal_phase as string | null, dna.brand.sector ?? null)
  ),
  sources_summary: { count: dna.sources.count, by_type: dna.sources.by_type, most_recent_captured_at: dna.sources.recent[0]?.captured_at ?? null },
  signature_phrases:   (bx.signature_phrases as string[] | null) ?? [],
  signature_hashtags:  (bx.signature_hashtags as string[] | null) ?? [],
  brand_reply_samples: ((bx.brand_reply_samples as string[] | null) ?? []).slice(0, 5),
  top_hashtags:        (bx.top_hashtags as string[] | null) ?? [],
  bio_text:            (bx.bio_text as string | null) ?? null,
  engagement_baseline: {
    likes:    (bx.engagement_baseline_likes as number | null) ?? null,
    comments: (bx.engagement_baseline_comments as number | null) ?? null,
    followers: (bx.followers_count as number | null) ?? null,
    avg_engagement_rate: (bx.avg_engagement_rate as number | null) ?? null,
    primary_content_format: (bx.primary_content_format as string | null) ?? null,
  },
  knowledge_corpus,
  recent_post_observations,
  asset_library: { approved_count: 0, rejected_count: 0, approved_samples: [] },
  competitors: { count: 0, accounts: [], snapshots: [] },
  content_patterns: { winners: [], losers: [], has_performance_data: false },
  occasion_intelligence_raw: upcomingOccasions.slice(0, 6).map((o) => {
    const ox = o as unknown as Record<string, unknown>
    return { occasion_key: o.occasion_key, occasion_name_ar: o.occasion_name_ar, occasion_name_en: ox.occasion_name_en,
      gregorian_date: o.gregorian_date, lead_weeks: o.lead_weeks, priority: ox.priority,
      recommended_mix: o.recommended_mix, sector_applicability: o.sector_applicability }
  }),
  composition_matrix_hint,
  onboarding_responses,
  global_negative_patterns_by_severity: (() => {
    const allGnp = (dna.global_negative_patterns ?? []) as unknown as Array<{ severity: string; pattern_text: string; category: string }>
    const toItem = (p: { pattern_text: string; category: string }) => ({ text: p.pattern_text, category: p.category })
    return {
      hard_blocks:  allGnp.filter(p => p.severity === 'HARD_BLOCK').map(toItem),
      strong_warns: allGnp.filter(p => p.severity === 'STRONG_WARN').map(toItem),
    }
  })(),
}

console.log('\n⏳ Calling COO compileCaptionContext (this takes 20-40s)...')

const result = await coo.compileCaptionContext(enrichedPayload, {
  flow_id: 'N8N-A01-test',
  brand_id: BID,
  db,
})

console.log('\n✅ RESULT:')
console.log('  token_count:', result.token_count)
console.log('  layers_included:', result.layers_included)
console.log('  watermark_flag:', result.watermark_flag)
console.log('  reasoning:', result.reasoning)
console.log('  cache_prefix_hash:', result.cache_prefix_hash)

// Save full output
writeFileSync('C:/Users/faroo/AppData/Local/Temp/caption-context-output.txt', result.caption_context, 'utf8')
writeFileSync('C:/Users/faroo/AppData/Local/Temp/caption-context-full.json', JSON.stringify(result, null, 2), 'utf8')

console.log('\n=== FULL CAPTION CONTEXT ===')
console.log(result.caption_context)
console.log('\n=== END ===')
console.log('\nFull output saved to C:/Users/faroo/AppData/Local/Temp/caption-context-output.txt')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
