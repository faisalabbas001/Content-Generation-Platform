/**
 * /admin/branddna/[brand_id] — admin BrandDNA inspector.
 *
 * Comprehensive read-only debug view of the entire BrandDNA graph. Uses
 * getBrandDna() for the structured data and a couple of supplementary
 * admin-only queries for the audit trail (queue + event log).
 *
 * Auth: requireAdmin() (admin layout already enforces this for /admin/*).
 *
 * What's shown:
 *   1. Header strip — name, sector, dialect, completeness, mode, owner_user
 *   2. Identity card — every column on brand_profiles
 *   3. Audience + Visual Style + Channels
 *   4. Evidence bundles table (per-field confidence)
 *   5. Negative patterns + Override rules
 *   6. Source records summary
 *   7. Memory Controller queue (pending / written / rejected)
 *   8. branddna_event_log (recent 20 events — append-only audit)
 */
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { adminClient, brandDnaQ, isDbConfigured } from '@repo/db'
import { ARCHETYPE_DEFINITIONS, type Archetype } from '@repo/core'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { DataTable } from '@repo/ui/data-table'
import { Skeleton } from '@repo/ui/skeleton'
import { BrandDirectionCard } from '@repo/ui/admin/brand-direction-card'
import { getServerT } from '@/lib/i18n-server'
import { confidenceLabel, confidenceTone, tierLabel } from '@/lib/format'
import {
  AddNegativePatternForm,
  AddOverrideRuleForm,
  BrandToolbox,
  DeleteNegativePatternButton,
  DeleteOverrideRuleButton,
  VisualStyleEditor,
} from '../../admin-widgets'
import { AssetGallery } from '@/app/[slug]/profile/asset-gallery'
import { QueueSection } from './queue-section'
import { EventLogSection } from './event-log-section'

export const dynamic = 'force-dynamic'

