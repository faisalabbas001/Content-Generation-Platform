/**
 * /[slug]/profile — BrandDNA summary with full-field edit panel.
 *
 * Doc §8.4: Brand Profile screen.
 *   - Field-by-field completeness (green/amber/red)
 *   - "Edit BrandDNA" opens a panel with ALL correctable fields, current
 *     values shown, and batch submission → CEO → Memory Controller
 *   - BrandDNA event log (last 20 changes) for audit visibility
 *   - Audience, visual style, channels, negative patterns, override rules
 */
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { brandDnaQ } from '@repo/db'
import { adminClient } from '@repo/db/client'
import { getBrandForCurrentUser } from '@repo/auth/server'
import { ARCHETYPE_DEFINITIONS, CRITICAL_BRANDDNA_FIELDS, type Archetype } from '@repo/core'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { Progress } from '@repo/ui/progress'
import { Skeleton } from '@repo/ui/skeleton'
import { BrandDirectionCard } from '@repo/ui/admin/brand-direction-card'
import { getServerT } from '@/lib/i18n-server'
import { confidenceLabel, confidenceTone } from '@/lib/format'
import { CorrectionForm, CorrectionPanel } from './correction-form'
import { AssetGallery } from './asset-gallery'
import { VisualStyleCard } from './visual-style-card'
import { NegativePatternsManager, OverrideRulesManager } from './policy-manager'
import { EventLogSection } from './event-log-section'