export default async function BrandDnaInspectorPage({
  params,
  searchParams,
}: {
  params: Promise<{ brand_id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { brand_id } = await params
  const sp = await searchParams
  const nomPage = Math.max(1, parseInt(String(sp.nom_page ?? '1'), 10))
  const evtPage = Math.max(1, parseInt(String(sp.evt_page ?? '1'), 10))
  const { locale, t } = await getServerT()
  if (!isDbConfigured()) notFound()

  const db = adminClient()

  const [dna, historyRes, responsesRes, postsRes] = await Promise.all([
    brandDnaQ.getBrandDna(brand_id, db),
    // brand_method_profile_history — versioned creative-direction history
    // Column is `changed_at` (mig 0020), not `created_at`.
    db.from('brand_method_profile_history')
      .select('history_id, change_reason, composition_score, voice_register, visual_idiom, cadence_rule, creative_direction_text, changed_at')
      .eq('brand_id', brand_id)
      .order('changed_at', { ascending: false })
      .limit(10),
    // onboarding_responses — joined to onboarding_questions in JS below
    // (Supabase REST doesn't expose the FK on this pair as a relation).
    db.from('onboarding_responses')
      .select('response_id, question_id, answer_raw, answer_processed, confidence_weight, source, answered_at')
      .eq('brand_id', brand_id)
      .order('answered_at', { ascending: true }),
    // brand_post_observations — the IG scrape results
    db.from('brand_post_observations')
      .select('ig_post_id, post_type, caption, likes_count, comments_count, hashtags, mentions, posted_at')
      .eq('brand_id', brand_id)
      .order('posted_at', { ascending: false })
      .limit(20),
  ])

  if (!dna) notFound()
  const { brand, audience, visual_style, channels, evidence, negative_patterns, override_rules, sources, current_confidence, latest_snapshot, stats } = dna
  const history = (historyRes.data ?? []) as Array<{
    history_id: string; change_reason: string | null; composition_score: number | null;
    voice_register: string | null; visual_idiom: string | null; cadence_rule: string | null;
    creative_direction_text: string | null; changed_at: string
  }>
  // Hydrate question metadata in a second query — see comment above.
  const responsesRaw = (responsesRes.data ?? []) as Array<{
    response_id: string; question_id: string; answer_raw: string | null;
    answer_processed: unknown; confidence_weight: number; source: string; answered_at: string;
  }>
  const questionIds = Array.from(new Set(responsesRaw.map((r) => r.question_id)))
  const questionMap = new Map<string, { maps_to_field: string; question_text_en: string | null; question_text_ar: string }>()
  if (questionIds.length > 0) {
    const { data: qs } = await db
      .from('onboarding_questions')
      .select('question_id, maps_to_field, question_text_en, question_text_ar')
      .in('question_id', questionIds)
    for (const q of (qs ?? []) as Array<{ question_id: string; maps_to_field: string; question_text_en: string | null; question_text_ar: string }>) {
      questionMap.set(q.question_id, { maps_to_field: q.maps_to_field, question_text_en: q.question_text_en, question_text_ar: q.question_text_ar })
    }
  }
  const responses = responsesRaw.map((r) => ({
    ...r,
    question: questionMap.get(r.question_id) ?? null,
  }))
  const posts = (postsRes.data ?? []) as Array<{
    ig_post_id: string; post_type: string; caption: string | null;
    likes_count: number; comments_count: number;
    hashtags: string[]; mentions: string[]; posted_at: string | null
  }>

  const displayName = locale === 'en' && brand.brand_name_en ? brand.brand_name_en : brand.brand_name_ar

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t('adminBrandDna.inspectorEyebrow')}
        title={displayName}
        subtitle={`${brand.sector} · ${brand.arabic_dialect ?? '—'} · ${brand.city_primary ?? '—'} · ${brand.client_slug}`}
      />

      {/* ── Brand identity strip ──────────────────────────────────────── */}
      <Card>
        <CardBody className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          {brand.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logo_url}
              alt={brand.brand_name_ar}
              className="h-14 w-14 shrink-0 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) object-contain"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) font-display text-xl text-(--fg-muted)">
              {brand.brand_name_ar.slice(0, 1)}
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div dir="rtl" className="font-display text-lg text-(--fg)">{brand.brand_name_ar}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="accent" size="sm">{brand.sector}</Badge>
              <Badge tone="outline" size="sm">{brand.tier}</Badge>
              {current_confidence?.mode && (
                <Badge
                  tone={
                    current_confidence.mode === 'Standard' ? 'success' :
                    current_confidence.mode === 'Cautious' ? 'warning' :
                    current_confidence.mode === 'Minimal'  ? 'warning' : 'danger'
                  }
                  size="sm"
                >
                  Mode: {current_confidence.mode}
                </Badge>
              )}
              <Badge tone="info" size="sm">Completeness: {brand.completeness_score}%</Badge>
              {stats.onboarding_status && <Badge tone="outline" size="sm">Onboarding: {stats.onboarding_status}</Badge>}
              <span className="font-mono text-(--fg-subtle)">{brand_id}</span>
            </div>
            <div className="pt-2">
              <BrandToolbox brand_id={brand_id} />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── v2: Creative direction (admin debug view — detailed=true) ── */}
      <BrandDirectionCard
        archetype_primary={brand.archetype_primary as string | null}
        archetype_secondary={brand.archetype_secondary as string | null}
        lifecycle_stage={brand.lifecycle_stage as string | null}
        intent_state={brand.intent_state as string | null}
        method_profile={dna.method_profile}
        archetype_blurb={
          brand.archetype_primary
            ? ARCHETYPE_DEFINITIONS[brand.archetype_primary as Archetype]?.blurb_en
            : undefined
        }
        detailed
      />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr_2fr]">
        {/* ── Basics ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader><div><CardTitle>{t('adminBrandDna.basics')}</CardTitle></div></CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Brand ID" value={<span className="font-mono text-xs">{brand.brand_id}</span>} />
            <Row label="Slug" value={<span className="font-mono">{brand.client_slug}</span>} />
            <Row label={t('adminBrandDna.labels.sector')}        value={brand.sector} />
            <Row label={t('adminBrandDna.labels.dialect')}       value={brand.arabic_dialect ?? '—'} />
            <Row label={t('adminBrandDna.labels.city')}          value={brand.city_primary ?? '—'} />
            <Row label={t('adminBrandDna.labels.pricePosition')} value={brand.price_position ?? '—'} />
            <Row label={t('adminBrandDna.labels.channel')}       value={brand.primary_channel ?? '—'} />
            <Row label="Tier" value={<Badge tone={brand.tier === 'free' ? 'outline' : 'accent'} size="sm">{tierLabel(brand.tier, t)}</Badge>} />
            <Row label="Pipeline tier" value={brand.pipeline_tier} />
            <Row label="Batch shard" value={String(brand.batch_shard)} />
            <Row label="Total calendars" value={String(stats.total_calendars_generated)} />
            <Row label="Archetype" value={brand.archetype_primary ?? '—'} />
            <Row label="Archetype 2°" value={brand.archetype_secondary ?? '—'} />
            <Row label="Lifecycle" value={brand.lifecycle_stage ?? '—'} />
            <Row label="Intent" value={brand.intent_state ?? '—'} />
            <Row label="Composition score" value={dna.method_profile?.composition_score != null ? `${dna.method_profile.composition_score}` : '—'} />
            {(() => {
              const bb2 = brand as unknown as Record<string, unknown>
              return (<>
                <Row label="Ramadan" value={String(bb2.ramadan_relevance ?? '—')} />
                <Row label="Eid al-Fitr" value={String(bb2.eid_fitr_relevance ?? '—')} />
                <Row label="Eid al-Adha" value={String(bb2.eid_adha_relevance ?? '—')} />
                <Row label="National Day" value={String(bb2.national_day_relevance ?? '—')} />
                <Row label="Founding Day" value={String(bb2.founding_day_relevance ?? '—')} />
                <Row label="Religious sensitivity" value={String(bb2.religious_sensitivity ?? '—')} />
                <Row label="Bilingual ratio" value={String(bb2.bilingual_ratio ?? '—')} />
                <Row label="Formality" value={String(bb2.formality_level ?? '—')} />
                <Row label="Humor tolerance" value={String(bb2.humor_tolerance ?? '—')} />
                {Array.isArray(bb2.tone_anti_attribute_ids) && (bb2.tone_anti_attribute_ids as string[]).length > 0 && (
                  <Row label="Tone anti" value={(bb2.tone_anti_attribute_ids as string[]).join(', ')} />
                )}
                {Array.isArray(bb2.signature_phrases) && (bb2.signature_phrases as string[]).length > 0 && (
                  <Row label="Signature phrases" value={
                    <div className="space-y-0.5">
                      {(bb2.signature_phrases as string[]).map((p, i) => <div key={i} dir="rtl" className="text-xs">{p}</div>)}
                    </div>
                  } />
                )}
                {Array.isArray(bb2.signature_hashtags) && (bb2.signature_hashtags as string[]).length > 0 && (
                  <Row label="Signature hashtags" value={(bb2.signature_hashtags as string[]).join(' ')} />
                )}
                <Row label="Onboarding status" value={String(stats.onboarding_status ?? '—')} />
                <Row label="Onboarding completed" value={bb2.onboarding_completed_at ? new Date(String(bb2.onboarding_completed_at)).toLocaleString() : '—'} />
              </>)
            })()}
            <Row label="Sector baseline" value={brand.sector_baseline_id ? <span className="font-mono text-xs">{brand.sector_baseline_id.slice(0, 8)}…</span> : <Badge tone="warning" size="sm">not linked</Badge>} />
            <Row label="Vector namespace" value={brand.vector_namespace ? <span className="font-mono text-xs">{brand.vector_namespace}</span> : <Badge tone="warning" size="sm">unset</Badge>} />
            <Row label="Created" value={new Date(brand.created_at).toLocaleString()} />
          </CardBody>
        </Card>

        {/* ── Evidence ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('adminBrandDna.evidenceTitle')}</CardTitle>
              <CardDescription>{t('adminBrandDna.evidenceSubtitle')}</CardDescription>
            </div>
            <div className="flex gap-1.5">
              <ConfidenceCount n={evidence.summary.by_state.explicitly_confirmed} label="confirmed" tone="success" />
              <ConfidenceCount n={evidence.summary.by_state.inferred_high}       label="high"      tone="success" />
              <ConfidenceCount n={evidence.summary.by_state.inferred_medium}     label="medium"    tone="info" />
              <ConfidenceCount n={evidence.summary.by_state.inferred_low}        label="low"       tone="warning" />
              <ConfidenceCount n={evidence.summary.by_state.deprecated}          label="stale"     tone="outline" />
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <DataTable
              rows={evidence.bundles}
              density="compact"
              columns={[
                { key: 'field', header: t('adminBrandDna.field'),      render: (b) => <span className="font-medium text-(--fg)">{b.field_name}</span> },
                { key: 'conf',  header: t('adminBrandDna.confidence'), render: (b) => <Badge tone={confidenceTone(b.field_confidence)} size="sm">{confidenceLabel(b.field_confidence, t)}</Badge> },
                { key: 'a',     header: t('adminBrandDna.agreement'),  render: (b) => <span className="font-mono text-(--fg-subtle)">{(b.agreement_ratio * 100).toFixed(0)}%</span>, align: 'end' },
                { key: 'r',     header: t('adminBrandDna.recency'),    render: (b) => <span className="font-mono text-(--fg-subtle)">{(b.recency_score * 100).toFixed(0)}%</span>, align: 'end' },
                { key: 'c',     header: t('adminBrandDna.conflict'),   render: (b) => <span className="font-mono text-(--fg-subtle)">{(b.conflict_score * 100).toFixed(0)}%</span>, align: 'end' },
                { key: 'ts',    header: 'Last evaluated',              render: (b) => <span className="font-mono text-xs text-(--fg-subtle)">{new Date(b.last_evaluated).toLocaleString()}</span>, align: 'end' },
              ]}
              empty={t('adminBrandDna.noEvidence')}
            />
          </CardBody>
        </Card>
      </div>

      {/* ── Layer 2 + Layer 4 ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>Brand Identity (Layer 1 extras)</CardTitle></div></CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Sub-sector" value={brand.sub_sector ?? '—'} />
            <Row label="Region" value={brand.region_primary ?? '—'} />
            <Row label="Founded year" value={brand.founded_year != null ? String(brand.founded_year) : '—'} />
            <Row label="Tone register" value={brand.tone_register ?? '—'} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Content Style (Layer 3)</CardTitle></div></CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Posting rhythm" value={brand.posting_rhythm ?? '—'} />
            <Row label="Caption style" value={brand.caption_style ?? '—'} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Owner Profile (Layer 2)</CardTitle></div></CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Founding story" value={brand.founding_story ?? <span className="text-(--fg-faint) italic">not set</span>} />
            <Row label="Comfort on camera" value={brand.comfort_on_camera ?? '—'} />
            <Row label="Way of speaking" value={brand.way_of_speaking ?? '—'} />
            <Row
              label="Content preferences"
              value={
                Array.isArray(brand.content_preferences) && brand.content_preferences.length > 0
                  ? (brand.content_preferences as string[]).join(', ')
                  : '—'
              }
            />
            <Row label="Owner values" value={brand.owner_values ?? <span className="text-(--fg-faint) italic">not set</span>} />
            <Row label="Communication style" value={brand.communication_style ?? '—'} />
            <Row label="Business goals" value={brand.brand_goals ?? <span className="text-(--fg-faint) italic">not set</span>} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Strategic Intelligence (Layer 4)</CardTitle></div></CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Permission level" value={brand.permission_level ?? <Badge tone="warning" size="sm">not set</Badge>} />
            <Row label="Goal phase" value={brand.goal_phase ?? '—'} />
            <Row label="Risk appetite" value={brand.brave_safe_default ? <Badge tone="accent" size="sm">brave</Badge> : <Badge tone="outline" size="sm">safe</Badge>} />
            <Row label="Strategy version" value={brand.strategy_version != null ? `v${brand.strategy_version}` : '—'} />
            <Row
              label="Cultural tension"
              value={brand.cultural_tension_owned ?? <span className="text-(--fg-faint) italic">not claimed</span>}
            />
            <Row
              label="Creative formulas"
              value={
                Array.isArray(brand.creative_formulas_approved) && brand.creative_formulas_approved.length > 0
                  ? brand.creative_formulas_approved.join(', ')
                  : '—'
              }
            />
          </CardBody>
        </Card>
      </div>

      {/* ── Contact & Assets ──────────────────────────────────────────── */}
      {(() => {
        const bb = brand as unknown as Record<string, unknown>
        const instagram_handle = bb.instagram_handle as string | null | undefined
        const website_url      = bb.website_url as string | null | undefined
        const brand_name_en    = bb.brand_name_en as string | null | undefined
        const hasContact = brand_name_en || instagram_handle || website_url || brand.primary_color_hex || bb.hero_upload_url
        const rawAssets = Array.isArray(bb.brand_assets_bundle) ? (bb.brand_assets_bundle as Array<{ url: string; name?: string; mime?: string; size?: number }>) : []
        const assets = rawAssets.filter((a) => typeof a?.url === 'string' && a.url.length > 0)
        if (!hasContact && assets.length === 0) return null
        return (
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr_2fr]">
            {!!hasContact && (
              <Card>
                <CardHeader><div><CardTitle>Contact & Identity</CardTitle></div></CardHeader>
                <CardBody className="space-y-2.5 text-sm">
                  {brand_name_en && <Row label="Name EN" value={brand_name_en} />}
                  {brand.brand_name_ar && <Row label="Name AR" value={<span dir="rtl">{brand.brand_name_ar}</span>} />}
                  {instagram_handle && (
                    <Row label="Instagram" value={
                      <a href={`https://instagram.com/${instagram_handle}`} target="_blank" rel="noopener noreferrer"
                        className="font-mono text-xs text-(--accent) hover:underline">
                        @{instagram_handle}
                      </a>
                    } />
                  )}
                  {website_url && (
                    <Row label="Website" value={
                      <a href={website_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-(--accent) hover:underline truncate block max-w-[200px]">
                        {website_url}
                      </a>
                    } />
                  )}
                  {brand.primary_color_hex && (
                    <Row label="Primary color" value={
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        <span className="h-4 w-4 rounded border border-(--border-subtle)" style={{ background: brand.primary_color_hex }} />
                        {brand.primary_color_hex}
                      </span>
                    } />
                  )}
                  {!!bb.hero_upload_url && (
                    <Row label="Hero image" value={
                      <a href={String(bb.hero_upload_url)} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-(--accent) hover:underline">view</a>
                    } />
                  )}
                  {!!bb.tagline && <Row label="Tagline" value={<span dir="auto">{String(bb.tagline)}</span>} />}
                  {!!bb.vision_text && <Row label="Vision" value={<span dir="auto" className="whitespace-pre-wrap">{String(bb.vision_text)}</span>} />}
                </CardBody>
              </Card>
            )}
            {assets.length > 0 && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Brand Assets ({assets.length})</CardTitle>
                    <CardDescription>From Instagram scrape + user uploads — click to lightbox</CardDescription>
                  </div>
                </CardHeader>
                <CardBody>
                  <AssetGallery assets={assets} gridClass="grid-cols-3 sm:grid-cols-4 md:grid-cols-6" />
                </CardBody>
              </Card>
            )}
          </div>
        )
      })()}

      {/* ── v6 BrandDNA fields ────────────────────────────────────────── */}
      {(() => {
        const bb = brand as unknown as Record<string, unknown>
        const v6fields: Array<[string, unknown]> = [
          ['Name meaning',     bb.name_meaning],
          ['Hero why',         bb.hero_why],
          ['Lifecycle',        bb.lifecycle],
          ['Lifestyle',        bb.lifestyle],
          ['Price (numbers)',  bb.price_nums],
          ['Archetype family', bb.archetype_family],
          ['Music',            bb.music],
          ['Music link',       bb.music_link],
          ['Brand refs',       Array.isArray(bb.brand_refs) ? (bb.brand_refs as string[]).join(', ') : bb.brand_refs],
          ['Respected brands', bb.respected_brands],
          ['Respected why',    bb.respected_why],
          ['Goal',             bb.goal],
          ['Social',           bb.social],
          ['Vision',           bb.vision],
          ['Tagline',          bb.tagline],
          ['Cust quote',       bb.cust_quote],
          ['Caption example',  bb.caption_ex],
          ['Metric',           bb.metric],
          ['Custom restriction', bb.custom_restriction],
          ['Custom occasion',  bb.custom_occasion],
          ['Anything',         bb.anything],
          ['Scale min/max',    bb.scale_minmax != null ? String(bb.scale_minmax) : null],
          ['Scale quiet/loud', bb.scale_quietloud != null ? String(bb.scale_quietloud) : null],
          ['Scale local/global', bb.scale_localglobal != null ? String(bb.scale_localglobal) : null],
          ['Scale trad/mod',   bb.scale_tradmod != null ? String(bb.scale_tradmod) : null],
          ['Emotions',         Array.isArray(bb.emotions) ? (bb.emotions as string[]).join(', ') : bb.emotions],
          ['Occasions ranked', Array.isArray(bb.occasions_ranked) ? (bb.occasions_ranked as string[]).join(' → ') : bb.occasions_ranked],
          ['Problems',         Array.isArray(bb.problems) ? (bb.problems as string[]).join(', ') : bb.problems],
          ['Platforms',        Array.isArray(bb.platforms) ? (bb.platforms as string[]).join(', ') : bb.platforms],
        ]
        const set = v6fields.filter(([, v]) => v != null && v !== '' && v !== '—')
        if (set.length === 0) return null
        return (
          <Card>
            <CardHeader><div><CardTitle>v6 BrandDNA fields</CardTitle><CardDescription>Onboarding Stage 3 extended fields — all values as stored.</CardDescription></div></CardHeader>
            <CardBody className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {set.map(([label, value]) => (
                <Row key={label} label={label} value={<span dir="auto">{String(value)}</span>} />
              ))}
            </CardBody>
          </Card>
        )
      })()}

      {/* ── Audience / Visual / Channels ──────────────────────────────── */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        {/* ── Audience card ─────────────────────────────────────────── */}
        <Card>
          <CardHeader><div><CardTitle>Audience</CardTitle></div></CardHeader>
          <CardBody className="space-y-4 text-sm">
            {audience ? (
              <>
                {/* Gender mix bar */}
                {(() => {
                  const gm = audience.gender_mix as Record<string, number> | null
                  const rawF = gm?.female ?? gm?.female_pct ?? null
                  const rawM = gm?.male   ?? gm?.male_pct   ?? null
                  const femalePct = rawF != null ? (rawF <= 1 ? Math.round(rawF * 100) : Math.round(rawF)) : null
                  const malePct   = rawM != null ? (rawM <= 1 ? Math.round(rawM * 100) : Math.round(rawM)) : null
                  if (femalePct == null && malePct == null) return (
                    <div>
                      <div className="mb-1 text-xs font-medium text-(--fg-muted) uppercase tracking-wide">Gender Mix</div>
                      <span className="text-(--fg-faint) text-xs">—</span>
                    </div>
                  )
                  return (
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-(--fg-muted) uppercase tracking-wide">Gender Mix</div>
                      <div className="flex h-5 w-full overflow-hidden rounded-full bg-(--surface-3)">
                        {femalePct != null && (
                          <div className="flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${femalePct}%`, background: '#ec4899' }}>
                            {femalePct > 15 ? `${femalePct}% F` : ''}
                          </div>
                        )}
                        {malePct != null && (
                          <div className="flex flex-1 items-center justify-center text-[10px] font-bold text-white" style={{ background: '#3b82f6' }}>
                            {(malePct ?? 100 - (femalePct ?? 0)) > 15 ? `${malePct ?? 100 - (femalePct ?? 0)}% M` : ''}
                          </div>
                        )}
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-(--fg-muted)">
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full inline-block" style={{ background: '#ec4899' }} />Female {femalePct != null ? `${femalePct}%` : '—'}</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full inline-block" style={{ background: '#3b82f6' }} />Male {malePct != null ? `${malePct}%` : '—'}</span>
                      </div>
                    </div>
                  )
                })()}

                {/* Age range */}
                {audience.age_range && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-(--fg-muted) uppercase tracking-wide">Age Range</div>
                    {(() => {
                      const ar = audience.age_range as Record<string, unknown>
                      if (ar.min != null || ar.max != null) {
                        return <span className="font-semibold text-(--fg)">{String(ar.min ?? '?')} – {String(ar.max ?? '?')} yrs</span>
                      }
                      return (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(ar).map(([k, v]) => (
                            <Badge key={k} tone="outline" size="sm">{k}: {String(v)}</Badge>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Language preference */}
                {audience.language_preference && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-(--fg-muted) uppercase tracking-wide">Language</div>
                    <span className="text-(--fg)">{audience.language_preference.replace(/_/g, ' ')}</span>
                  </div>
                )}

                {/* Description */}
                {audience.description_ar && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-(--fg-muted) uppercase tracking-wide">Description</div>
                    <p dir="rtl" className="rounded-(--r-sm) bg-(--surface-2) p-2 text-(--fg) leading-relaxed">{audience.description_ar}</p>
                  </div>
                )}

                {/* Extra fields (location, interests, income_level, etc.) */}
                {(() => {
                  const extra: [string, string][] = []
                  const a = audience as unknown as Record<string, unknown>
                  if (a.location_primary) extra.push(['Location', String(a.location_primary)])
                  if (a.income_level) extra.push(['Income', String(a.income_level)])
                  if (a.education_level) extra.push(['Education', String(a.education_level)])
                  if (a.interests && Array.isArray(a.interests) && a.interests.length > 0) {
                    extra.push(['Interests', (a.interests as string[]).slice(0, 5).join(', ')])
                  }
                  if (a.pain_points && Array.isArray(a.pain_points) && a.pain_points.length > 0) {
                    extra.push(['Pain points', (a.pain_points as string[]).slice(0, 3).join(', ')])
                  }
                  return extra.map(([label, value]) => (
                    <Row key={label} label={label} value={value} />
                  ))
                })()}
              </>
            ) : <p className="text-(--fg-faint)">No audience profile yet.</p>}
          </CardBody>
        </Card>

        {/* ── Visual style card ──────────────────────────────────────── */}
        <Card>
          <CardHeader><div><CardTitle>Visual style</CardTitle></div></CardHeader>
          <CardBody className="space-y-3 text-sm">
            {visual_style ? (
              <>
                {visual_style.style_descriptor && <p className="text-(--fg)">{visual_style.style_descriptor}</p>}
                {visual_style.color_palette && visual_style.color_palette.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-(--fg-muted) uppercase tracking-wide">Color Palette</div>
                    <div className="flex flex-wrap gap-1.5">
                      {visual_style.color_palette.map((hex) => (
                        <span key={hex} className="flex items-center gap-1 rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 font-mono text-xs">
                          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: hex }} />
                          {hex}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {visual_style.platform_specs && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-(--fg-muted) uppercase tracking-wide">Platform Specs</div>
                    <pre className="overflow-auto rounded-(--r-sm) bg-(--surface-2) p-2 font-mono text-xs">
                      {JSON.stringify(visual_style.platform_specs, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            ) : <p className="text-(--fg-faint)">No visual style set yet.</p>}
            <VisualStyleEditor
              brand_id={brand_id}
              initial_palette={visual_style?.color_palette ?? null}
              initial_descriptor={visual_style?.style_descriptor ?? null}
            />
          </CardBody>
        </Card>

        {/* ── Channels card ─────────────────────────────────────────── */}
        <Card>
          <CardHeader><div><CardTitle>Channels ({channels.length})</CardTitle></div></CardHeader>
          <CardBody className="space-y-4 text-sm">
            {channels.length === 0 && <p className="text-(--fg-faint)">No channels linked.</p>}
            {channels.map((c) => {
              const ch = c as Record<string, unknown> & typeof c
              const chFullName    = ch.full_name    != null ? String(ch.full_name)    : null
              const chBiography   = ch.biography    != null ? String(ch.biography)    : null
              const chProfileUrl  = ch.profile_url  != null ? String(ch.profile_url)  : null
              const chCategory    = ch.category     != null ? String(ch.category)     : null
              const chExternalUrl = ch.external_url != null ? String(ch.external_url) : null
              const engPct = c.engagement_rate != null
                ? (c.engagement_rate <= 1 ? (c.engagement_rate * 100).toFixed(2) : c.engagement_rate.toFixed(2))
                : null
              const statItems: { label: string; value: string }[] = []
              if (c.followers_count != null) statItems.push({ label: 'Followers', value: adminFormatCount(c.followers_count) })
              if (ch.following_count != null) statItems.push({ label: 'Following', value: adminFormatCount(Number(ch.following_count)) })
              if (ch.posts_count != null) statItems.push({ label: 'Posts', value: adminFormatCount(Number(ch.posts_count)) })
              if (engPct != null) statItems.push({ label: 'Engagement', value: `${engPct}%` })
              if (ch.avg_likes != null) statItems.push({ label: 'Avg Likes', value: adminFormatCount(Number(ch.avg_likes)) })
              if (ch.avg_comments != null) statItems.push({ label: 'Avg Cmts', value: adminFormatCount(Number(ch.avg_comments)) })
              return (
                <div key={c.channel_id} className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-3 space-y-2.5">
                  {/* Channel header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{channelIcon(c.channel)}</span>
                      <div>
                        <div className="font-semibold text-(--fg)">{c.channel}</div>
                        {c.handle && (
                          <div className="flex items-center gap-1">
                            {chProfileUrl ? (
                              <a href={chProfileUrl} target="_blank" rel="noopener noreferrer"
                                className="font-mono text-xs text-(--fg-muted) hover:text-(--fg) underline underline-offset-2">
                                @{c.handle}
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-(--fg-muted)">@{c.handle}</span>
                            )}
                            {Boolean(ch.is_verified) && <span className="text-xs text-blue-500" title="Verified">✓</span>}
                            {Boolean(ch.is_business_account) && <Badge tone="info" size="sm">Business</Badge>}
                          </div>
                        )}
                      </div>
                    </div>
                    <Badge tone={Boolean(ch.is_primary) ? 'accent' : 'outline'} size="sm">{Boolean(ch.is_primary) ? 'Primary' : 'Secondary'}</Badge>
                  </div>

                  {/* Full name / biography */}
                  {chFullName  ? <div className="text-xs font-medium text-(--fg)">{chFullName}</div>  : null}
                  {chBiography ? <p className="text-xs text-(--fg-muted) line-clamp-3 leading-relaxed">{chBiography}</p> : null}

                  {/* Stat grid */}
                  {statItems.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {statItems.map(({ label, value }) => (
                        <div key={label} className="rounded-(--r-sm) bg-(--surface-3) px-2 py-1 text-center">
                          <div className="font-mono text-xs font-semibold text-(--fg)">{value}</div>
                          <div className="text-[10px] text-(--fg-faint) leading-none mt-0.5">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Extra metadata */}
                  {chCategory ? (
                    <div className="text-xs text-(--fg-muted)">Category: <span className="text-(--fg)">{chCategory}</span></div>
                  ) : null}
                  {chExternalUrl ? (
                    <div className="text-xs truncate">
                      <a href={chExternalUrl} target="_blank" rel="noopener noreferrer"
                        className="text-(--fg-muted) hover:text-(--fg) underline underline-offset-2 font-mono">
                        {chExternalUrl}
                      </a>
                    </div>
                  ) : null}

                  {/* Sync time */}
                  {c.synced_at && (
                    <div className="font-mono text-[10px] text-(--fg-subtle)">
                      Scraped {new Date(c.synced_at).toLocaleString()}
                    </div>
                  )}
                </div>
              )
            })}
          </CardBody>
        </Card>
      </div>

      {/* ── Negative patterns + Override rules + Sources ──────────────── */}
      <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader><div><CardTitle>Negative patterns ({negative_patterns.length})</CardTitle></div></CardHeader>
          <CardBody className="space-y-1.5 text-sm">
            {negative_patterns.length === 0 && <p className="text-(--fg-faint)">None.</p>}
            {negative_patterns.map((p) => (
              <div key={p.pattern_id} className="flex items-center justify-between gap-2 border-b border-(--border-subtle) pb-1 last:border-0 last:pb-0">
                <span dir="auto" className="flex-1 text-xs">{p.pattern_text}</span>
                <Badge tone={p.severity === 'HARD_BLOCK' ? 'danger' : p.severity === 'STRONG_WARN' ? 'warning' : 'outline'} size="sm">{p.severity}</Badge>
                <DeleteNegativePatternButton brand_id={brand_id} pattern_id={p.pattern_id} />
              </div>
            ))}
            <AddNegativePatternForm brand_id={brand_id} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Override rules ({override_rules.length})</CardTitle></div></CardHeader>
          <CardBody className="space-y-1.5 text-sm">
            {override_rules.length === 0 && <p className="text-(--fg-faint)">None.</p>}
            {override_rules.map((r) => (
              <div key={r.rule_id} className="border-b border-(--border-subtle) pb-1.5 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs text-(--fg-muted)">{r.rule_key}</div>
                  <DeleteOverrideRuleButton brand_id={brand_id} rule_id={r.rule_id} />
                </div>
                <pre className="mt-0.5 overflow-auto font-mono text-xs">{JSON.stringify(r.rule_value, null, 2)}</pre>
              </div>
            ))}
            <AddOverrideRuleForm brand_id={brand_id} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Sources ({sources.count})</CardTitle></div></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(sources.by_type).map(([type, count]) => (
                <Badge key={type} tone="outline" size="sm">{type} ({count})</Badge>
              ))}
            </div>
            {sources.recent.map((s, i) => (
              <div key={i} className="font-mono text-xs text-(--fg-muted)">
                {s.source_type} · {new Date(s.captured_at).toLocaleString()} · score {s.recency_score.toFixed(2)}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* ── Memory queue ──────────────────────────────────────────────── */}
      <Suspense fallback={<QueueSkeleton />}>
        <QueueSection brand_id={brand_id} nomPage={nomPage} evtPage={evtPage} />
      </Suspense>

      {/* ── Event log ─────────────────────────────────────────────────── */}
      <Suspense fallback={<EventLogSkeleton />}>
        <EventLogSection brand_id={brand_id} evtPage={evtPage} nomPage={nomPage} />
      </Suspense>

      {/* ── Method profile history ────────────────────────────────────── */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Method profile history</CardTitle>
              <CardDescription>Versioned creative-direction changes (latest 10).</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <DataTable
              rows={history}
              density="compact"
              columns={[
                { key: 'when',   header: 'When',   render: (h) => <span className="font-mono text-xs text-(--fg-subtle)">{new Date(h.changed_at).toLocaleString()}</span> },
                { key: 'reason', header: 'Reason', render: (h) => <Badge tone="outline" size="sm">{h.change_reason ?? '—'}</Badge> },
                { key: 'score',  header: 'Score',  render: (h) => <span className="font-mono text-xs">{h.composition_score ?? '—'}</span>, align: 'end' },
                { key: 'voice',  header: 'Voice',  render: (h) => <span className="text-xs">{h.voice_register ?? '—'}</span> },
                { key: 'visual', header: 'Visual', render: (h) => <span className="text-xs">{h.visual_idiom ?? '—'}</span> },
                { key: 'cad',    header: 'Cadence',render: (h) => <span className="text-xs">{h.cadence_rule ?? '—'}</span> },
                { key: 'text',   header: 'Direction', render: (h) => (
                  <details>
                    <summary className="cursor-pointer text-xs text-(--fg-muted)">view</summary>
                    <p className="mt-1 max-w-xl text-xs text-(--fg)">{h.creative_direction_text ?? '—'}</p>
                  </details>
                ) },
              ]}
              empty="No history yet."
            />
          </CardBody>
        </Card>
      )}

      {/* ── Onboarding responses ──────────────────────────────────────── */}
      {responses.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Onboarding responses ({responses.length})</CardTitle>
              <CardDescription>Raw form answers, mapped to question_id (mig 0001 onboarding_responses).</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <DataTable
              rows={responses}
              density="compact"
              columns={[
                { key: 'field',   header: 'Field',  render: (r) => <span className="font-mono text-xs">{r.question?.maps_to_field ?? r.question_id.slice(0, 8)}</span> },
                { key: 'q',       header: 'Question', render: (r) => <span className="text-xs text-(--fg-muted)">{r.question?.question_text_en ?? r.question?.question_text_ar ?? '—'}</span> },
                { key: 'answer',  header: 'Answer', render: (r) => <span className="text-xs">{r.answer_raw ?? JSON.stringify(r.answer_processed)}</span> },
                { key: 'source',  header: 'Source', render: (r) => <Badge tone="outline" size="sm">{r.source}</Badge> },
                { key: 'w',       header: 'Weight', render: (r) => <span className="font-mono text-xs">{r.confidence_weight.toFixed(1)}</span>, align: 'end' },
              ]}
              empty="No onboarding responses saved."
            />
          </CardBody>
        </Card>
      )}

      {/* ── Brand post observations (IG scrape) ───────────────────────── */}
      {posts.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Scraped posts ({posts.length})</CardTitle>
              <CardDescription>Latest 20 Instagram posts from brand_post_observations.</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <DataTable
              rows={posts}
              density="compact"
              columns={[
                { key: 'when',     header: 'Posted', render: (p) => <span className="font-mono text-xs text-(--fg-subtle)">{p.posted_at ? new Date(p.posted_at).toLocaleDateString() : '—'}</span> },
                { key: 'type',     header: 'Type',   render: (p) => <Badge tone="outline" size="sm">{p.post_type}</Badge> },
                { key: 'caption',  header: 'Caption',render: (p) => <span dir="auto" className="block max-w-md truncate text-xs">{p.caption ?? '—'}</span> },
                { key: 'tags',     header: 'Tags',   render: (p) => <span className="text-xs text-(--fg-muted)">{(p.hashtags ?? []).slice(0, 3).join(' ')}{(p.hashtags?.length ?? 0) > 3 ? '…' : ''}</span> },
                { key: 'mentions', header: 'Mentions', render: (p) => <span className="text-xs text-(--fg-muted)">{(p.mentions ?? []).slice(0, 2).join(' ')}{(p.mentions?.length ?? 0) > 2 ? '…' : ''}</span> },
                { key: 'likes',    header: 'Likes',  render: (p) => <span className="font-mono text-xs">{p.likes_count.toLocaleString()}</span>, align: 'end' },
                { key: 'cmts',     header: 'Cmts',   render: (p) => <span className="font-mono text-xs">{p.comments_count.toLocaleString()}</span>, align: 'end' },
              ]}
              empty="No scraped posts."
            />
          </CardBody>
        </Card>
      )}

      {/* ── Latest snapshot raw ───────────────────────────────────────── */}
      {latest_snapshot && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Latest snapshot</CardTitle>
              <CardDescription>
                {latest_snapshot.is_partial ? 'Partial' : 'Complete'} ·{' '}
                {new Date(latest_snapshot.created_at).toLocaleString()}
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <pre className="overflow-auto rounded-(--r-md) bg-(--surface-2) p-3 font-mono text-xs">
              {JSON.stringify(latest_snapshot.snapshot_data, null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1)">
      <div className="flex items-center justify-between p-5 border-b border-(--border-subtle)">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-20 rounded-(--r-sm)" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-(--border-subtle) last:border-0">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-7 w-16 rounded-(--r-sm)" />
        </div>
      ))}
    </div>
  )
}

function EventLogSkeleton() {
  return (
    <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1)">
      <div className="p-5 border-b border-(--border-subtle) space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-(--border-subtle) last:border-0">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="shrink-0 text-(--fg-muted)">{label}</span>
      <span className="min-w-0 break-words text-(--fg) sm:text-end">{value}</span>
    </div>
  )
}

function ConfidenceCount({ n, label, tone }: { n: number; label: string; tone: 'success' | 'warning' | 'info' | 'outline' }) {
  if (n === 0) return null
  return <Badge tone={tone} size="sm">{n} {label}</Badge>
}

function adminFormatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function channelIcon(channel: string): string {
  const map: Record<string, string> = {
    instagram: '📸', twitter: '🐦', x: '🐦', tiktok: '🎵',
    youtube: '▶️', facebook: '👤', linkedin: '💼', snapchat: '👻',
    pinterest: '📌',
  }
  return map[channel?.toLowerCase()] ?? '🔗'
}