export const dynamic = 'force-dynamic'

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const evtPage = Math.max(1, parseInt(String(sp.evt_page ?? '1'), 10))
  const { t, locale } = await getServerT()
  const brandHeader = await getBrandForCurrentUser(slug)
  if (!brandHeader) notFound()

  // Use adminClient for getBrandDna so RLS never blocks reading the brand's
  // negative_patterns / override_rules (client_read policy requires a valid
  // user JWT which isn't always forwarded correctly in RSC re-renders).
  // Ownership is already verified above via getBrandForCurrentUser.
  const dna = await brandDnaQ.getBrandDna(brandHeader.brand_id, adminClient())
  if (!dna) notFound()

  const { brand, audience, visual_style, channels, evidence, negative_patterns, override_rules, sources, current_confidence } = dna

  // ── Auto-heal: create missing evidence bundles for critical fields that
  // already have a DB value but were never given a qualifying bundle.
  // This happens for brands onboarded before the submitFinal evidence-bundle
  // fix, or when the async void block failed silently. Runs as a fire-and-
  // forget upsert — idempotent, cheap after the first run.
  {
    const QUALIFYING_SET = new Set(['inferred_medium', 'inferred_high', 'explicitly_confirmed'])
    const coveredNow = new Set(
      evidence.bundles.filter((eb) => QUALIFYING_SET.has(eb.field_confidence)).map((eb) => eb.field_name)
    )

    // Resolve actual DB values for each critical field
    const bRaw = brand as unknown as Record<string, unknown>
    const audienceRaw = audience as Record<string, unknown> | null

    // gender_mix → primary_audience_gender display value
    const genderMixRaw = audienceRaw?.gender_mix as Record<string, number> | null
    const genderValue = (() => {
      if (!genderMixRaw) return null
      const f = genderMixRaw.female ?? genderMixRaw.female_pct ?? null
      const m = genderMixRaw.male   ?? genderMixRaw.male_pct   ?? null
      if (f == null || m == null) return null
      // Return a non-empty string so the heal check sees a value
      return `${f <= 1 ? Math.round(f * 100) : Math.round(f)}% F`
    })()

    const fieldValues: Record<string, unknown> = {
      arabic_dialect:          bRaw.arabic_dialect,
      brand_differentiator:    bRaw.brand_differentiator,
      price_position:          bRaw.price_position,
      primary_channel:         bRaw.primary_channel,
      ramadan_relevance:       bRaw.ramadan_relevance,
      primary_audience_gender: genderValue,
      primary_kpi_type:        bRaw.primary_kpi_type,
      religious_sensitivity:   bRaw.religious_sensitivity,
      tone_anti_attribute_ids: Array.isArray(bRaw.tone_anti_attribute_ids) && (bRaw.tone_anti_attribute_ids as unknown[]).length > 0 ? bRaw.tone_anti_attribute_ids : null,
      bilingual_ratio:         bRaw.bilingual_ratio,
      archetype_primary:       bRaw.archetype_primary ?? bRaw.archetype_family,
      lifecycle_stage:         bRaw.lifecycle_stage   ?? bRaw.lifecycle,
    }

    const healRows = Object.entries(fieldValues)
      .filter(([fieldName, value]) =>
        !coveredNow.has(fieldName) &&
        value != null && value !== '' &&
        !(Array.isArray(value) && (value as unknown[]).length === 0)
      )
      .map(([fieldName]) => ({
        brand_id:                  brand.brand_id,
        field_name:                fieldName,
        supporting_source_ids:     [] as string[],
        contradicting_source_ids:  [] as string[],
        agreement_ratio:           1.0,
        recency_score:             1.0,
        conflict_score:            0.0,
        field_confidence:          'inferred_medium' as const,
        last_evaluated:            new Date().toISOString(),
      }))

    if (healRows.length > 0) {
      adminClient()
        .from('evidence_bundles')
        .upsert(healRows as never, { onConflict: 'brand_id,field_name', ignoreDuplicates: true })
        .then(({ error }) => {
          if (error) console.warn('[profile] auto-heal evidence_bundles failed:', error.message)
          else {
            console.info(`[profile] auto-healed ${healRows.length} evidence bundles for brand=${brand.brand_id}:`, healRows.map(r => r.field_name).join(', '))
            // Refresh the completeness score so next page load shows the updated %
            adminClient().rpc('refresh_brand_completeness', { p_brand_id: brand.brand_id })
              .then(({ error: rpcErr }) => {
                if (rpcErr) console.warn('[profile] refresh_brand_completeness failed:', rpcErr.message)
              })
          }
        })
      // Optimistically add the healed fields to evidence.bundles so THIS render
      // doesn't show them as missing — the user sees the correct state immediately.
      for (const row of healRows) {
        evidence.bundles.push({
          bundle_id:      `heal-${row.field_name}`,
          brand_id:       brand.brand_id,
          field_name:     row.field_name,
          field_confidence: 'inferred_medium',
          agreement_ratio: 1.0,
          recency_score:  1.0,
          conflict_score: 0.0,
          last_evaluated: row.last_evaluated,
        })
      }
    }
  }

  // Build currentValues for the CorrectionPanel from the brand row
  const b = brand as unknown as Record<string, unknown>
  const currentValues = {
    // ── Core identity ────────────────────────────────────────────────────
    arabic_dialect:              brand.arabic_dialect,
    price_position:              brand.price_position,
    formality_level:             brand.formality_level,
    humor_tolerance:             brand.humor_tolerance,
    religious_sensitivity:       brand.religious_sensitivity,
    bilingual_ratio:             brand.bilingual_ratio,
    brand_differentiator:        brand.brand_differentiator,
    primary_kpi_type:            brand.primary_kpi_type,
    primary_channel:             brand.primary_channel,
    ramadan_relevance:           brand.ramadan_relevance,
    tone_anti_attribute_ids:     brand.tone_anti_attribute_ids,
    archetype_primary:           brand.archetype_primary,
    archetype_secondary:         brand.archetype_secondary,
    lifecycle_stage:             brand.lifecycle_stage,
    intent_state:                brand.intent_state,
    // ── Audience fields (from audience_profiles) ─────────────────────────
    audience_description_ar:     audience?.description_ar ?? null,
    audience_age_range:          (audience as Record<string, unknown> | null)?.age_range as string | { min?: number | null; max?: number | null } | null ?? null,
    audience_language_preference: audience?.language_preference ?? null,
    // ── Visual style / brand colour ───────────────────────────────────────
    primary_color_hex:           brand.primary_color_hex ?? visual_style?.color_palette?.[0] ?? null,
    // ── Layer 1 extras ────────────────────────────────────────────────────
    sub_sector:                  brand.sub_sector ?? null,
    region_primary:              brand.region_primary ?? null,
    founded_year:                brand.founded_year != null ? String(brand.founded_year) : null,
    tone_register:               brand.tone_register ?? null,
    // ── Layer 2 — Owner Profile ───────────────────────────────────────────
    founding_story:              brand.founding_story ?? null,
    owner_values:                brand.owner_values ?? null,
    comfort_on_camera:           brand.comfort_on_camera ?? null,
    way_of_speaking:             brand.way_of_speaking ?? null,
    communication_style:         brand.communication_style ?? null,
    brand_goals:                 brand.brand_goals ?? null,
    // ── Layer 3 — Content Style ───────────────────────────────────────────
    posting_rhythm:              brand.posting_rhythm ?? null,
    caption_style:               brand.caption_style ?? null,
    // ── Layer 4 — Strategic Intelligence ─────────────────────────────────
    permission_level:            brand.permission_level ?? null,
    cultural_tension_owned:      brand.cultural_tension_owned ?? null,
    goal_phase:                  brand.goal_phase ?? null,
    brave_safe_default:          brand.brave_safe_default != null ? String(brand.brave_safe_default) : null,
    // ── brand-insight wizard fields ───────────────────────────────────────
    products_list:               b.products_list as string ?? null,
    cust_desc:                   b.cust_desc as string ?? null,
    // ── v6 new fields ─────────────────────────────────────────────────────
    name_meaning:                b.name_meaning as string ?? null,
    hero_why:                    b.hero_why as string ?? null,
    lifecycle:                   b.lifecycle as string ?? null,
    lifestyle:                   b.lifestyle as string ?? null,
    price_nums:                  b.price_nums as string ?? null,
    archetype_family:            b.archetype_family as string ?? null,
    music:                       b.music as string ?? null,
    music_link:                  b.music_link as string ?? null,
    custom_restriction:          b.custom_restriction as string ?? null,
    custom_occasion:             b.custom_occasion as string ?? null,
    respected_brands:            b.respected_brands as string ?? null,
    respected_why:               b.respected_why as string ?? null,
    goal:                        b.goal as string ?? null,
    social:                      b.social as string ?? null,
    vision:                      b.vision as string ?? null,
    vision_text:                 b.vision_text as string ?? null,
    tagline:                     b.tagline as string ?? null,
    cust_quote:                  b.cust_quote as string ?? null,
    caption_ex:                  b.caption_ex as string ?? null,
    metric:                      b.metric as string ?? null,
    anything:                    b.anything as string ?? null,
    national_day_relevance:      b.national_day_relevance as string ?? null,
    // ── Additional fields for tabbed correction form ──────────────────────
    eid_fitr_relevance:          b.eid_fitr_relevance as string ?? null,
    eid_adha_relevance:          b.eid_adha_relevance as string ?? null,
    founding_day_relevance:      b.founding_day_relevance as string ?? null,
    brand_refs:                  b.brand_refs as string ?? null,
    scale_minmax:                b.scale_minmax as number ?? null,
    scale_quietloud:             b.scale_quietloud as number ?? null,
    scale_localglobal:           b.scale_localglobal as number ?? null,
    scale_tradmod:               b.scale_tradmod as number ?? null,
    emotions:                    Array.isArray(b.emotions) ? b.emotions as string[] : null,
    occasions_ranked:            Array.isArray(b.occasions_ranked) ? b.occasions_ranked as string[] : null,
    problems:                    Array.isArray(b.problems) ? b.problems as string[] : null,
    platforms:                   Array.isArray(b.platforms) ? b.platforms as string[] : null,
    // Audience gender mix — extracted from audience_profiles.gender_mix JSONB
    audience_female_pct:         (() => {
      const gm = audience?.gender_mix as Record<string, number> | null
      if (!gm) return null
      const v = gm.female ?? gm.female_pct ?? null
      if (v == null) return null
      return v <= 1 ? Math.round(v * 100) : Math.round(v)
    })(),
    audience_male_pct:           (() => {
      const gm = audience?.gender_mix as Record<string, number> | null
      if (!gm) return null
      const v = gm.male ?? gm.male_pct ?? null
      if (v == null) return null
      return v <= 1 ? Math.round(v * 100) : Math.round(v)
    })(),
    // Identity fields for Tab 1
    brand_name_en:               brand.brand_name_en ?? null,
    city_primary:                brand.city_primary ?? null,
    sector:                      brand.sector ?? null,
  }

  // Flat lookup map: field_name → value, spanning all three Layer-1 tables
  // that evidence_bundles can reference (brand_profiles, audience_profiles,
  // visual_style_profiles). evidence_bundles.field_name is a bare column name
  // that may live in any of these tables.
  const fieldValueMap: Record<string, unknown> = {
    // brand_profiles columns
    ...(brand as unknown as Record<string, unknown>),
    // audience_profiles columns (overwrite only if audience row exists)
    ...(audience
      ? {
          description_ar:         audience.description_ar,
          language_preference:    audience.language_preference,
          // gender_mix stores either fractions (0–1) or percentages (0–100)
          primary_audience_gender: (() => {
            const g = audience.gender_mix as Record<string, number> | null
            if (!g) return null
            const rawF = g.female ?? g.female_pct ?? null
            const rawM = g.male   ?? g.male_pct   ?? null
            if (rawF == null || rawM == null) return null
            const f = rawF <= 1 ? Math.round(rawF * 100) : Math.round(rawF)
            const m = rawM <= 1 ? Math.round(rawM * 100) : Math.round(rawM)
            return `${f}% F / ${m}% M`
          })(),
        }
      : {}),
    // visual_style_profiles columns
    ...(visual_style
      ? {
          style_descriptor: visual_style.style_descriptor,
          color_palette:    visual_style.color_palette,
        }
      : {}),
  }

  const FIELD_LABELS_EN: Record<string, string> = {
    primary_audience_gender:  'Audience gender',
    arabic_dialect:           'Preferred dialect',
    price_position:           'Price position',
    formality_level:          'Formality level',
    humor_tolerance:          'Humor tolerance',
    religious_sensitivity:    'Religious sensitivity',
    bilingual_ratio:          'Arabic / English ratio',
    brand_differentiator:     'What makes you different',
    primary_kpi_type:         'Primary KPI',
    primary_channel:          'Primary platform',
    ramadan_relevance:        'Ramadan relevance',
    tone_anti_attribute_ids:  'Tone — avoid',
    archetype_primary:        'Primary archetype',
    archetype_secondary:      'Secondary archetype',
    archetype_family:         'Archetype family',
    lifecycle_stage:          'Lifecycle stage',
    lifecycle:                'Lifecycle',
    intent_state:             'Current intent',
    primary_color_hex:        'Primary brand color',
    sub_sector:               'Sub-sector',
    region_primary:           'Primary region',
    city_primary:             'Primary city',
    sector:                   'Sector',
    tone_register:            'Tone register',
    founding_story:           'Founding story',
    owner_values:             'Owner values',
    comfort_on_camera:        'Comfort on camera',
    way_of_speaking:          'Way of speaking',
    communication_style:      'Communication style',
    brand_goals:              'Brand goals',
    posting_rhythm:           'Posting rhythm',
    caption_style:            'Caption style',
    permission_level:         'Permission level',
    cultural_tension_owned:   'Cultural tension owned',
    goal_phase:               'Goal phase',
    brave_safe_default:       'Brave / safe default',
    national_day_relevance:   'National Day relevance',
    eid_fitr_relevance:       'Eid Al-Fitr relevance',
    eid_adha_relevance:       'Eid Al-Adha relevance',
    founding_day_relevance:   'Founding Day relevance',
    emotions:                 'Target emotions',
    occasions_ranked:         'Key occasions',
    lifestyle:                'Lifestyle',
    music:                    'Music style',
    music_link:               'Music reference',
    brand_refs:               'Brand references',
    price_nums:               'Price range (SAR)',
    vision:                   'Vision',
    vision_text:              'Vision (text)',
    tagline:                  'Tagline',
    cust_quote:               'Customer quote',
    caption_ex:               'Caption example',
    metric:                   'Success metric',
    anything:                 'Anything else',
    custom_restriction:       'Custom restriction',
    custom_occasion:          'Custom occasion',
    name_meaning:             'Brand name meaning',
    hero_why:                 'Why the founder',
    social:                   'Social handle',
    goal:                     'Content goal',
    problems:                 'Problems to solve',
    platforms:                'Active platforms',
    respected_brands:         'Respected brands',
    respected_why:            'Why respected',
    scale_minmax:             'Style scale — minimal / maximal',
    scale_quietloud:          'Style scale — quiet / loud',
    scale_localglobal:        'Style scale — local / global',
    scale_tradmod:            'Style scale — traditional / modern',
    description_ar:           'Audience description',
    language_preference:      'Audience language',
    style_descriptor:         'Visual style',
    color_palette:            'Color palette',
    founded_year:             'Founded year',
    brand_name_en:            'Brand name (English)',
    brand_name_ar:            'Brand name (Arabic)',
    audience_description_ar:  'Audience description',
    audience_age_range:       'Audience age range',
    audience_language_preference: 'Audience language',
  }

  const FIELD_LABELS_AR: Record<string, string> = {
    primary_audience_gender:  'جنس الجمهور المستهدف',
    arabic_dialect:           'اللهجة المفضلة',
    price_position:           'الموقع السعري',
    formality_level:          'مستوى الرسمية',
    humor_tolerance:          'قبول الفكاهة',
    religious_sensitivity:    'الحساسية الدينية',
    bilingual_ratio:          'نسبة العربية / الإنجليزية',
    brand_differentiator:     'ما يميزك عن المنافسين',
    primary_kpi_type:         'مؤشر الأداء الرئيسي',
    primary_channel:          'المنصة الرئيسية',
    ramadan_relevance:        'أهمية رمضان',
    tone_anti_attribute_ids:  'الأسلوب المنهي عنه',
    archetype_primary:        'النمط الأصلي الأساسي',
    archetype_secondary:      'النمط الأصلي الثانوي',
    archetype_family:         'عائلة النمط',
    lifecycle_stage:          'مرحلة دورة الحياة',
    lifecycle:                'دورة الحياة',
    intent_state:             'النية الحالية',
    primary_color_hex:        'اللون الرئيسي للعلامة',
    sub_sector:               'القطاع الفرعي',
    region_primary:           'المنطقة الرئيسية',
    city_primary:             'المدينة الرئيسية',
    sector:                   'القطاع',
    tone_register:            'مستوى الصوت',
    founding_story:           'قصة التأسيس',
    owner_values:             'قيم المالك',
    comfort_on_camera:        'الارتياح أمام الكاميرا',
    way_of_speaking:          'أسلوب الكلام',
    communication_style:      'أسلوب التواصل',
    brand_goals:              'أهداف العلامة',
    posting_rhythm:           'إيقاع النشر',
    caption_style:            'أسلوب التعليق',
    permission_level:         'مستوى الصلاحية',
    cultural_tension_owned:   'التوتر الثقافي المُتبنى',
    goal_phase:               'مرحلة الهدف',
    brave_safe_default:       'افتراضي جريء / آمن',
    national_day_relevance:   'أهمية اليوم الوطني',
    eid_fitr_relevance:       'أهمية عيد الفطر',
    eid_adha_relevance:       'أهمية عيد الأضحى',
    founding_day_relevance:   'أهمية يوم التأسيس',
    emotions:                 'المشاعر المستهدفة',
    occasions_ranked:         'المناسبات الرئيسية',
    lifestyle:                'نمط الحياة',
    music:                    'الأسلوب الموسيقي',
    music_link:               'مرجع موسيقي',
    brand_refs:               'مراجع العلامات',
    price_nums:               'النطاق السعري (ريال)',
    vision:                   'الرؤية',
    vision_text:              'نص الرؤية',
    tagline:                  'الشعار',
    cust_quote:               'اقتباس من العميل',
    caption_ex:               'مثال على التعليق',
    metric:                   'مقياس النجاح',
    anything:                 'أي شيء آخر',
    custom_restriction:       'قيد مخصص',
    custom_occasion:          'مناسبة مخصصة',
    name_meaning:             'معنى اسم العلامة',
    hero_why:                 'لماذا المؤسس',
    social:                   'الحساب الاجتماعي',
    goal:                     'هدف المحتوى',
    problems:                 'المشاكل المراد حلها',
    platforms:                'المنصات النشطة',
    respected_brands:         'علامات محترمة',
    respected_why:            'سبب الاحترام',
    scale_minmax:             'بسيط / معقد',
    scale_quietloud:          'هادئ / صاخب',
    scale_localglobal:        'محلي / عالمي',
    scale_tradmod:            'تقليدي / حديث',
    description_ar:           'وصف الجمهور',
    language_preference:      'لغة الجمهور',
    style_descriptor:         'الأسلوب البصري',
    color_palette:            'لوحة الألوان',
    founded_year:             'سنة التأسيس',
    brand_name_en:            'اسم العلامة (إنجليزي)',
    brand_name_ar:            'اسم العلامة (عربي)',
    audience_description_ar:  'وصف الجمهور',
    audience_age_range:       'الفئة العمرية',
    audience_language_preference: 'لغة الجمهور',
  }

  const fieldLabels = locale === 'ar' ? FIELD_LABELS_AR : FIELD_LABELS_EN
  const getFieldLabel = (name: string) =>
    fieldLabels[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  // Fields excluded from the evidence bundles list rendering only
  // (they have dedicated UI sections elsewhere on the page).
  // primary_audience_gender is shown in the Audience card; visual fields
  // are in VisualStyleCard. These still COUNT toward completeness and
  // WILL appear in the missing-fields banner so the user knows to fill them.
  const EVIDENCE_LIST_EXCLUDE = new Set([
    'color_palette', 'style_descriptor', 'primary_color_hex',
  ])
  // Keep the old name pointing at the same set so existing filter calls below still work.
  const VISUAL_STYLE_FIELDS = EVIDENCE_LIST_EXCLUDE

  // Map raw evidence_bundles field_name → CORRECTABLE_FIELDS enum key.
  // Audience/visual table columns use bare names in evidence_bundles but the
  // server action expects prefixed names.
  const FIELD_NAME_REMAP: Record<string, string> = {
    language_preference: 'audience_language_preference',
    description_ar:      'audience_description_ar',
    age_range:           'audience_age_range',
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader eyebrow={t('profile.eyebrow')} title={t('profile.title')} subtitle={t('profile.subtitle')} />
        {/* Batch edit panel button */}
        <div className="pt-1 shrink-0">
          <CorrectionPanel brandId={brand.brand_id} currentValues={currentValues} locale={locale} />
        </div>
      </div>

      {/* Three-Axis v2 creative direction */}
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
      />

      {(() => {
        // A field only counts as "covered" when it has a qualifying confidence
        // state — same logic the SQL completeness function uses. Bundles with
        // 'no_data' or 'evidence_weak' do NOT count toward the score.
        const QUALIFYING = new Set(['inferred_medium', 'inferred_high', 'explicitly_confirmed'])
        const coveredFields = new Set(
          evidence.bundles
            .filter((b) => QUALIFYING.has(b.field_confidence))
            .map((b) => b.field_name)
        )
        const missingCriticalFields = CRITICAL_BRANDDNA_FIELDS.filter(
          (f) => !coveredFields.has(f) && !VISUAL_STYLE_FIELDS.has(f)
        )
        const filledCount = CRITICAL_BRANDDNA_FIELDS.filter(
          (f) => coveredFields.has(f)
        ).length
        const totalCritical = CRITICAL_BRANDDNA_FIELDS.length

        return (
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        {/* ── Left column: evidence bundles + missing fields ── */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('profile.criticalFieldsTitle')}</CardTitle>
              <CardDescription>
                {filledCount} / {totalCritical} critical fields complete
                {missingCriticalFields.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    {missingCriticalFields.length} missing
                  </span>
                )}
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {evidence.bundles.length === 0 && missingCriticalFields.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-(--fg-muted)">
                No evidence bundles yet. Onboarding hasn&apos;t completed — check{' '}
                <a className="font-medium text-(--accent) hover:underline" href={`/${slug}/processing`}>
                  /processing
                </a>
              </div>
            ) : (
              <ul className="divide-y divide-(--border-subtle)">
                {/* ── Fields with evidence bundles ── */}
                {evidence.bundles.filter((b) => !VISUAL_STYLE_FIELDS.has(b.field_name)).map((b) => {
                  const savedValue = fieldValueMap[b.field_name]
                  const displayValue =
                    savedValue == null
                      ? null
                      : Array.isArray(savedValue)
                        ? (savedValue as string[]).join(', ')
                        : String(savedValue)

                  return (
                    <li key={b.bundle_id} className="space-y-2 px-6 py-3.5">
                      <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-(--fg)">{getFieldLabel(b.field_name)}</div>
                          {displayValue && (
                            <div className="mt-0.5 font-mono text-xs text-(--accent)">
                              {displayValue}
                            </div>
                          )}
                          {!displayValue && (
                            <div className="mt-0.5 text-xs italic text-(--fg-faint)">Not set</div>
                          )}
                          <div className="mt-0.5 text-xs text-(--fg-muted)">
                            {t('profile.agreement')} <span className="font-mono">{(b.agreement_ratio * 100).toFixed(0)}%</span>
                            {' · '}
                            {t('profile.recency')} <span className="font-mono">{(b.recency_score * 100).toFixed(0)}%</span>
                            {' · '}
                            {t('profile.conflict')} <span className="font-mono">{(b.conflict_score * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        <Badge tone={confidenceTone(b.field_confidence)}>
                          {confidenceLabel(b.field_confidence, t)}
                        </Badge>
                      </div>
                      <CorrectionForm
                        brandId={brand.brand_id}
                        fieldName={FIELD_NAME_REMAP[b.field_name] ?? b.field_name}
                        currentValue={displayValue}
                        locale={locale}
                      />
                    </li>
                  )
                })}

                {/* ── Missing critical fields — fill to reach 100% ── */}
                {missingCriticalFields.length > 0 && (
                  <>
                    <li className="px-6 py-2.5 bg-(--danger)/5 border-t-2 border-(--danger)/25">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-(--danger)">
                          {missingCriticalFields.length} critical field{missingCriticalFields.length !== 1 ? 's' : ''} missing — fill to reach 100%
                        </span>
                      </div>
                    </li>
                    {missingCriticalFields.map((fieldName) => {
                      const savedValue = fieldValueMap[fieldName]
                      const displayValue =
                        savedValue == null
                          ? null
                          : Array.isArray(savedValue)
                            ? (savedValue as string[]).join(', ')
                            : String(savedValue)

                      return (
                        <li key={`missing-${fieldName}`} className="space-y-2 px-6 py-3.5 bg-(--danger)/5 border-l-2 border-(--danger)/40">
                          <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-(--fg)">{getFieldLabel(fieldName)}</div>
                              {displayValue ? (
                                <div className="mt-0.5 font-mono text-xs text-(--accent)">{displayValue}</div>
                              ) : (
                                <div className="mt-0.5 text-xs italic text-(--danger)/70">Not filled yet — add below to reach 100%</div>
                              )}
                            </div>
                            <Badge tone="danger">missing</Badge>
                          </div>
                          <CorrectionForm
                            brandId={brand.brand_id}
                            fieldName={FIELD_NAME_REMAP[fieldName] ?? fieldName}
                            currentValue={displayValue}
                            locale={locale}
                          />
                        </li>
                      )
                    })}
                  </>
                )}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* ── Right column: meta info ─────────────────────────────── */}
        <div className="space-y-5">
          {/* Basics */}
          <Card>
            <CardHeader><div><CardTitle>{t('profile.basicsCard')}</CardTitle></div></CardHeader>
            <CardBody className="space-y-2.5 text-sm">
              <Row label={t('profile.sector')}        value={brand.sector} />
              <Row label={t('profile.city')}          value={brand.city_primary ?? '—'} />
              <Row label={t('profile.dialect')}       value={brand.arabic_dialect ?? '—'} />
              <Row label={t('profile.pricePosition')} value={brand.price_position ?? '—'} />
              <Row label={t('profile.channel')}       value={brand.primary_channel ?? '—'} />
              <Row label={t('profile.tier')}          value={brand.tier} />
              {current_confidence?.mode && (
                <Row label="Confidence Mode" value={current_confidence.mode} />
              )}
              {brand.ramadan_relevance && (
                <Row label="Ramadan Relevance" value={brand.ramadan_relevance} />
              )}
              {brand.formality_level && (
                <Row label="Formality" value={brand.formality_level} />
              )}
              {brand.humor_tolerance && (
                <Row label="Humor" value={brand.humor_tolerance} />
              )}
              {brand.bilingual_ratio && (
                <Row label="Bilingual Ratio" value={brand.bilingual_ratio} />
              )}
              {brand.primary_kpi_type && (
                <Row label="Primary KPI" value={brand.primary_kpi_type} />
              )}
            </CardBody>
          </Card>

          {/* Completeness */}
          <Card className={missingCriticalFields.length > 0 ? 'border-(--danger)/30' : undefined}>
            <CardHeader><div><CardTitle>{t('profile.completenessCard')}</CardTitle></div></CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className={`font-display text-4xl font-semibold tracking-tight ${brand.completeness_score === 100 ? 'text-(--success)' : missingCriticalFields.length > 0 ? 'text-(--danger)' : 'text-(--accent)'}`}>
                  {brand.completeness_score}
                </span>
                <span className="text-sm text-(--fg-muted)">/ 100</span>
              </div>
              <Progress value={brand.completeness_score} />
              {/* Missing critical fields — shown as red badges identical to strategy review */}
              {missingCriticalFields.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-(--r-md) border border-(--danger)/30 bg-(--danger)/5 px-3 py-2.5">
                  <span className="text-xs font-semibold text-(--danger) w-full mb-1">
                    {missingCriticalFields.length} field{missingCriticalFields.length !== 1 ? 's' : ''} missing:
                  </span>
                  {missingCriticalFields.map((f) => (
                    <Badge key={f} tone="danger" size="sm">{getFieldLabel(f)}</Badge>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {Object.entries(dna.evidence.summary.by_state)
                  .filter(([, count]) => count > 0)
                  .map(([state, count]) => (
                    <Badge key={state} tone={confidenceTone(state as Parameters<typeof confidenceTone>[0])} size="sm">
                      {state.replace(/_/g, ' ')} ({count})
                    </Badge>
                  ))}
              </div>
            </CardBody>
          </Card>

          {/* Source signals */}
          {sources.count > 0 && (
            <Card>
              <CardHeader><div><CardTitle>Source signals</CardTitle></div></CardHeader>
              <CardBody className="space-y-2 text-sm">
                <div className="text-xs uppercase tracking-wide text-(--fg-muted)">{sources.count} signals collected</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(sources.by_type).map(([type, count]) => (
                    <Badge key={type} tone="outline" size="sm">{type} ({count})</Badge>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      )
      })()}

      {/* ── Brand differentiator (full width) ─────────────────────── */}
      {brand.brand_differentiator && (
        <Card>
          <CardHeader><div><CardTitle>Brand Differentiator</CardTitle></div></CardHeader>
          <CardBody>
            <p className="text-sm text-(--fg)">{brand.brand_differentiator}</p>
          </CardBody>
        </Card>
      )}

      {/* ── Layer 1 extras + Layer 3 ─────────────────────────────────── */}
      {!!(brand.sub_sector || brand.region_primary || brand.founded_year || brand.tone_register ||
        brand.posting_rhythm || brand.caption_style || brand.formality_level || brand.humor_tolerance ||
        b.tagline || b.products_list) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {!!(brand.sub_sector || brand.region_primary || brand.founded_year || brand.tone_register) && (
            <Card>
              <CardHeader><div><CardTitle>Brand Details</CardTitle><CardDescription>Layer 1 — identity extras</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {!!brand.sub_sector     && <Row label="Sub-sector"    value={String(brand.sub_sector)} />}
                {!!brand.region_primary && <Row label="Region"        value={String(brand.region_primary)} />}
                {!!brand.founded_year   && <Row label="Founded"       value={String(brand.founded_year)} />}
                {!!brand.tone_register  && <Row label="Tone register"  value={String(brand.tone_register)} />}
              </CardBody>
            </Card>
          )}
          {!!(brand.posting_rhythm || brand.caption_style || brand.formality_level || brand.humor_tolerance || b.tagline) && (
            <Card>
              <CardHeader><div><CardTitle>Content Style</CardTitle><CardDescription>Layer 3 — how you post and communicate</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {!!brand.posting_rhythm   && <Row label="Posting rhythm"  value={brand.posting_rhythm.replace(/_/g, ' ')} />}
                {!!brand.caption_style    && <Row label="Caption style"   value={brand.caption_style.replace(/_/g, ' ')} />}
                {!!brand.formality_level  && <Row label="Formality"       value={brand.formality_level.replace(/_/g, ' ')} />}
                {!!brand.humor_tolerance  && <Row label="Humor tolerance" value={brand.humor_tolerance.replace(/_/g, ' ')} />}
                {!!b.tagline              && <Row label="Tagline"         value={String(b.tagline)} />}
              </CardBody>
            </Card>
          )}
          {!!b.products_list && (
            <Card className="lg:col-span-2">
              <CardHeader><div><CardTitle>Products & Services</CardTitle><CardDescription>What the brand sells</CardDescription></div></CardHeader>
              <CardBody>
                <p className="text-sm text-(--fg) leading-relaxed whitespace-pre-line">{String(b.products_list)}</p>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Owner Profile (Layer 2) + Strategic Intelligence (Layer 4) ── */}
      {(brand.founding_story || brand.owner_values || brand.comfort_on_camera || brand.way_of_speaking ||
        brand.communication_style || brand.brand_goals ||
        brand.permission_level || brand.cultural_tension_owned || brand.goal_phase || brand.brave_safe_default != null) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Layer 2 */}
          {(brand.founding_story || brand.owner_values || brand.comfort_on_camera || brand.way_of_speaking) && (
            <Card>
              <CardHeader><div><CardTitle>Owner Profile</CardTitle><CardDescription>Layer 2 — progressively updated via corrections</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {brand.founding_story && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Founding Story</div>
                    <p className="text-(--fg) leading-relaxed">{brand.founding_story}</p>
                  </div>
                )}
                {brand.owner_values && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Owner Values</div>
                    <p className="text-(--fg) leading-relaxed">{brand.owner_values}</p>
                  </div>
                )}
                {brand.comfort_on_camera && <Row label="Comfort on Camera" value={brand.comfort_on_camera} />}
                {brand.way_of_speaking && <Row label="Way of Speaking" value={brand.way_of_speaking} />}
                {brand.communication_style && <Row label="Communication Style" value={brand.communication_style} />}
                {brand.brand_goals && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Business Goals</div>
                    <p className="text-(--fg) leading-relaxed">{brand.brand_goals}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
          {/* Layer 4 */}
          {(brand.permission_level || brand.cultural_tension_owned || brand.goal_phase || brand.brave_safe_default != null) && (
            <Card>
              <CardHeader><div><CardTitle>Strategic Intelligence</CardTitle><CardDescription>Layer 4 — drives content strategy & calendar planning</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {brand.permission_level && <Row label="Permission Level" value={brand.permission_level} />}
                {brand.goal_phase && <Row label="Goal Phase" value={brand.goal_phase} />}
                {brand.brave_safe_default != null && (
                  <Row label="Content Stance" value={brand.brave_safe_default ? 'Brave — bold & provocative' : 'Safe — conservative & stable'} />
                )}
                {brand.cultural_tension_owned && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Cultural Tension Owned</div>
                    <p className="text-(--fg) leading-relaxed">{brand.cultural_tension_owned}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── v6 BrandDNA Fields ───────────────────────────────────────── */}
      {!!(b.name_meaning || b.hero_why || b.lifecycle || b.lifestyle || b.emotions || b.brand_refs ||
        b.music || b.archetype_family || b.goal || b.vision || b.respected_brands || b.tagline) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Feel & Aesthetic */}
          {!!(b.lifestyle || b.emotions || b.brand_refs || b.scale_minmax != null || b.cust_desc || b.scale_custom) && (
            <Card>
              <CardHeader><div><CardTitle>Feel & Aesthetic</CardTitle><CardDescription>Visual mood, customer, and aesthetic positioning</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {!!b.lifestyle && <Row label="Customer Lifestyle" value={String(b.lifestyle).replace('_',' ')} />}
                {!!b.cust_desc && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Customer Description</div>
                    <p className="text-(--fg) leading-relaxed">{String(b.cust_desc)}</p>
                  </div>
                )}
                {Array.isArray(b.emotions) && (b.emotions as string[]).length > 0 && <Row label="Target Emotions" value={(b.emotions as string[]).join(', ')} />}
                {Array.isArray(b.brand_refs) && (b.brand_refs as string[]).length > 0 && <Row label="Brand References" value={(b.brand_refs as string[]).join(', ')} />}
                {b.scale_minmax != null && <Row label="Scale Minimal→Maximal" value={String(b.scale_minmax)} />}
                {b.scale_quietloud != null && <Row label="Scale Quiet→Loud" value={String(b.scale_quietloud)} />}
                {b.scale_localglobal != null && <Row label="Scale Local→Global" value={String(b.scale_localglobal)} />}
                {b.scale_tradmod != null && <Row label="Scale Traditional→Modern" value={String(b.scale_tradmod)} />}
                {!!b.scale_custom && <Row label="Custom Style Scale" value={String(b.scale_custom)} />}
                {!!b.price_nums && <Row label="Price Range" value={String(b.price_nums)} />}
              </CardBody>
            </Card>
          )}
          {/* Voice & Archetype */}
          {!!(b.archetype_family || b.music || b.custom_restriction || b.occasions_ranked) && (
            <Card>
              <CardHeader><div><CardTitle>Voice & Character</CardTitle><CardDescription>Archetype, music mood, restrictions</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {!!b.archetype_family && <Row label="Archetype Family" value={String(b.archetype_family)} />}
                {!!b.music && <Row label="Music Mood" value={String(b.music)} />}
                {!!b.music_link && <Row label="Music Reference" value={String(b.music_link)} />}
                {!!b.custom_restriction && <Row label="Custom Restriction" value={String(b.custom_restriction)} />}
                {Array.isArray(b.occasions_ranked) && (b.occasions_ranked as string[]).length > 0 && (
                  <Row label="Top Occasions" value={(b.occasions_ranked as string[]).map((o,i) => `#${i+1} ${o}`).join(' · ')} />
                )}
              </CardBody>
            </Card>
          )}
          {/* Business & Vision */}
          {!!(b.goal || b.vision || b.respected_brands || b.problems) && (
            <Card>
              <CardHeader><div><CardTitle>Business & Vision</CardTitle><CardDescription>Goals, admired brands, and 12-month vision</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {!!b.goal && <Row label="Content Goal" value={String(b.goal)} />}
                {!!b.respected_brands && <Row label="Admired Brands" value={String(b.respected_brands)} />}
                {!!b.respected_why && <Row label="Why Admired" value={String(b.respected_why)} />}
                {Array.isArray(b.problems) && (b.problems as string[]).length > 0 && <Row label="Content Problems" value={(b.problems as string[]).join(', ')} />}
                {!!b.vision && <Row label="12-Month Vision" value={String(b.vision).replace('_',' ')} />}
                {!!b.vision_text && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Vision (Own Words)</div>
                    <p className="text-(--fg) leading-relaxed">{String(b.vision_text)}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
          {/* Identity extras */}
          {!!(b.name_meaning || b.hero_why || b.lifecycle || b.tagline || b.cust_quote || b.social || b.hero_upload_url) && (
            <Card>
              <CardHeader><div><CardTitle>Identity Extras</CardTitle><CardDescription>Name story, tagline, social handles</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {!!b.name_meaning && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Name Meaning</div>
                    <p className="text-(--fg) leading-relaxed">{String(b.name_meaning)}</p>
                  </div>
                )}
                {!!b.hero_why && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Hero Product — Why</div>
                    <p className="text-(--fg) leading-relaxed">{String(b.hero_why)}</p>
                  </div>
                )}
                {!!b.hero_upload_url && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-2">Hero Product Image</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={String(b.hero_upload_url)} alt="Hero product" className="rounded-(--r-md) border border-(--border-subtle) max-h-40 object-contain bg-(--surface-3)" />
                  </div>
                )}
                {!!b.lifecycle && <Row label="Brand Lifecycle" value={String(b.lifecycle)} />}
                {!!b.tagline && <Row label="Tagline" value={String(b.tagline)} />}
                {!!b.cust_quote && <Row label="Customer Quote" value={String(b.cust_quote)} />}
                {!!b.caption_ex && <Row label="Caption Example" value={String(b.caption_ex)} />}
                {!!b.social && <Row label="All Social Handles" value={String(b.social)} />}
                {!!b.metric && <Row label="Success Metric" value={String(b.metric)} />}
                {Array.isArray(b.platforms) && (b.platforms as string[]).length > 0 && <Row label="Active Platforms" value={(b.platforms as string[]).join(', ')} />}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Instagram Signals (extraction analytics — migration 0094) ─ */}
      {!!(b.bio_text || b.followers_count != null || b.avg_engagement_rate != null ||
          b.posting_frequency_per_week != null || b.primary_content_format ||
          b.caption_avg_length != null || b.top_hashtags || b.top_mentioned_accounts ||
          b.signature_phrases || b.brand_reply_samples) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Account signals */}
          {!!(b.bio_text || b.bio_link || b.followers_count != null || b.ig_post_count != null ||
              b.avg_engagement_rate != null || b.posting_frequency_per_week != null ||
              b.caption_avg_length != null || b.primary_content_format || b.posts_observed_count) && (
            <Card>
              <CardHeader><div><CardTitle>Instagram Signals</CardTitle><CardDescription>Extracted from your Instagram account</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {!!b.bio_text && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Bio</div>
                    <p className="text-(--fg) leading-relaxed">{String(b.bio_text)}</p>
                  </div>
                )}
                {!!b.bio_link && <Row label="Bio Link" value={String(b.bio_link)} />}
                {b.followers_count != null && <Row label="Followers" value={formatCount(Number(b.followers_count))} />}
                {b.ig_post_count != null && <Row label="Total Posts" value={String(b.ig_post_count)} />}
                {b.avg_engagement_rate != null && <Row label="Avg Engagement Rate" value={`${(Number(b.avg_engagement_rate) * 100).toFixed(2)}%`} />}
                {b.posting_frequency_per_week != null && <Row label="Posts per Week" value={String(b.posting_frequency_per_week)} />}
                {b.caption_avg_length != null && <Row label="Avg Caption Length" value={`${b.caption_avg_length} chars`} />}
                {!!b.primary_content_format && <Row label="Primary Content Format" value={String(b.primary_content_format).replace(/_/g,' ')} />}
                {b.posts_observed_count != null && Number(b.posts_observed_count) > 0 && <Row label="Posts Observed" value={String(b.posts_observed_count)} />}
              </CardBody>
            </Card>
          )}
          {/* Content patterns */}
          {!!(b.top_hashtags || b.top_mentioned_accounts || b.signature_phrases || b.brand_reply_samples || b.content_type_distribution) && (
            <Card>
              <CardHeader><div><CardTitle>Content Patterns</CardTitle><CardDescription>Observed language and format patterns</CardDescription></div></CardHeader>
              <CardBody className="space-y-3 text-sm">
                {Array.isArray(b.top_hashtags) && (b.top_hashtags as string[]).length > 0 && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-2">Top Hashtags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(b.top_hashtags as string[]).slice(0, 12).map((h: string) => (
                        <span key={h} className="rounded-full bg-(--surface-3) border border-(--border-subtle) px-2.5 py-1 text-xs font-mono text-(--fg-muted)">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(b.top_mentioned_accounts) && (b.top_mentioned_accounts as string[]).length > 0 && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-2">Top Mentioned Accounts</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(b.top_mentioned_accounts as string[]).slice(0, 8).map((a: string) => (
                        <span key={a} className="rounded-full bg-(--accent-soft)/20 border border-(--accent)/20 px-2.5 py-1 text-xs text-(--accent)">@{a}</span>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(b.signature_phrases) && (b.signature_phrases as string[]).length > 0 && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Signature Phrases</div>
                    <div className="space-y-1">
                      {(b.signature_phrases as string[]).slice(0, 5).map((p: string, i: number) => (
                        <p key={i} className="text-(--fg) italic text-xs">"{p}"</p>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(b.brand_reply_samples) && (b.brand_reply_samples as string[]).length > 0 && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-1">Brand Reply Samples</div>
                    <div className="space-y-1">
                      {(b.brand_reply_samples as string[]).slice(0, 3).map((r: string, i: number) => (
                        <p key={i} className="text-(--fg) text-xs">"{r}"</p>
                      ))}
                    </div>
                  </div>
                )}
                {!!(b.content_type_distribution && typeof b.content_type_distribution === 'object') && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-(--fg-muted) mb-2">Content Type Distribution</div>
                    <div className="space-y-1.5">
                      {Object.entries(b.content_type_distribution as Record<string, number>)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 6)
                        .map(([type, pct]) => (
                          <div key={type} className="flex items-center gap-2">
                            <span className="w-28 text-xs text-(--fg) shrink-0">{type.replace(/_/g, ' ')}</span>
                            <div className="flex-1 rounded-full bg-(--surface-3) h-1.5 overflow-hidden">
                              <div className="h-full rounded-full bg-(--accent)" style={{ width: `${Math.min(100, Math.round(Number(pct) <= 1 ? Number(pct) * 100 : Number(pct)))}%` }} />
                            </div>
                            <span className="text-xs text-(--fg-muted) tabular-nums w-8 text-right">
                              {Number(pct) <= 1 ? Math.round(Number(pct) * 100) : Math.round(Number(pct))}%
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── LoRA Visual Model + Calibration ───────────────────────────── */}
      {!!(brand.lora_training_status || brand.is_calibration_period || brand.calibration_ends_at) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {!!brand.lora_training_status && (
            <Card>
              <CardHeader><div><CardTitle>Visual Model (LoRA)</CardTitle><CardDescription>AI image style trained on your brand assets</CardDescription></div></CardHeader>
              <CardBody className="space-y-2.5 text-sm">
                <Row label="Training Status" value={String(brand.lora_training_status).replace(/_/g, ' ')} />
                {brand.lora_model_id && <Row label="Model ID" value={brand.lora_model_id} />}
                {brand.lora_training_photo_count != null && <Row label="Training Photos" value={String(brand.lora_training_photo_count)} />}
                {brand.lora_trained_at && (
                  <Row label="Trained At" value={new Date(brand.lora_trained_at).toLocaleDateString('en-SA', { year: 'numeric', month: 'short', day: 'numeric' })} />
                )}
              </CardBody>
            </Card>
          )}
          {brand.is_calibration_period != null && (
            <Card>
              <CardHeader>
                <div><CardTitle>Calibration Period</CardTitle><CardDescription>First 90 days — learning from your content</CardDescription></div>
                <Badge tone={brand.is_calibration_period ? 'warning' : 'success'} dot>
                  {brand.is_calibration_period ? 'Active' : 'Complete'}
                </Badge>
              </CardHeader>
              <CardBody className="space-y-2.5 text-sm">
                {brand.is_calibration_period && brand.calibration_ends_at && (() => {
                  const daysLeft = Math.max(0, Math.ceil((new Date(brand.calibration_ends_at).getTime() - Date.now()) / 86_400_000))
                  return <Row label="Days Remaining" value={String(daysLeft)} />
                })()}
                {brand.calibration_ends_at && (
                  <Row label="Ends At" value={new Date(brand.calibration_ends_at).toLocaleDateString('en-SA', { year: 'numeric', month: 'short', day: 'numeric' })} />
                )}
                <p className="text-xs text-(--fg-muted) leading-relaxed">
                  During calibration, the system learns from every published post and interaction.
                  Recommendations improve automatically as data accumulates.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Audience + Visual style + Channels ────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Audience */}
        <Card>
          <CardHeader><div><CardTitle>Audience</CardTitle></div></CardHeader>
          <CardBody className="space-y-2 text-sm">
            {audience ? (
              <>
                {(() => {
                  // gender_mix is JSONB — cast explicitly to read the values safely
                  const gm = audience.gender_mix as Record<string, number> | null
                  const female = gm?.female ?? gm?.female_pct ?? null
                  const male   = gm?.male   ?? gm?.male_pct   ?? null
                  if (female == null && male == null) return null
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-(--fg-muted)">Gender mix</span>
                        <span className="font-medium text-(--fg)">
                          {prettyPct(female)} F / {prettyPct(male)} M
                        </span>
                      </div>
                      {/* Visual bar */}
                      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-(--surface-3)">
                        <div
                          className="h-full rounded-full bg-pink-400"
                          style={{ width: `${prettyPctNum(female)}%` }}
                        />
                        <div
                          className="h-full rounded-full bg-blue-400"
                          style={{ width: `${prettyPctNum(male)}%` }}
                        />
                      </div>
                    </div>
                  )
                })()}
                {audience.language_preference && (
                  <Row label="Language" value={audience.language_preference.replace(/_/g, ' ')} />
                )}
                {(audience as unknown as Record<string,unknown>).age_range && (
                  <Row label="Age range" value={(() => {
                    const ar = (audience as unknown as Record<string,unknown>).age_range as Record<string,unknown>
                    if (ar?.min != null || ar?.max != null) return `${ar.min ?? '?'} – ${ar.max ?? '?'} yrs`
                    return Object.entries(ar ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'
                  })()} />
                )}
                {audience.description_ar && (
                  <p dir="rtl" className="mt-1 rounded-(--r-sm) bg-(--surface-2) p-2.5 text-sm leading-relaxed text-(--fg)">
                    {audience.description_ar}
                  </p>
                )}
              </>
            ) : (
              <p className="text-(--fg-faint)">No audience profile yet.</p>
            )}
          </CardBody>
        </Card>

        {/* Visual style */}
        <Card>
          <CardHeader><div><CardTitle>Visual style</CardTitle></div></CardHeader>
          <CardBody className="space-y-3 text-sm">
            <VisualStyleCard
              brandId={brand.brand_id}
              initialPalette={visual_style?.color_palette ?? (brand.primary_color_hex ? [brand.primary_color_hex] : null)}
              initialDescriptor={visual_style?.style_descriptor ?? null}
            />
          </CardBody>
        </Card>

        {/* Channels */}
        <Card>
          <CardHeader><div><CardTitle>Channels</CardTitle></div></CardHeader>
          <CardBody className="space-y-4 text-sm">
            {channels.length === 0 && <p className="text-(--fg-faint)">No channels yet.</p>}
            {channels.map((c) => {
              const isVerified = c.is_verified
              const isBusiness = c.is_business
              return (
                <div key={c.channel_id} className="space-y-2 border-b border-(--border-subtle) pb-3 last:border-0 last:pb-0">
                  {/* Header row: platform + handle + badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-(--fg)">{c.channel}</span>
                      {isVerified && (
                        <span title="Verified" className="text-blue-400 text-xs">✓</span>
                      )}
                      {isBusiness && (
                        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-(--surface-3) text-(--fg-muted)">Business</span>
                      )}
                    </div>
                    {c.handle && (
                      c.profile_url
                        ? <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-(--accent) hover:underline">@{c.handle}</a>
                        : <span className="shrink-0 text-xs text-(--fg-muted)">@{c.handle}</span>
                    )}
                  </div>

                  {/* Full name + bio */}
                  {c.full_name && (
                    <p className="text-xs font-medium text-(--fg)">{c.full_name}</p>
                  )}
                  {c.biography && (
                    <p className="text-xs text-(--fg-muted) leading-relaxed line-clamp-3">
                      {c.biography}
                    </p>
                  )}

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {c.followers_count != null && (
                      <StatPill label="Followers" value={formatCount(c.followers_count)} />
                    )}
                    {c.follows_count != null && (
                      <StatPill label="Following" value={formatCount(c.follows_count)} />
                    )}
                    {c.posts_count_total != null && (
                      <StatPill label="Posts" value={formatCount(c.posts_count_total)} />
                    )}
                    {c.engagement_rate != null && (
                      <StatPill label="Engagement" value={`${(c.engagement_rate * 100).toFixed(1)}%`} />
                    )}
                    {c.business_category && (
                      <StatPill label="Category" value={c.business_category} />
                    )}
                    {c.external_url && (
                      <div className="col-span-2">
                        <a
                          href={c.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-(--accent) hover:underline truncate block"
                        >
                          {c.external_url}
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Sync time */}
                  {c.synced_at && (
                    <p className="text-[10px] text-(--fg-faint)">
                      Synced {new Date(c.synced_at).toLocaleDateString('en-SA', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                </div>
              )
            })}
          </CardBody>
        </Card>
      </div>

      {/* ── Brand Assets gallery ───────────────────────────────────────── */}
      {Array.isArray(b.brand_assets_bundle) && (b.brand_assets_bundle as unknown[]).length > 0 && (() => {
        const assets = (b.brand_assets_bundle as Array<{ url: string; name?: string; mime?: string; size?: number }>)
          .filter((a) => typeof a?.url === 'string' && a.url.length > 0)
        if (assets.length === 0) return null
        return (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Brand Assets</CardTitle>
                <CardDescription>{assets.length} file{assets.length !== 1 ? 's' : ''} · auto-imported from Instagram + uploads</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <AssetGallery assets={assets} />
            </CardBody>
          </Card>
        )
      })()}

      {/* ── Negative patterns + Override rules (interactive CRUD) ────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <NegativePatternsManager
          slug={slug}
          brand_id={brand.brand_id}
          initial_patterns={negative_patterns}
        />
        <OverrideRulesManager
          slug={slug}
          brand_id={brand.brand_id}
          initial_rules={override_rules}
        />
      </div>

      {/* ── BrandDNA Event Log ──────────────────────────────────────────── */}
      <Suspense fallback={<EventLogSkeleton />}>
        <EventLogSection brand_id={brand.brand_id} slug={slug} evtPage={evtPage} />
      </Suspense>
    </div>
  )
}

function EventLogSkeleton() {
  return (
    <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1)">
      <div className="p-5 border-b border-(--border-subtle) space-y-1.5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-36" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3.5 px-5 py-3.5 border-b border-(--border-subtle) last:border-0">
          <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded" />
            </div>
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
      <span className="text-(--fg-muted)">{label}</span>
      <span className="font-medium text-(--fg)">{value}</span>
    </div>
  )
}

function prettyPct(v: number | null | undefined): string {
  if (v === undefined || v === null) return '—'
  const n = v <= 1 ? Math.round(v * 100) : Math.round(v)
  return `${n}%`
}

// Returns the numeric percentage (0–100) — used for CSS width calculations
function prettyPctNum(v: number | null | undefined): number {
  if (v === undefined || v === null) return 0
  return v <= 1 ? Math.round(v * 100) : Math.round(v)
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-(--fg-faint)">{label}</span>
      <p className="text-xs font-medium text-(--fg)">{value}</p>
    </div>
  )
}

