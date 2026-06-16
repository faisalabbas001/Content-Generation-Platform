'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@repo/db/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Button } from '@repo/ui/button'
import { Field, Input, Select, Textarea } from '@repo/ui/input'
import { submitBrandCorrection, submitBrandCorrectionBatch } from '@/app/actions/brand-correction'

// ── Correction pipeline types ─────────────────────────────────────────────────

type FieldStatus = 'idle' | 'submitting' | 'waiting' | 'written' | 'rejected' | 'timeout' | 'error'

type CorrectionStage =
  | 'correction_received'
  | 'ceo_classifying'
  | 'ceo_approved'
  | 'memory_writing'
  | 'correction_applied'
  | 'correction_rejected'

const PIPELINE_STEPS: { stage: CorrectionStage; label: string; sublabel: string }[] = [
  { stage: 'correction_received', label: 'Received',   sublabel: 'Validated & queued' },
  { stage: 'ceo_classifying',     label: 'CEO Review', sublabel: 'Classifying changes' },
  { stage: 'ceo_approved',        label: 'Approved',   sublabel: 'Writing to memory' },
  { stage: 'memory_writing',      label: 'Persisting', sublabel: 'Updating BrandDNA' },
  { stage: 'correction_applied',  label: 'Applied',    sublabel: 'BrandDNA updated ✓' },
]

const STAGE_ORDER: Record<CorrectionStage, number> = {
  correction_received:  0,
  ceo_classifying:      1,
  ceo_approved:         2,
  memory_writing:       3,
  correction_applied:   4,
  correction_rejected:  4,
}

const REJECTION_REASON_MAP: Record<string, string> = {
  value_out_of_enum:          'Value is not valid for this field — please choose from the available options',
  forbidden_field_path:       'This field cannot be changed via corrections',
  duplicate_value:            'This value is already saved — no change was needed',
  brand_not_found:            'Brand not found — please refresh and try again',
  evidence_sources_not_found: 'Evidence sources could not be verified',
  invalid_data_shape:         'Submission format was invalid — please try again',
  pii_in_anonymous_signal:    'Submission contained personal data that cannot be stored',
  apply_failed:               'Write to BrandDNA failed — please try again',
  hard_block_negative_pattern:'This correction conflicts with a brand content rule',
  cco_low_confidence:         'AI confidence was too low to approve this change',
  first_ever_client_output:   'Requires human review before applying',
  revision_cycle_exceeded:    'Too many revisions — please contact support',
}

function humaniseRejection(raw: string | null): string {
  if (!raw) return 'Rejected — please try again with a different value'
  for (const [code, msg] of Object.entries(REJECTION_REASON_MAP)) {
    if (raw.includes(code)) return msg
  }
  const clean = raw.replace(/^[a-z_]+:\s*/i, '').replace(/\[object Object\]/g, 'submitted value')
  return clean.length < 120 ? clean : `${clean.slice(0, 117)}…`
}

// ── Tab configuration ─────────────────────────────────────────────────────────

type TabId = 1 | 2 | 3 | 4 | 5 | 6

const TABS_AR = [
  { id: 1 as TabId, label: 'الهوية' },
  { id: 2 as TabId, label: 'الصوت' },
  { id: 3 as TabId, label: 'الشخصية' },
  { id: 4 as TabId, label: 'الجمهور' },
  { id: 5 as TabId, label: 'القصة' },
  { id: 6 as TabId, label: 'المحتوى' },
] as const

const TABS_EN = [
  { id: 1 as TabId, label: 'Identity' },
  { id: 2 as TabId, label: 'Voice' },
  { id: 3 as TabId, label: 'Personality' },
  { id: 4 as TabId, label: 'Audience' },
  { id: 5 as TabId, label: 'Story' },
  { id: 6 as TabId, label: 'Content' },
] as const

// ── Enum options (mirrors review-form.tsx) ────────────────────────────────────

const SECTORS        = ['F&B', 'Retail', 'Beauty_Wellness', 'Healthcare', 'Finance', 'Government', 'Other'] as const
const SAUDI_CITIES   = ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar', 'Tabuk', 'Abha', 'Other'] as const
const DIALECTS       = ['Najdi', 'Hejazi', 'Gulf', 'MSA_formal', 'MSA_accessible', 'Mixed'] as const
const BILINGUAL      = ['arabic_only', 'arabic_primary', 'balanced', 'english_primary'] as const
const FORMALITY      = ['casual', 'semi_formal', 'formal'] as const
const HUMOR          = ['none', 'light', 'moderate'] as const
const RELIGIOUS      = ['Low', 'Medium', 'High'] as const
const TONE_REGISTER  = ['Traditional', 'Modern', 'Youth', 'Mixed'] as const
const ANTI_ATTRIBUTES = [
  'aggressive', 'western_casual', 'flashy', 'edgy', 'ironic',
  'formal_corporate', 'casual_humor', 'salesy',
] as const
const ARCHETYPE_FAMILY = [
  { v: 'hero',      label: 'Hero',      hint: 'Bold, courageous, results-driven' },
  { v: 'caregiver', label: 'Caregiver', hint: 'Nurturing, warm, community first' },
  { v: 'explorer',  label: 'Explorer',  hint: 'Curious, adventurous, independent' },
  { v: 'creator',   label: 'Creator',   hint: 'Imaginative, original, expressive' },
] as const
const ARCHETYPE_PRIMARY: Record<string, Array<{ v: string; label: string }>> = {
  hero:      [{ v: 'hero_hero', label: 'Hero' }, { v: 'hero_outlaw', label: 'Outlaw' }, { v: 'hero_magician', label: 'Magician' }],
  caregiver: [{ v: 'care_caregiver', label: 'Caregiver' }, { v: 'care_ruler', label: 'Ruler' }, { v: 'care_everyman', label: 'Everyman' }],
  explorer:  [{ v: 'exp_explorer', label: 'Explorer' }, { v: 'exp_sage', label: 'Sage' }, { v: 'exp_jester', label: 'Jester' }],
  creator:   [{ v: 'crt_creator', label: 'Creator' }, { v: 'crt_lover', label: 'Lover' }, { v: 'crt_innocent', label: 'Innocent' }],
}
const MUSIC = [
  { v: 'acoustic',  label: 'Acoustic',  hint: 'Warm, intimate, honest' },
  { v: 'arabic',    label: 'Arabic',    hint: 'Cultural, rooted, authentic' },
  { v: 'pop',       label: 'Pop',       hint: 'Energetic, mainstream, fun' },
  { v: 'cinematic', label: 'Cinematic', hint: 'Epic, aspirational, grand' },
  { v: 'lofi',      label: 'Lo-fi',     hint: 'Relaxed, everyday, cozy' },
  { v: 'energy',    label: 'Energy',    hint: 'High-tempo, bold, dynamic' },
] as const
const LIFESTYLE = [
  { v: 'family_home',  label: 'Family & Home',    hint: 'Domestic, togetherness' },
  { v: 'coffee_solo',  label: 'Coffee Solo',       hint: 'Reflective, individual moments' },
  { v: 'mall_friends', label: 'Mall with Friends', hint: 'Social, trendy, urban' },
  { v: 'gym',          label: 'Gym / Sport',       hint: 'Active, disciplined, ambitious' },
  { v: 'gathering',    label: 'Gathering',         hint: 'Hospitality, celebration' },
  { v: 'outdoor',      label: 'Outdoor',           hint: 'Nature, exploration, freedom' },
] as const
const EMOTIONS = [
  'Inspired', 'Proud', 'Calm', 'Excited', 'Nostalgic', 'Trusted',
  'Delighted', 'Empowered', 'Curious', 'Warm', 'Energized', 'Secure',
  'Bold', 'Playful', 'Sophisticated', 'Motivated', 'Grateful', 'Happy',
] as const
const PRICE        = ['budget', 'mid_market', 'premium', 'luxury'] as const
const CHANNELS     = ['Instagram', 'Snapchat', 'TikTok', 'Twitter'] as const
const KPI          = ['engagement', 'conversion', 'awareness', 'trust'] as const
const INTENTS      = [
  { v: 'launch',  label: 'Launch',  hint: 'Establish that you exist and matter' },
  { v: 'grow',    label: 'Grow',    hint: 'Expand reach beyond current audience' },
  { v: 'defend',  label: 'Defend',  hint: 'Protect position from competitive pressure' },
  { v: 'harvest', label: 'Harvest', hint: 'Convert engaged audience into revenue' },
  { v: 'recover', label: 'Recover', hint: 'Re-engage after dormancy or crisis' },
] as const
const RELEVANCE    = ['Critical', 'High', 'Medium', 'Low', 'Not_relevant'] as const
const OCCASIONS_LIST = ['Ramadan', 'Eid Al-Fitr', 'Eid Al-Adha', 'Saudi National Day', 'Founding Day'] as const
const RESTRICTIONS_LIST = [
  'no_faces', 'no_music', 'no_men', 'no_women', 'no_food_close_ups',
  'no_luxury_cues', 'no_western_refs', 'no_competitor_refs',
] as const
const PERMISSION_LEVEL = [
  { v: 'category_leader', label: 'Category leader',  hint: 'Top brand in the sector' },
  { v: 'challenger',      label: 'Challenger',        hint: 'Growing fast, taking share' },
  { v: 'institutional',   label: 'Institutional',     hint: 'Government, healthcare, finance' },
  { v: 'purpose',         label: 'Purpose-driven',    hint: 'Mission or values first' },
  { v: 'launch',          label: 'New launch',        hint: 'Building from zero' },
  { v: 'sme_local',       label: 'SME / local',       hint: 'Community, neighbourhood focus' },
] as const
const GOAL_PHASE = ['awareness', 'conversion', 'retention', 'launch'] as const
const POSTING_RHYTHM = [
  { v: 'daily',    label: 'Daily',       hint: '7 posts/week' },
  { v: '3x_week',  label: '3× per week', hint: 'Mon / Wed / Fri' },
  { v: 'weekly',   label: 'Weekly',      hint: '1 post/week' },
  { v: 'biweekly', label: 'Bi-weekly',   hint: 'Every 2 weeks' },
  { v: 'monthly',  label: 'Monthly',     hint: 'Once a month' },
] as const
const CAPTION_STYLE = [
  { v: 'short_punchy',      label: 'Short & punchy',    hint: '1-3 lines, direct impact' },
  { v: 'long_storytelling', label: 'Long storytelling', hint: 'Narrative paragraphs' },
  { v: 'question_hook',     label: 'Question hook',     hint: 'Starts with a question' },
  { v: 'cta_heavy',         label: 'CTA-heavy',         hint: 'Always ends with a call to action' },
] as const
const VISION = [
  { v: 'customers',   label: 'More customers',   hint: 'Grow the customer base' },
  { v: 'recognition', label: 'Recognition',      hint: 'Become a known name' },
  { v: 'community',   label: 'Community',        hint: 'Build a loyal following' },
  { v: 'premium',     label: 'Premium position', hint: 'Own the premium tier' },
] as const
const GOAL = [
  { v: 'orders',    label: 'Drive orders / sales' },
  { v: 'awareness', label: 'Build awareness' },
  { v: 'launch',    label: 'Launch something new' },
  { v: 'community', label: 'Build community' },
  { v: 'trust',     label: 'Build trust / credibility' },
] as const
const PLATFORMS_LIST = ['Instagram', 'Snapchat', 'TikTok', 'Twitter'] as const
const COMFORT_ON_CAMERA = [
  { v: 'willing',        label: 'Willing',       hint: 'Happy to appear on camera' },
  { v: 'hesitant',       label: 'Hesitant',       hint: 'Prefer minimal camera presence' },
  { v: 'not_interested', label: 'Not interested', hint: 'Voice/text only content' },
] as const
const WAY_OF_SPEAKING = ['formal', 'casual', 'storytelling', 'direct'] as const
const REGIONS = ['Najdi', 'Hejazi', 'Eastern', 'Southern', 'Other'] as const
const PROBLEMS_LIST = [
  'Too generic', 'Low engagement', 'Wrong audience', 'Inconsistent look',
  'No clear message', 'Looks cheap', 'Too promotional', 'Not enough content',
] as const

// ── CurrentValues — full brand data passed from the profile page ──────────────

export interface CurrentValues {
  // Tab 1 — الهوية
  brand_name_en?: string | null
  sub_sector?: string | null
  region_primary?: string | null
  founded_year?: string | number | null
  social?: string | null
  platforms?: string[] | null
  city_primary?: string | null
  sector?: string | null
  // Tab 2 — الصوت
  arabic_dialect?: string | null
  bilingual_ratio?: string | null
  formality_level?: string | null
  humor_tolerance?: string | null
  religious_sensitivity?: string | null
  brand_differentiator?: string | null
  tone_register?: string | null
  primary_color_hex?: string | null
  tone_anti_attribute_ids?: string[] | null
  // Tab 3 — الشخصية
  archetype_family?: string | null
  archetype_primary?: string | null
  music?: string | null
  music_link?: string | null
  lifestyle?: string | null
  brand_refs?: string | null
  price_position?: string | null
  price_nums?: string | null
  scale_minmax?: number | null
  scale_quietloud?: number | null
  scale_localglobal?: number | null
  scale_tradmod?: number | null
  emotions?: string[] | null
  // Tab 4 — الجمهور
  primary_channel?: string | null
  primary_kpi_type?: string | null
  intent_state?: string | null
  audience_female_pct?: number | null
  audience_male_pct?: number | null
  ramadan_relevance?: string | null
  eid_fitr_relevance?: string | null
  eid_adha_relevance?: string | null
  national_day_relevance?: string | null
  founding_day_relevance?: string | null
  // Tab 5 — القصة
  founding_story?: string | null
  name_meaning?: string | null
  hero_why?: string | null
  owner_values?: string | null
  comfort_on_camera?: string | null
  way_of_speaking?: string | null
  communication_style?: string | null
  brand_goals?: string | null
  respected_brands?: string | null
  respected_why?: string | null
  posting_rhythm?: string | null
  caption_style?: string | null
  permission_level?: string | null
  cultural_tension_owned?: string | null
  goal_phase?: string | null
  brave_safe_default?: string | boolean | null
  vision?: string | null
  vision_text?: string | null
  // Tab 6 — المحتوى
  products_list?: string | null
  cust_desc?: string | null
  goal?: string | null
  tagline?: string | null
  cust_quote?: string | null
  caption_ex?: string | null
  metric?: string | null
  custom_restriction?: string | null
  custom_occasion?: string | null
  occasions_ranked?: string[] | null
  anything?: string | null
  // Also used in Tab 1
  problems?: string[] | null
}

// ── Pipeline Stepper ──────────────────────────────────────────────────────────

function PipelineStepper({
  currentStage,
  rejected,
  rejectionReason,
}: {
  currentStage: CorrectionStage | null
  rejected: boolean
  rejectionReason: string | null
}) {
  const activeIdx = currentStage ? STAGE_ORDER[currentStage] : -1

  return (
    <div className="flex flex-col gap-0">
      {PIPELINE_STEPS.map((step, idx) => {
        const isDone = activeIdx > idx || (step.stage === 'correction_applied' && activeIdx === 4 && !rejected)
        const isActive = activeIdx === idx && !rejected
        const isRejected = rejected && idx === activeIdx

        return (
          <div key={step.stage} className="flex items-stretch gap-3">
            <div className="flex flex-col items-center" style={{ width: 28 }}>
              <div
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all duration-500',
                  isDone
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : isRejected
                      ? 'border-red-500 bg-red-500 text-white'
                      : isActive
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400 animate-pulse'
                        : 'border-(--border-subtle) bg-(--surface-2) text-(--fg-faint)',
                ].join(' ')}
              >
                {isDone ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : isRejected ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              {idx < PIPELINE_STEPS.length - 1 && (
                <div
                  className={['w-px flex-1 my-0.5 transition-all duration-700', isDone ? 'bg-emerald-500' : 'bg-(--border-subtle)'].join(' ')}
                  style={{ minHeight: 16 }}
                />
              )}
            </div>
            <div className="pb-4 pt-0.5 min-w-0">
              <div
                className={[
                  'text-sm font-medium leading-none',
                  isDone ? 'text-emerald-400' : isRejected ? 'text-red-400' : isActive ? 'text-(--fg)' : 'text-(--fg-faint)',
                ].join(' ')}
              >
                {step.label}
                {isActive && (
                  <span className="ml-1.5 inline-flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="inline-block h-1 w-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </span>
                )}
              </div>
              <div className={['mt-0.5 text-xs', isActive ? 'text-(--fg-muted)' : 'text-(--fg-faint)'].join(' ')}>
                {isRejected && rejectionReason ? rejectionReason : step.sublabel}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStr(val: unknown): string {
  if (val == null) return ''
  if (Array.isArray(val)) return val.join(', ')
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (obj.min != null || obj.max != null) return `${obj.min ?? '?'} – ${obj.max ?? '?'}`
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ')
  }
  return String(val)
}

function toArr(val: unknown): string[] {
  if (val == null) return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

function toNum(val: unknown, fallback = 50): number {
  if (val == null) return fallback
  const n = Number(val)
  return isNaN(n) ? fallback : n
}

function SectionTitle({ children, dir = 'rtl' }: { children: React.ReactNode; dir?: 'rtl' | 'ltr' }) {
  return (
    <h3 className="border-b border-(--border-subtle) pb-2 text-xs font-semibold uppercase tracking-wider text-(--fg-muted)" dir={dir}>
      {children}
    </h3>
  )
}

function SliderRow({ label, labelEnd, value, onChange }: { label: string; labelEnd: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-right text-xs text-(--fg-muted)">{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} className="h-2 flex-1 cursor-pointer accent-(--accent)" />
      <span className="w-24 shrink-0 text-left text-xs text-(--fg-muted)">{labelEnd}</span>
    </div>
  )
}

// ── CorrectionPanel — tabbed batch edit panel ─────────────────────────────────

export function CorrectionPanel({
  brandId,
  currentValues,
  locale = 'ar',
}: {
  brandId: string
  currentValues: CurrentValues
  locale?: 'ar' | 'en'
}) {
  const isAr = locale === 'ar'
  const dir = isAr ? 'rtl' : 'ltr'
  const TABS = isAr ? TABS_AR : TABS_EN
  // L(ar, en) — picks the right label based on locale
  const L = (ar: string, en: string) => isAr ? ar : en
  const router = useRouter()
  const [, startT] = useTransition()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>(1)

  // ── Processing state ──────────────────────────────────────────────────────
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'submitting' | 'done'>('idle')
  const [doneOutcome, setDoneOutcome] = useState({ applied: 0, rejected: 0, timeout: 0 })
  const [pipelineStage, setPipelineStage] = useState<CorrectionStage | null>(null)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [submittedFields, setSubmittedFields] = useState<{ field: string; label: string; oldVal: string; newVal: string; status: FieldStatus }[]>([])
  const [error, setError] = useState<string | null>(null)

  const supabaseRef = useRef<ReturnType<typeof browserClient> | null>(null)
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = browserClient()
    return supabaseRef.current
  }
  const channelRef = useRef<RealtimeChannel | null>(null)
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingFieldsRef = useRef<Set<string>>(new Set())
  const processingRef = useRef<HTMLDivElement | null>(null)

  // ── Field state (one useState per field, initialised from currentValues) ──

  // Tab 1 — الهوية
  const [brandNameEn,   setBrandNameEn]   = useState(toStr(currentValues.brand_name_en))
  const [subSector,     setSubSector]     = useState(toStr(currentValues.sub_sector))
  const [regionPrimary, setRegionPrimary] = useState(toStr(currentValues.region_primary))
  const [foundedYear,   setFoundedYear]   = useState(toStr(currentValues.founded_year))
  const [social,        setSocial]        = useState(toStr(currentValues.social))
  const [platforms,     setPlatforms]     = useState<Set<string>>(new Set(toArr(currentValues.platforms)))
  const [cityPrimary,   setCityPrimary]   = useState(toStr(currentValues.city_primary))
  const [sector,        setSector]        = useState(toStr(currentValues.sector))

  // Tab 2 — الصوت
  const [dialect,       setDialect]       = useState(toStr(currentValues.arabic_dialect))
  const [bilingual,     setBilingual]     = useState(toStr(currentValues.bilingual_ratio))
  const [formality,     setFormality]     = useState(toStr(currentValues.formality_level))
  const [humor,         setHumor]         = useState(toStr(currentValues.humor_tolerance))
  const [religious,     setReligious]     = useState(toStr(currentValues.religious_sensitivity))
  const [differentiator,setDifferentiator]= useState(toStr(currentValues.brand_differentiator))
  const [toneRegister,  setToneRegister]  = useState(toStr(currentValues.tone_register))
  const [primaryColor,  setPrimaryColor]  = useState(toStr(currentValues.primary_color_hex) || '#10b981')
  const [antiAttrs,     setAntiAttrs]     = useState<Set<string>>(new Set(toArr(currentValues.tone_anti_attribute_ids)))

  // Tab 3 — الشخصية
  const [archetypeFamily,  setArchetypeFamily]  = useState(toStr(currentValues.archetype_family))
  const [archetypePrimary, setArchetypePrimary] = useState(toStr(currentValues.archetype_primary))
  const [music,            setMusic]            = useState(toStr(currentValues.music))
  const [musicLink,        setMusicLink]        = useState(toStr(currentValues.music_link))
  const [lifestyle,        setLifestyle]        = useState(toStr(currentValues.lifestyle))
  const [brandRefs,        setBrandRefs]        = useState(toStr(currentValues.brand_refs))
  const [pricePosition,    setPricePosition]    = useState(toStr(currentValues.price_position))
  const [priceNums,        setPriceNums]        = useState(toStr(currentValues.price_nums))
  const _priceParts = (currentValues.price_nums ?? '').replace(/SAR/gi, '').split(/[-–]/).map((s) => s.trim())
  const [priceMin, setPriceMin] = useState(_priceParts[0] ?? '')
  const [priceMax, setPriceMax] = useState(_priceParts[1] ?? '')
  const [scaleMinmax,      setScaleMinmax]      = useState(toNum(currentValues.scale_minmax))
  const [scaleQuietloud,   setScaleQuietloud]   = useState(toNum(currentValues.scale_quietloud))
  const [scaleLocalglobal, setScaleLocalglobal] = useState(toNum(currentValues.scale_localglobal))
  const [scaleTradmod,     setScaleTradmod]     = useState(toNum(currentValues.scale_tradmod))
  const [emotions,         setEmotions]         = useState<Set<string>>(new Set(toArr(currentValues.emotions)))

  // Tab 4 — الجمهور
  const [primaryChannel,  setPrimaryChannel]  = useState(toStr(currentValues.primary_channel))
  const [primaryKpi,      setPrimaryKpi]      = useState(toStr(currentValues.primary_kpi_type))
  const [intent,          setIntent]          = useState(toStr(currentValues.intent_state))
  const [audienceFemale,  setAudienceFemale]  = useState(toNum(currentValues.audience_female_pct, 50))
  const [audienceMale,    setAudienceMale]    = useState(toNum(currentValues.audience_male_pct, 50))
  const [ramadan,         setRamadan]         = useState(toStr(currentValues.ramadan_relevance) || 'Medium')
  const [eidFitr,         setEidFitr]         = useState(toStr(currentValues.eid_fitr_relevance) || 'Medium')
  const [eidAdha,         setEidAdha]         = useState(toStr(currentValues.eid_adha_relevance) || 'Medium')
  const [nationalDay,     setNationalDay]     = useState(toStr(currentValues.national_day_relevance) || 'Medium')
  const [foundingDay,     setFoundingDay]     = useState(toStr(currentValues.founding_day_relevance) || 'Medium')

  // Tab 5 — القصة
  const [foundingStory,     setFoundingStory]     = useState(toStr(currentValues.founding_story))
  const [nameMeaning,       setNameMeaning]       = useState(toStr(currentValues.name_meaning))
  const [heroWhy,           setHeroWhy]           = useState(toStr(currentValues.hero_why))
  const [ownerValues,       setOwnerValues]       = useState(toStr(currentValues.owner_values))
  const [comfortOnCamera,   setComfortOnCamera]   = useState(toStr(currentValues.comfort_on_camera))
  const [wayOfSpeaking,     setWayOfSpeaking]     = useState(toStr(currentValues.way_of_speaking))
  const [communicationStyle,setCommunicationStyle]= useState(toStr(currentValues.communication_style))
  const [brandGoals,        setBrandGoals]        = useState(toStr(currentValues.brand_goals))
  const [respectBrands,     setRespectBrands]     = useState(toStr(currentValues.respected_brands))
  const [respectWhy,        setRespectWhy]        = useState(toStr(currentValues.respected_why))
  const [postingRhythm,     setPostingRhythm]     = useState(toStr(currentValues.posting_rhythm))
  const [captionStyle,      setCaptionStyle]      = useState(toStr(currentValues.caption_style))
  const [permissionLevel,   setPermissionLevel]   = useState(toStr(currentValues.permission_level))
  const [culturalTension,   setCulturalTension]   = useState(toStr(currentValues.cultural_tension_owned))
  const [goalPhase,         setGoalPhase]         = useState(toStr(currentValues.goal_phase))
  const [braveSafe,         setBraveSafe]         = useState(() => {
    const v = currentValues.brave_safe_default
    if (v === true || v === 'true') return true
    return false
  })
  const [vision,            setVision]            = useState(toStr(currentValues.vision))
  const [visionText,        setVisionText]        = useState(toStr(currentValues.vision_text))

  // Tab 6 — المحتوى
  const [productsList,      setProductsList]      = useState(toStr(currentValues.products_list))
  const [custDesc,          setCustDesc]          = useState(toStr(currentValues.cust_desc))
  const [goal,              setGoal]              = useState(toStr(currentValues.goal))
  const [tagline,           setTagline]           = useState(toStr(currentValues.tagline))
  const [custQuote,         setCustQuote]         = useState(toStr(currentValues.cust_quote))
  const [captionEx,         setCaptionEx]         = useState(toStr(currentValues.caption_ex))
  const [metric,            setMetric]            = useState(toStr(currentValues.metric))
  const [customRestriction, setCustomRestriction] = useState(toStr(currentValues.custom_restriction))
  const [customOccasion,    setCustomOccasion]    = useState(toStr(currentValues.custom_occasion))
  const [occasionsRanked,   setOccasionsRanked]   = useState<string[]>(toArr(currentValues.occasions_ranked))
  const [anything,          setAnything]          = useState(toStr(currentValues.anything))
  const [restrictions,      setRestrictions]      = useState<Set<string>>(new Set<string>())
  const [problems,          setProblems]          = useState<Set<string>>(new Set(toArr(currentValues.problems)))

  // ── Re-sync local state when currentValues prop changes (e.g. after an
  //    inline correction triggers router.refresh()) but only when panel is closed
  //    so we never overwrite in-progress edits.
  useEffect(() => {
    if (open) return
    setBrandNameEn(toStr(currentValues.brand_name_en))
    setSubSector(toStr(currentValues.sub_sector))
    setRegionPrimary(toStr(currentValues.region_primary))
    setFoundedYear(toStr(currentValues.founded_year))
    setSocial(toStr(currentValues.social))
    setPlatforms(new Set(toArr(currentValues.platforms)))
    setCityPrimary(toStr(currentValues.city_primary))
    setSector(toStr(currentValues.sector))
    setDialect(toStr(currentValues.arabic_dialect))
    setBilingual(toStr(currentValues.bilingual_ratio))
    setFormality(toStr(currentValues.formality_level))
    setHumor(toStr(currentValues.humor_tolerance))
    setReligious(toStr(currentValues.religious_sensitivity))
    setDifferentiator(toStr(currentValues.brand_differentiator))
    setToneRegister(toStr(currentValues.tone_register))
    setPrimaryColor(toStr(currentValues.primary_color_hex) || '#10b981')
    setAntiAttrs(new Set(toArr(currentValues.tone_anti_attribute_ids)))
    setArchetypeFamily(toStr(currentValues.archetype_family))
    setArchetypePrimary(toStr(currentValues.archetype_primary))
    setMusic(toStr(currentValues.music))
    setMusicLink(toStr(currentValues.music_link))
    setLifestyle(toStr(currentValues.lifestyle))
    setBrandRefs(toStr(currentValues.brand_refs))
    setPricePosition(toStr(currentValues.price_position))
    const pn = toStr(currentValues.price_nums)
    setPriceNums(pn)
    const pp = pn.replace(/SAR/gi, '').split(/[-–]/).map((s) => s.trim())
    setPriceMin(pp[0] ?? '')
    setPriceMax(pp[1] ?? '')
    setScaleMinmax(toNum(currentValues.scale_minmax))
    setScaleQuietloud(toNum(currentValues.scale_quietloud))
    setScaleLocalglobal(toNum(currentValues.scale_localglobal))
    setScaleTradmod(toNum(currentValues.scale_tradmod))
    setEmotions(new Set(toArr(currentValues.emotions)))
    setPrimaryChannel(toStr(currentValues.primary_channel))
    setPrimaryKpi(toStr(currentValues.primary_kpi_type))
    setIntent(toStr(currentValues.intent_state))
    setAudienceFemale(toNum(currentValues.audience_female_pct, 50))
    setAudienceMale(toNum(currentValues.audience_male_pct, 50))
    setRamadan(toStr(currentValues.ramadan_relevance) || 'Medium')
    setEidFitr(toStr(currentValues.eid_fitr_relevance) || 'Medium')
    setEidAdha(toStr(currentValues.eid_adha_relevance) || 'Medium')
    setNationalDay(toStr(currentValues.national_day_relevance) || 'Medium')
    setFoundingDay(toStr(currentValues.founding_day_relevance) || 'Medium')
    setFoundingStory(toStr(currentValues.founding_story))
    setNameMeaning(toStr(currentValues.name_meaning))
    setHeroWhy(toStr(currentValues.hero_why))
    setOwnerValues(toStr(currentValues.owner_values))
    setComfortOnCamera(toStr(currentValues.comfort_on_camera))
    setWayOfSpeaking(toStr(currentValues.way_of_speaking))
    setCommunicationStyle(toStr(currentValues.communication_style))
    setBrandGoals(toStr(currentValues.brand_goals))
    setRespectBrands(toStr(currentValues.respected_brands))
    setRespectWhy(toStr(currentValues.respected_why))
    setPostingRhythm(toStr(currentValues.posting_rhythm))
    setCaptionStyle(toStr(currentValues.caption_style))
    setPermissionLevel(toStr(currentValues.permission_level))
    setCulturalTension(toStr(currentValues.cultural_tension_owned))
    setGoalPhase(toStr(currentValues.goal_phase))
    const bv = currentValues.brave_safe_default
    setBraveSafe(bv === true || bv === 'true')
    setVision(toStr(currentValues.vision))
    setVisionText(toStr(currentValues.vision_text))
    setProductsList(toStr(currentValues.products_list))
    setCustDesc(toStr(currentValues.cust_desc))
    setGoal(toStr(currentValues.goal))
    setTagline(toStr(currentValues.tagline))
    setCustQuote(toStr(currentValues.cust_quote))
    setCaptionEx(toStr(currentValues.caption_ex))
    setMetric(toStr(currentValues.metric))
    setCustomRestriction(toStr(currentValues.custom_restriction))
    setCustomOccasion(toStr(currentValues.custom_occasion))
    setOccasionsRanked(toArr(currentValues.occasions_ranked))
    setAnything(toStr(currentValues.anything))
    setProblems(new Set(toArr(currentValues.problems)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValues, open])

  // ── Toggles ───────────────────────────────────────────────────────────────

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  function toggleEmotion(key: string) {
    setEmotions((prev) => {
      const n = new Set(prev)
      if (n.has(key)) { n.delete(key); return n }
      if (n.size >= 3) return prev
      n.add(key); return n
    })
  }

  function toggleOccasionRank(occ: string) {
    setOccasionsRanked((prev) => {
      if (prev.includes(occ)) return prev.filter((o) => o !== occ)
      if (prev.length >= 3) return prev
      return [...prev, occ]
    })
  }

  // ── Collect all changed fields for submission ─────────────────────────────

  type FieldEntry = { field_name: string; label: string; current_value: string | null; corrected_value: string }

  function collectChangedFields(): FieldEntry[] {
    const orig = currentValues
    const changed: FieldEntry[] = []

    function check(field_name: string, label: string, newVal: string, origVal: string | null | undefined) {
      const origStr = toStr(origVal)
      const newTrim = newVal.trim()
      if (newTrim !== '' && newTrim !== origStr) {
        changed.push({ field_name, label, current_value: origStr || null, corrected_value: newTrim })
      }
    }

    function checkArr(field_name: string, label: string, newSet: Set<string> | string[], origVal: unknown) {
      const newArr = Array.isArray(newSet) ? newSet : [...newSet]
      const origArr = toArr(origVal)
      const newStr = newArr.sort().join(',')
      const origStr = origArr.sort().join(',')
      if (newStr !== origStr && newArr.length > 0) {
        changed.push({ field_name, label, current_value: origStr || null, corrected_value: newArr.join(', ') })
      }
    }

    function checkNum(field_name: string, label: string, newVal: number, origVal: unknown) {
      const origNum = toNum(origVal, -1)
      if (origNum !== newVal) {
        changed.push({ field_name, label, current_value: origNum >= 0 ? String(origNum) : null, corrected_value: String(newVal) })
      }
    }

    // Tab 1
    check('brand_name_en',   'Brand Name (EN)',  brandNameEn,   orig.brand_name_en)
    check('sub_sector',      'Sub-sector',       subSector,     orig.sub_sector)
    check('region_primary',  'Region',           regionPrimary, orig.region_primary)
    check('founded_year',    'Founded Year',     foundedYear,   orig.founded_year != null ? String(orig.founded_year) : null)
    check('social',          'Social Handles',   social,        orig.social)
    check('city_primary',    'City',             cityPrimary,   orig.city_primary)
    checkArr('platforms', 'Platforms', platforms, orig.platforms)

    // Tab 2
    check('arabic_dialect',        'Arabic Dialect',        dialect,        orig.arabic_dialect)
    check('bilingual_ratio',       'Bilingual Ratio',       bilingual,      orig.bilingual_ratio)
    check('formality_level',       'Formality Level',       formality,      orig.formality_level)
    check('humor_tolerance',       'Humor Tolerance',       humor,          orig.humor_tolerance)
    check('religious_sensitivity', 'Religious Sensitivity', religious,      orig.religious_sensitivity)
    check('brand_differentiator',  'Brand Differentiator',  differentiator, orig.brand_differentiator)
    check('tone_register',         'Tone Register',         toneRegister,   orig.tone_register)
    check('primary_color_hex',     'Brand Color',           primaryColor,   orig.primary_color_hex)
    checkArr('tone_anti_attribute_ids', 'Tone Anti-attributes', antiAttrs, orig.tone_anti_attribute_ids)

    // Tab 3
    check('archetype_family',  'Archetype Family',   archetypeFamily,  orig.archetype_family)
    check('archetype_primary', 'Archetype Primary',  archetypePrimary, orig.archetype_primary)
    check('music',             'Music Mood',         music,            orig.music)
    check('music_link',        'Music Link',         musicLink,        orig.music_link)
    check('lifestyle',         'Customer Lifestyle', lifestyle,        orig.lifestyle)
    check('brand_refs',        'Brand References',   brandRefs,        orig.brand_refs)
    check('price_position',    'Price Position',     pricePosition,    orig.price_position)
    check('price_nums',        'Price Range',        priceNums,        orig.price_nums)
    checkArr('emotions', 'Brand Emotions', emotions, orig.emotions)
    checkNum('scale_minmax',      'Scale Minimal→Maximal',    scaleMinmax,      orig.scale_minmax)
    checkNum('scale_quietloud',   'Scale Quiet→Loud',         scaleQuietloud,   orig.scale_quietloud)
    checkNum('scale_localglobal', 'Scale Local→Global',       scaleLocalglobal, orig.scale_localglobal)
    checkNum('scale_tradmod',     'Scale Traditional→Modern', scaleTradmod,     orig.scale_tradmod)

    // Tab 4
    check('primary_channel',       'Primary Channel',   primaryChannel, orig.primary_channel)
    check('primary_kpi_type',      'Primary KPI',       primaryKpi,     orig.primary_kpi_type)
    check('intent_state',          'Intent State',      intent,         orig.intent_state)
    check('ramadan_relevance',     'Ramadan',           ramadan,        orig.ramadan_relevance)
    check('eid_fitr_relevance',    'Eid Al-Fitr',       eidFitr,        orig.eid_fitr_relevance)
    check('eid_adha_relevance',    'Eid Al-Adha',       eidAdha,        orig.eid_adha_relevance)
    check('national_day_relevance','National Day',      nationalDay,    orig.national_day_relevance)
    check('founding_day_relevance','Founding Day',      foundingDay,    orig.founding_day_relevance)
    // audience_female_pct / audience_male_pct are UI-only analytics fields —
    // not correctable BrandDNA columns, so excluded from batch submission.

    // Tab 5
    check('founding_story',      'Founding Story',     foundingStory,     orig.founding_story)
    check('name_meaning',        'Name Meaning',       nameMeaning,       orig.name_meaning)
    check('hero_why',            'Hero Product — Why', heroWhy,           orig.hero_why)
    check('owner_values',        'Owner Values',       ownerValues,       orig.owner_values)
    check('comfort_on_camera',   'Comfort on Camera',  comfortOnCamera,   orig.comfort_on_camera)
    check('way_of_speaking',     'Way of Speaking',    wayOfSpeaking,     orig.way_of_speaking)
    check('communication_style', 'Communication Style',communicationStyle,orig.communication_style)
    check('brand_goals',         'Business Goals',     brandGoals,        orig.brand_goals)
    check('respected_brands',    'Admired Brands',     respectBrands,     orig.respected_brands)
    check('respected_why',       'Why Admired',        respectWhy,        orig.respected_why)
    check('posting_rhythm',      'Posting Rhythm',     postingRhythm,     orig.posting_rhythm)
    check('caption_style',       'Caption Style',      captionStyle,      orig.caption_style)
    check('permission_level',    'Permission Level',   permissionLevel,   orig.permission_level)
    check('cultural_tension_owned','Cultural Tension', culturalTension,   orig.cultural_tension_owned)
    check('goal_phase',          'Goal Phase',         goalPhase,         orig.goal_phase)
    check('vision',              '12-Month Vision',    vision,            orig.vision)
    check('vision_text',         'Vision (Own Words)', visionText,        orig.vision_text)
    {
      const newBrave = String(braveSafe)
      const origBrave = toStr(currentValues.brave_safe_default)
      if (newBrave !== origBrave) {
        changed.push({ field_name: 'brave_safe_default', label: 'Content Stance', current_value: origBrave || null, corrected_value: newBrave })
      }
    }

    // Tab 6
    check('products_list',      'Products & Services', productsList,      orig.products_list)
    check('cust_desc',          'Ideal Customer',      custDesc,          orig.cust_desc)
    check('goal',               'Content Goal',       goal,              orig.goal)
    check('tagline',            'Tagline',            tagline,           orig.tagline)
    check('cust_quote',         'Customer Quote',     custQuote,         orig.cust_quote)
    check('caption_ex',         'Caption Example',    captionEx,         orig.caption_ex)
    check('metric',             'Success Metric',     metric,            orig.metric)
    check('custom_restriction', 'Custom Restriction', customRestriction, orig.custom_restriction)
    check('custom_occasion',    'Custom Occasion',    customOccasion,    orig.custom_occasion)
    check('anything',           'Anything Else',      anything,          orig.anything)
    checkArr('occasions_ranked', 'Occasions Ranked', occasionsRanked, orig.occasions_ranked)
    if (problems.size > 0) checkArr('problems', 'Content Problems', problems, orig.problems)

    return changed
  }

  // ── Realtime watch ────────────────────────────────────────────────────────

  function setFieldProgress(field: string, st: FieldStatus) {
    setSubmittedFields((prev) => prev.map((f) => f.field === field ? { ...f, status: st } : f))
  }

  async function startRealtimeWatch(pendingFields: string[], onReady?: () => void) {
    const supabase = getSupabase()
    const remaining = new Set(pendingFields)
    const fieldStatuses = new Map<string, FieldStatus>()
    for (const f of pendingFields) fieldStatuses.set(f, 'waiting')

    function settle(field: string, status: FieldStatus, reason?: string) {
      if (!remaining.has(field)) return
      remaining.delete(field)
      const t = timeoutsRef.current.get(field)
      if (t) { clearTimeout(t); timeoutsRef.current.delete(field) }
      fieldStatuses.set(field, status)
      // Update the per-field card immediately
      setFieldProgress(field, status)
      if (status === 'rejected' && reason) setRejectionReason(humaniseRejection(reason))

      // Check if all settled
      if (remaining.size === 0) {
        const applied = [...fieldStatuses.values()].filter((s) => s === 'written').length
        const rejected = [...fieldStatuses.values()].filter((s) => s === 'rejected').length
        const timeout  = [...fieldStatuses.values()].filter((s) => s === 'timeout').length
        setDoneOutcome({ applied, rejected, timeout })
        setGlobalStatus('done')
        setTimeout(() => router.refresh(), 1500)
      }
    }

    function processEvent(eventType: string, eventData: Record<string, unknown> | undefined) {
      if (eventType?.startsWith('correction_progress_')) {
        const stage = (eventData?.stage ?? eventType.replace('correction_progress_', '')) as CorrectionStage
        const batchFields = Array.isArray(eventData?.fields) ? eventData.fields as string[] : null
        const fieldName = String(eventData?.field_name ?? '')
        const targets = batchFields
          ? [...remaining].filter((f) => batchFields.includes(f))
          : fieldName
            ? [...remaining].filter((f) => f === fieldName)
            : [...remaining]

        setPipelineStage(stage)
        if (stage === 'correction_applied') { for (const f of targets) settle(f, 'written'); return }
        if (stage === 'correction_rejected') {
          const raw = String(eventData?.rejection_reason ?? (eventData?.metadata as Record<string, unknown>)?.rejection_reason ?? '')
          for (const f of targets) settle(f, 'rejected', raw)
          return
        }
      }
      const appliedTo = String(eventData?.applied_to ?? eventData?.field_name ?? '')
      const col = appliedTo.includes('.') ? appliedTo.split('.').pop()! : appliedTo
      const match = [...remaining].find((f) => col === f || appliedTo === f)
      if (match && (eventType === 'client_confirmed' || eventType === 'confidence_upgraded')) settle(match, 'written')
    }

    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData.session?.access_token) supabase.realtime.setAuth(sessionData.session.access_token)

    const channel = supabase
      .channel(`correction_${brandId}_${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'branddna_event_log', filter: `brand_id=eq.${brandId}` }, (payload) => {
        processEvent(payload.new?.event_type as string, payload.new?.event_data as Record<string, unknown> | undefined)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'memory_controller_queue', filter: `brand_id=eq.${brandId}` }, (payload) => {
        if (payload.new?.status !== 'rejected') return
        const nomData = payload.new?.nomination_data as Record<string, unknown> | undefined
        const fp = String(nomData?.field_path ?? '')
        const col = fp.includes('.') ? fp.split('.').pop()! : fp
        const match = [...remaining].find((f) => col === f || fp === f)
        if (match) settle(match, 'rejected', String(payload.new?.rejection_reason ?? ''))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { onReady?.() }
        else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          onReady?.()
          for (const f of [...remaining]) settle(f, 'timeout')
        }
      })

    channelRef.current = channel

    for (const field of pendingFields) {
      const t = setTimeout(() => {
        if (!remaining.has(field)) return
        settle(field, 'timeout')
      }, 90_000)
      timeoutsRef.current.set(field, t)
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const changed = collectChangedFields()
    if (changed.length === 0) { setError('لم تتغير أي حقول — عدّل قيمة واحدة على الأقل ثم أعد المحاولة'); return }
    if (changed.length > 15) { setError('الحد الأقصى 15 حقلاً في كل دفعة. الرجاء تقليل عدد التعديلات'); return }

    const snapshot = changed.map((c) => ({ field: c.field_name, label: c.label, oldVal: c.current_value ?? '—', newVal: c.corrected_value, status: 'waiting' as FieldStatus }))
    setSubmittedFields(snapshot)
    setGlobalStatus('submitting')
    setTimeout(() => { processingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 50)

    startT(async () => {
      pendingFieldsRef.current = new Set(changed.map((c) => c.field_name))

      const batchFields = changed.map((c) => ({
        field_name: c.field_name,
        current_value: c.current_value,
        corrected_value: c.corrected_value,
        reasoning: 'User edit',
      }))

      // Advance pipeline UI through the stages as the server processes
      setPipelineStage('correction_received')
      const result = await submitBrandCorrectionBatch(brandId, batchFields)

      if (!result.ok) {
        setError(result.error ?? 'Submission failed')
        pendingFieldsRef.current = new Set()
        setGlobalStatus('done')
        setDoneOutcome({ applied: 0, rejected: changed.length, timeout: 0 })
        return
      }

      // Server returned per-field results — no need to wait for Realtime events.
      // Advance the pipeline stepper to show accurate final state.
      setPipelineStage('ceo_approved')
      setPipelineStage('memory_writing')
      setPipelineStage('correction_applied')

      const fieldResultMap = new Map(
        (result.field_results ?? []).map((r) => [r.field_name, r])
      )

      // Settle each field card based on actual MC result
      const finalStatuses = changed.map((c) => {
        const fr = fieldResultMap.get(c.field_name)
        const status: FieldStatus = fr?.status === 'written' ? 'written'
          : fr?.status === 'rejected' ? 'rejected'
          : 'written' // default to written if not in results (skipped duplicate)
        return { ...c, status }
      })

      setSubmittedFields(finalStatuses.map((c) => ({
        field: c.field_name, label: c.label,
        oldVal: c.current_value ?? '—', newVal: c.corrected_value,
        status: finalStatuses.find((f) => f.field_name === c.field_name)?.status ?? 'written',
      })))

      const applied  = finalStatuses.filter((f) => f.status === 'written').length
      const rejected = finalStatuses.filter((f) => f.status === 'rejected').length

      if (rejected > 0) {
        const firstRejected = result.field_results?.find((r) => r.status === 'rejected')
        setRejectionReason(humaniseRejection(firstRejected?.rejection_reason ?? null))
      }

      setDoneOutcome({ applied, rejected, timeout: 0 })
      setGlobalStatus('done')
      pendingFieldsRef.current = new Set()
      setTimeout(() => router.refresh(), 800)
    })
  }

  function handleOpen() {
    setGlobalStatus('idle')
    setDoneOutcome({ applied: 0, rejected: 0, timeout: 0 })
    setPipelineStage(null)
    setRejectionReason(null)
    setSubmittedFields([])
    setError(null)
    setActiveTab(1)
    setOpen(true)
  }

  function handleClose() {
    setOpen(false)
    if (channelRef.current) { getSupabase().removeChannel(channelRef.current); channelRef.current = null }
    timeoutsRef.current.forEach((t) => clearTimeout(t))
    timeoutsRef.current.clear()
  }

  useEffect(() => {
    return () => {
      if (channelRef.current) getSupabase().removeChannel(channelRef.current)
      timeoutsRef.current.forEach((t) => clearTimeout(t))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isProcessing = globalStatus === 'submitting'
  const isDone       = globalStatus === 'done'
  const isAllApplied = isDone && doneOutcome.rejected === 0 && doneOutcome.timeout === 0 && doneOutcome.applied > 0
  const isRejected   = isDone && doneOutcome.applied === 0 && doneOutcome.rejected > 0
  const isMixed      = isDone && doneOutcome.applied > 0 && doneOutcome.rejected > 0

  // ── Always render the trigger button; modal mounts on top ─────────────────
  const modalContent = (() => {
  if (!open) return null

  // ── Processing / Done overlay ─────────────────────────────────────────────
  if (isProcessing || isDone) {
    return (
      <div ref={processingRef} className="flex h-full w-full flex-col rounded-(--r-lg) border border-(--border-default) bg-(--surface-1) shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-(--border-subtle) px-5 py-3.5" dir={dir}>
          <div>
            <div className="font-semibold text-(--fg)">
              {isDone
                ? isAllApplied
                  ? (isAr ? 'تم تحديث BrandDNA' : 'BrandDNA Updated')
                  : isRejected
                    ? (isAr ? 'تم رفض التصحيح' : 'Correction Rejected')
                    : (isAr ? 'تم التطبيق جزئياً' : 'Partially Applied')
                : (isAr ? 'جارٍ تطبيق التصحيحات…' : 'Applying corrections…')}
            </div>
            <div className="text-xs text-(--fg-muted)">
              {isDone
                ? `${submittedFields.length} ${isAr ? 'حقل تم إرساله' : 'fields submitted'}`
                : (isAr ? 'المعالجة عبر سلسلة تدقيق الذكاء الاصطناعي' : 'Processing via AI review pipeline')}
            </div>
          </div>
          {isDone && (
            <button onClick={handleClose} className="rounded-(--r-sm) px-2 py-1 text-xs text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)">
              {isAr ? '✕ إغلاق' : '✕ Close'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] divide-y md:divide-y-0 md:divide-x divide-(--border-subtle)">
          <div className="px-6 py-7">
            <div className="mb-4 text-xs font-semibold uppercase tracking-wider text-(--fg-muted)">Pipeline status</div>
            <PipelineStepper currentStage={pipelineStage} rejected={isRejected || (isDone && doneOutcome.rejected > 0 && pipelineStage === 'correction_rejected')} rejectionReason={rejectionReason} />
          </div>
          <div className="px-6 py-7">
            <div className="mb-4 text-xs font-semibold uppercase tracking-wider text-(--fg-muted)">
              {isAr
                ? `${submittedFields.length} ${submittedFields.length !== 1 ? 'حقول' : 'حقل'} يتم تحديثها`
                : `${submittedFields.length} field${submittedFields.length !== 1 ? 's' : ''} updating`}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {submittedFields.map(({ field, label, oldVal, newVal, status: st }) => {
                const isApplied  = st === 'written'
                const isRejField = st === 'rejected'
                const isTimeout  = st === 'timeout'
                const isPending  = st === 'waiting' || st === 'submitting'
                const borderCls  = isApplied ? 'border-emerald-500/40' : isRejField ? 'border-red-500/40' : isTimeout ? 'border-amber-500/40' : 'border-(--border-subtle)'
                return (
                  <div key={field} className={`rounded-(--r-md) border px-3.5 py-3 bg-(--surface-2) transition-colors ${borderCls}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-(--fg) leading-snug">{label}</span>
                      <span className="shrink-0 text-xs font-medium">
                        {isApplied && (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                            {isAr ? 'مطبق' : 'Applied'}
                          </span>
                        )}
                        {isRejField && (
                          <span className="inline-flex items-center gap-1 text-red-400">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            {isAr ? 'مرفوض' : 'Rejected'}
                          </span>
                        )}
                        {isTimeout && (
                          <span className="inline-flex items-center gap-1 text-amber-400">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" /></svg>
                            {isAr ? 'انتهى الوقت' : 'Timeout'}
                          </span>
                        )}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 text-(--fg-muted)">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-(--accent) animate-pulse" />
                            {isAr ? 'معالجة' : 'Processing'}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs min-w-0">
                      <span className="font-mono text-(--fg-faint) line-through truncate">{oldVal}</span>
                      <svg className="w-3 h-3 shrink-0 text-(--fg-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                      <span className={`font-mono truncate font-medium ${isApplied ? 'text-emerald-400' : isRejField ? 'text-red-400 line-through' : 'text-(--fg)'}`}>{newVal}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {isDone && (
          <div className="border-t border-(--border-subtle) bg-(--surface-2) px-5 py-3.5 flex items-center justify-between" dir={dir}>
            <div className="text-sm">
              {isAllApplied && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {isAr ? `تم تطبيق ${doneOutcome.applied} تصحيح — سيتم تحديث الملف الشخصي` : `${doneOutcome.applied} correction(s) applied — profile will update`}
                </span>
              )}
              {isRejected && <span className="inline-flex items-center gap-1.5 text-red-400 font-medium">{isAr ? 'تم رفض التصحيح — راجع السبب أعلاه' : 'Correction rejected — see reason above'}</span>}
              {isMixed && <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">{isAr ? `${doneOutcome.applied} مطبق، ${doneOutcome.rejected} مرفوض` : `${doneOutcome.applied} applied, ${doneOutcome.rejected} rejected`}</span>}
              {!isAllApplied && !isRejected && !isMixed && doneOutcome.timeout > 0 && (
                <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">{isAr ? 'تم الحفظ — سيتم تحديث BrandDNA قريباً' : 'Saved — BrandDNA will update shortly'}</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleOpen}>{isAr ? 'تعديل مرة أخرى' : 'Edit again'}</Button>
              <Button size="sm" onClick={handleClose}>{isAr ? 'تم' : 'Done'}</Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Edit form ─────────────────────────────────────────────────────────────
  const changedCount = collectChangedFields().length

  return (
    <div className="flex h-full w-full flex-col rounded-(--r-lg) border border-(--border-default) bg-(--surface-1) shadow-sm" dir={dir}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-(--border-subtle) px-5 py-3.5">
        <div>
          <div className="font-semibold text-(--fg)">{isAr ? 'تعديل BrandDNA' : 'Edit BrandDNA'}</div>
          <div className="text-xs text-(--fg-muted)">{isAr ? 'التعديلات تمر عبر CEO ← Memory Controller' : 'Changes route through CEO → Memory Controller'}</div>
        </div>
        <button onClick={handleClose} className="rounded-(--r-sm) px-2 py-1 text-xs text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)">
          {isAr ? '✕ إغلاق' : '✕ Close'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="shrink-0 bg-(--surface-1) border-b border-(--border-subtle) px-4 py-2 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ' +
                (activeTab === tab.id
                  ? 'bg-(--accent) text-(--accent-fg)'
                  : 'bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)')
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* ── TAB 1: Identity ── */}
          {activeTab === 1 && (
            <>
              <SectionTitle dir={dir}>{L('الهوية والموقع', 'Identity & Location')}</SectionTitle>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={L('اسم العلامة التجارية (إنجليزي)', 'Brand Name (English)')}>
                  <Input dir="ltr" value={brandNameEn} onChange={(e) => setBrandNameEn(e.currentTarget.value)} />
                </Field>
                <Field label={L('القطاع الفرعي', 'Sub-sector')} hint={L('مثال: مطعم راقٍ، كافيه', 'e.g. Fine dining, café')}>
                  <Input dir="auto" maxLength={80} value={subSector} onChange={(e) => setSubSector(e.currentTarget.value)} />
                </Field>
                <Field label={L('المنطقة', 'Region')}>
                  <Select value={regionPrimary} onChange={(e) => setRegionPrimary(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Field>
                <Field label={L('سنة التأسيس', 'Founded Year')}>
                  <Input type="number" dir="ltr" min={1900} max={new Date().getFullYear()} placeholder="2018" value={foundedYear} onChange={(e) => setFoundedYear(e.currentTarget.value)} />
                </Field>
                <Field label={L('المدينة الرئيسية', 'Primary City')}>
                  <Select value={cityPrimary} onChange={(e) => setCityPrimary(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {SAUDI_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label={L('المنصات النشطة', 'Active Platforms')}>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS_LIST.map((p) => {
                    const active = platforms.has(p)
                    return (
                      <button key={p} type="button" onClick={() => toggleSet(setPlatforms, p)} aria-pressed={active}
                        className={'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' + (active ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                        {p}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={L('جميع الحسابات الاجتماعية', 'Social Handles')} hint={L('مثال: @brand على IG، @brand على Snap', 'e.g. @brand (IG), @brand (Snap)')}>
                <Input dir="ltr" maxLength={300} placeholder="@myBrand (IG), @myBrand (Snap)" value={social} onChange={(e) => setSocial(e.currentTarget.value)} />
              </Field>
            </>
          )}

          {/* ── TAB 2: Voice ── */}
          {activeTab === 2 && (
            <>
              <SectionTitle dir={dir}>{L('الصوت واللغة', 'Voice & Language')}</SectionTitle>

              <div className="rounded-(--r-md) border border-(--accent)/40 bg-(--accent-soft)/30 p-4">
                <Field label={L('اللهجة العربية', 'Arabic Dialect')} hint={L('الأهم — يؤثر على نبرة كل المخرجات', 'Most important — affects tone of all outputs')}>
                  <Select value={dialect} onChange={(e) => setDialect(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={L('نسبة ثنائية اللغة', 'Bilingual Ratio')}>
                  <Select value={bilingual} onChange={(e) => setBilingual(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {BILINGUAL.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </Field>
                <Field label={L('مستوى الرسمية', 'Formality Level')}>
                  <Select value={formality} onChange={(e) => setFormality(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {FORMALITY.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </Field>
                <Field label={L('تحمل الفكاهة', 'Humor Tolerance')}>
                  <Select value={humor} onChange={(e) => setHumor(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {HUMOR.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </Field>
                <Field label={L('الحساسية الدينية', 'Religious Sensitivity')}>
                  <Select value={religious} onChange={(e) => setReligious(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {RELIGIOUS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </Field>
                <Field label={L('سجل النبرة', 'Tone Register')}>
                  <Select value={toneRegister} onChange={(e) => setToneRegister(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {TONE_REGISTER.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label={L('مميز العلامة التجارية', 'Brand Differentiator')} hint={L('جملة واحدة — ما الذي يجعل هذه العلامة فريدة', 'One sentence — what makes this brand unique')}>
                <Textarea dir="auto" rows={3} maxLength={500} value={differentiator} onChange={(e) => setDifferentiator(e.currentTarget.value)} />
              </Field>

              <Field label={L('صفات النبرة المرفوضة', 'Anti-tone Attributes')} hint={L('ما يجب ألا تبدو عليه العلامة أبداً', 'What the brand should never sound like')}>
                <div className="flex flex-wrap gap-2">
                  {ANTI_ATTRIBUTES.map((a) => {
                    const active = antiAttrs.has(a)
                    return (
                      <button key={a} type="button" onClick={() => toggleSet(setAntiAttrs, a)} aria-pressed={active}
                        className={'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' + (active ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                        {a}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={L('اللون الرئيسي للعلامة', 'Brand Primary Color')} hint="Hex">
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.currentTarget.value)}
                  className="h-10 w-full cursor-pointer rounded-(--r-md) border border-(--border-default) bg-(--surface-4) p-1" />
              </Field>
            </>
          )}

          {/* ── TAB 3: Personality ── */}
          {activeTab === 3 && (
            <>
              <SectionTitle dir={dir}>{L('الشخصية والمشاعر', 'Personality & Emotions')}</SectionTitle>

              <Field label={L('عائلة الأركيتايب', 'Archetype Family')}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ARCHETYPE_FAMILY.map((a) => (
                    <button key={a.v} type="button" onClick={() => { setArchetypeFamily(a.v); setArchetypePrimary('') }} aria-pressed={archetypeFamily === a.v}
                      className={'flex flex-col items-start rounded-(--r-md) border p-3 transition-colors ' + (archetypeFamily === a.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)')}>
                      <span className="text-sm font-medium text-(--fg)">{a.label}</span>
                      <span className="mt-0.5 text-[11px] text-(--fg-muted)">{a.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>

              {archetypeFamily && ARCHETYPE_PRIMARY[archetypeFamily] && (
                <Field label={L('الأركيتايب المحدد', 'Primary Archetype')}>
                  <div className="flex flex-wrap gap-2">
                    {ARCHETYPE_PRIMARY[archetypeFamily]!.map((a) => (
                      <button key={a.v} type="button" onClick={() => setArchetypePrimary(a.v)} aria-pressed={archetypePrimary === a.v}
                        className={'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ' + (archetypePrimary === a.v ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              <Field label={L('الموسيقى', 'Music Vibe')} hint={L('ما هو الجو الموسيقي للعلامة؟', "What's the brand's musical feel?")}>
                <div className="space-y-2">
                  {MUSIC.map((m) => (
                    <label key={m.v} className={'flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong) ' + (music === m.v ? 'border-(--accent)' : 'border-(--border-subtle)')}>
                      <input type="radio" value={m.v} checked={music === m.v} onChange={() => setMusic(m.v)} className="mt-1 accent-(--accent)" />
                      <span>
                        <span className="text-sm font-medium text-(--fg)">{m.label}</span>
                        <span className="block text-xs text-(--fg-muted)">{m.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={L('رابط مرجع موسيقي', 'Music Reference Link')} hint="YouTube / Spotify">
                <Input type="url" dir="ltr" placeholder="https://open.spotify.com/..." value={musicLink} onChange={(e) => setMusicLink(e.currentTarget.value)} />
              </Field>

              <Field label={L('أسلوب حياة العميل', 'Customer Lifestyle')} hint={L('أين يعيش عميلك يومه؟', "Where does your customer spend their day?")}>
                <div className="space-y-2">
                  {LIFESTYLE.map((l) => (
                    <label key={l.v} className={'flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong) ' + (lifestyle === l.v ? 'border-(--accent)' : 'border-(--border-subtle)')}>
                      <input type="radio" value={l.v} checked={lifestyle === l.v} onChange={() => setLifestyle(l.v)} className="mt-1 accent-(--accent)" />
                      <span>
                        <span className="text-sm font-medium text-(--fg)">{l.label}</span>
                        <span className="block text-xs text-(--fg-muted)">{l.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={L('المشاعر المستهدفة', 'Target Emotions')} hint={L('اختر حتى 3', 'Choose up to 3')}>
                <div className="flex flex-wrap gap-2">
                  {EMOTIONS.map((e) => {
                    const active = emotions.has(e)
                    const disabled = !active && emotions.size >= 3
                    return (
                      <button key={e} type="button" onClick={() => toggleEmotion(e)} disabled={disabled} aria-pressed={active}
                        className={'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' + (active ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : disabled ? 'cursor-not-allowed border-(--border-subtle) bg-(--surface-3) text-(--fg-muted)/50' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                        {e}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={L('مراجع العلامات', 'Brand References')} hint={L('علامات تريد الشبه بها (ليست منافسين)', 'Brands you admire (not competitors)')}>
                <Input dir="auto" maxLength={200} placeholder="Almarai, Zara" value={brandRefs} onChange={(e) => setBrandRefs(e.currentTarget.value)} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={L('موقع السعر', 'Price Position')}>
                  <Select value={pricePosition} onChange={(e) => setPricePosition(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {PRICE.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </Field>
                <Field label={L('النطاق السعري الفعلي', 'Actual Price Range')}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-(--fg-muted) shrink-0">SAR</span>
                    <Input dir="ltr" type="number" min={0} max={999999} step={1} className="w-24" placeholder="0" value={priceMin}
                      onChange={(e) => { const v = e.currentTarget.value; setPriceMin(v); setPriceNums(`SAR ${v}–${priceMax}`) }} />
                    <span className="text-sm text-(--fg-muted)">–</span>
                    <Input dir="ltr" type="number" min={0} max={999999} step={1} className="w-24" placeholder="0" value={priceMax}
                      onChange={(e) => { const v = e.currentTarget.value; setPriceMax(v); setPriceNums(`SAR ${priceMin}–${v}`) }} />
                  </div>
                </Field>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-(--fg-muted)">{L('مقاييس أسلوب العلامة', 'Brand Style Scales')}</p>
                <SliderRow label={L('بسيط', 'Minimal')} labelEnd={L('معقد', 'Maximal')} value={scaleMinmax} onChange={setScaleMinmax} />
                <SliderRow label={L('هادئ', 'Quiet')} labelEnd={L('صاخب', 'Loud')} value={scaleQuietloud} onChange={setScaleQuietloud} />
                <SliderRow label={L('محلي', 'Local')} labelEnd={L('عالمي', 'Global')} value={scaleLocalglobal} onChange={setScaleLocalglobal} />
                <SliderRow label={L('تقليدي', 'Traditional')} labelEnd={L('حديث', 'Modern')} value={scaleTradmod} onChange={setScaleTradmod} />
              </div>
            </>
          )}

          {/* ── TAB 4: Audience ── */}
          {activeTab === 4 && (
            <>
              <SectionTitle dir={dir}>{L('الجمهور والاستراتيجية', 'Audience & Strategy')}</SectionTitle>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={L('القناة الرئيسية', 'Primary Channel')}>
                  <Select value={primaryChannel} onChange={(e) => setPrimaryChannel(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
                <Field label={L('المؤشر الرئيسي', 'Primary KPI')}>
                  <Select value={primaryKpi} onChange={(e) => setPrimaryKpi(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {KPI.map((k) => <option key={k} value={k}>{k}</option>)}
                  </Select>
                </Field>
              </div>

              <Field label={L('الحالة التسويقية الحالية', 'Current Marketing Intent')}>
                <div className="space-y-2">
                  {INTENTS.map((i) => (
                    <label key={i.v} className={'flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong) ' + (intent === i.v ? 'border-(--accent)' : 'border-(--border-subtle)')}>
                      <input type="radio" value={i.v} checked={intent === i.v} onChange={() => setIntent(i.v)} className="mt-1 accent-(--accent)" />
                      <span>
                        <span className="text-sm font-medium text-(--fg)">{i.label}</span>
                        <span className="block text-xs text-(--fg-muted)">{i.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={L('توزيع الجنس في الجمهور', 'Audience Gender Mix')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-4) px-3 py-2">
                    <span className="text-sm text-(--fg-muted)">{L('إناث %', 'Female %')}</span>
                    <Input type="number" min={0} max={100} value={audienceFemale} onChange={(e) => setAudienceFemale(Number(e.currentTarget.value))} className="w-20 bg-transparent text-end text-sm" />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-4) px-3 py-2">
                    <span className="text-sm text-(--fg-muted)">{L('ذكور %', 'Male %')}</span>
                    <Input type="number" min={0} max={100} value={audienceMale} onChange={(e) => setAudienceMale(Number(e.currentTarget.value))} className="w-20 bg-transparent text-end text-sm" />
                  </label>
                </div>
              </Field>

              <Field label={L('أولويات المناسبات السعودية', 'Saudi Occasion Relevance')}>
                <div className="space-y-2">
                  {[
                    { key: 'ramadan',    label: L('رمضان', 'Ramadan'),             value: ramadan,     setValue: setRamadan },
                    { key: 'eid_fitr',   label: L('عيد الفطر', 'Eid Al-Fitr'),     value: eidFitr,     setValue: setEidFitr },
                    { key: 'eid_adha',   label: L('عيد الأضحى', 'Eid Al-Adha'),    value: eidAdha,     setValue: setEidAdha },
                    { key: 'nationalDay',label: L('اليوم الوطني', 'National Day'),  value: nationalDay, setValue: setNationalDay },
                    { key: 'foundingDay',label: L('يوم التأسيس', 'Founding Day'),   value: foundingDay, setValue: setFoundingDay },
                  ].map((o) => (
                    <div key={o.key} className="flex items-center justify-between gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-4) px-3 py-2">
                      <span className="text-sm text-(--fg)">{o.label}</span>
                      <Select value={o.value} onChange={(e) => o.setValue(e.currentTarget.value)} className="w-40">
                        {RELEVANCE.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    </div>
                  ))}
                </div>
              </Field>
            </>
          )}

          {/* ── TAB 5: Story ── */}
          {activeTab === 5 && (
            <>
              <SectionTitle dir={dir}>{L('القصة والاستراتيجية', 'Story & Strategy')}</SectionTitle>

              <Field label={L('قصة التأسيس', 'Founding Story')} hint={L('ما الذي دفعك لبدء هذا؟', 'What drove you to start this?')}>
                <Textarea dir="auto" rows={3} maxLength={1000} value={foundingStory} onChange={(e) => setFoundingStory(e.currentTarget.value)} />
              </Field>
              <Field label={L('معنى الاسم', 'Name Meaning')} hint={L('القصة أو المعنى وراء اسم العلامة', 'The story or meaning behind the brand name')}>
                <Textarea dir="auto" rows={2} maxLength={300} value={nameMeaning} onChange={(e) => setNameMeaning(e.currentTarget.value)} />
              </Field>
              <Field label={L('المنتج البطل — لماذا هذا؟', 'Hero Product — Why This?')} hint={L('أهم منتج وسبب تميزه', 'Your most important product and what makes it stand out')}>
                <Textarea dir="auto" rows={2} maxLength={300} value={heroWhy} onChange={(e) => setHeroWhy(e.currentTarget.value)} />
              </Field>
              <Field label={L('قيم المالك', 'Owner Values')} hint={L('ماذا تؤمن كصاحب عمل؟', 'What do you believe in as a business owner?')}>
                <Textarea dir="auto" rows={2} maxLength={500} value={ownerValues} onChange={(e) => setOwnerValues(e.currentTarget.value)} />
              </Field>

              <Field label={L('الراحة أمام الكاميرا', 'Comfort On Camera')}>
                <div className="space-y-2">
                  {COMFORT_ON_CAMERA.map((c) => (
                    <label key={c.v} className={'flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong) ' + (comfortOnCamera === c.v ? 'border-(--accent)' : 'border-(--border-subtle)')}>
                      <input type="radio" value={c.v} checked={comfortOnCamera === c.v} onChange={() => setComfortOnCamera(c.v)} className="mt-1 accent-(--accent)" />
                      <span>
                        <span className="text-sm font-medium text-(--fg)">{c.label}</span>
                        <span className="block text-xs text-(--fg-muted)">{c.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={L('أسلوب التواصل', 'Way of Speaking')}>
                <Select value={wayOfSpeaking} onChange={(e) => setWayOfSpeaking(e.currentTarget.value)}>
                  <option value="">{L('— اختر —', '— Select —')}</option>
                  {WAY_OF_SPEAKING.map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </Field>

              <Field label={L('الأسلوب التواصلي', 'Communication Style')}>
                <Input dir="auto" maxLength={200} value={communicationStyle} onChange={(e) => setCommunicationStyle(e.currentTarget.value)} />
              </Field>

              <Field label={L('أهداف العمل', 'Brand Goals')} hint={L('ماذا تريد تحقيقه خلال 6–12 شهراً؟', 'What do you want to achieve in 6–12 months?')}>
                <Textarea dir="auto" rows={2} maxLength={300} value={brandGoals} onChange={(e) => setBrandGoals(e.currentTarget.value)} />
              </Field>

              <Field label={L('إيقاع النشر', 'Posting Rhythm')}>
                <div className="space-y-2">
                  {POSTING_RHYTHM.map((p) => (
                    <label key={p.v} className={'flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong) ' + (postingRhythm === p.v ? 'border-(--accent)' : 'border-(--border-subtle)')}>
                      <input type="radio" value={p.v} checked={postingRhythm === p.v} onChange={() => setPostingRhythm(p.v)} className="mt-1 accent-(--accent)" />
                      <span>
                        <span className="text-sm font-medium text-(--fg)">{p.label}</span>
                        <span className="block text-xs text-(--fg-muted)">{p.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={L('أسلوب التعليق', 'Caption Style')}>
                <div className="space-y-2">
                  {CAPTION_STYLE.map((p) => (
                    <label key={p.v} className={'flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong) ' + (captionStyle === p.v ? 'border-(--accent)' : 'border-(--border-subtle)')}>
                      <input type="radio" value={p.v} checked={captionStyle === p.v} onChange={() => setCaptionStyle(p.v)} className="mt-1 accent-(--accent)" />
                      <span>
                        <span className="text-sm font-medium text-(--fg)">{p.label}</span>
                        <span className="block text-xs text-(--fg-muted)">{p.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={L('مستوى الإذن', 'Permission Level')} hint={L('كيف تستحق علامتك الحق في التحدث؟', 'How has your brand earned the right to speak?')}>
                <div className="space-y-2">
                  {PERMISSION_LEVEL.map((p) => (
                    <label key={p.v} className={'flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong) ' + (permissionLevel === p.v ? 'border-(--accent)' : 'border-(--border-subtle)')}>
                      <input type="radio" value={p.v} checked={permissionLevel === p.v} onChange={() => setPermissionLevel(p.v)} className="mt-1 accent-(--accent)" />
                      <span>
                        <span className="text-sm font-medium text-(--fg)">{p.label}</span>
                        <span className="block text-xs text-(--fg-muted)">{p.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={L('التوتر الثقافي المملوك', 'Cultural Tension Owned')} hint={L('التوتر الثقافي الذي تمتلكه علامتك', 'The cultural tension your brand owns')}>
                <Input dir="auto" maxLength={300} placeholder={L('مثال: التقليد مقابل الراحة الحديثة', 'e.g. Tradition vs. modern comfort')} value={culturalTension} onChange={(e) => setCulturalTension(e.currentTarget.value)} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={L('مرحلة الهدف', 'Goal Phase')}>
                  <Select value={goalPhase} onChange={(e) => setGoalPhase(e.currentTarget.value)}>
                    <option value="">{L('— اختر —', '— Select —')}</option>
                    {GOAL_PHASE.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </Field>
                <Field label={L('الشجاعة الافتراضية', 'Bold Default')} hint={L('هل تفضل المحتوى الجريء؟', 'Prefer bold content by default?')}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-4) px-4 py-3 hover:border-(--border-strong)">
                    <input type="checkbox" checked={braveSafe} onChange={(e) => setBraveSafe(e.currentTarget.checked)} className="accent-(--accent)" />
                    <span className="text-sm text-(--fg)">{L('أفضل المحتوى الجريء والمميز افتراضياً', 'Prefer bold & distinctive content by default')}</span>
                  </label>
                </Field>
              </div>

              <Field label={L('الرؤية (12 شهراً)', 'Vision (12 months)')} hint={L('ما الذي يبدو عليه النجاح بعد 12 شهراً؟', 'What does success look like in 12 months?')}>
                <div className="flex flex-wrap gap-2">
                  {VISION.map((v) => (
                    <button key={v.v} type="button" onClick={() => setVision(v.v)} aria-pressed={vision === v.v}
                      className={'flex flex-col items-start rounded-(--r-md) border p-3 text-sm transition-colors ' + (vision === v.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)')}>
                      <span className="font-medium text-(--fg)">{v.label}</span>
                      <span className="text-[11px] text-(--fg-muted)">{v.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={L('الرؤية بكلماتك الخاصة', 'Vision In Your Own Words')}>
                <Textarea dir="auto" rows={2} maxLength={500} value={visionText} onChange={(e) => setVisionText(e.currentTarget.value)} />
              </Field>

              <Field label={L('العلامات التي تعجبك', 'Respected Brands')} hint={L('1–2 علامات (ليست منافسين)', '1–2 brands you admire (not competitors)')}>
                <Input dir="auto" maxLength={200} value={respectBrands} onChange={(e) => setRespectBrands(e.currentTarget.value)} />
              </Field>

              <Field label={L('لماذا تعجبك؟', 'Why Do You Respect Them?')}>
                <Textarea dir="auto" rows={2} maxLength={300} value={respectWhy} onChange={(e) => setRespectWhy(e.currentTarget.value)} />
              </Field>
            </>
          )}

          {/* ── TAB 6: Content ── */}
          {activeTab === 6 && (
            <>
              <SectionTitle dir={dir}>{L('المحتوى والأهداف', 'Content & Goals')}</SectionTitle>

              <Field label={L('المنتجات والخدمات', 'Products & Services')} hint={L('قائمة بما تبيعه — أسماء، أسعار، ما يميز كل منتج', 'List what you sell — names, prices, what makes each distinctive')}>
                <Textarea dir="auto" rows={4} maxLength={800} placeholder={L('مثال:\n- زوي ماجو — 12 ريال\n- زوي ليمون — 12 ريال', 'e.g.\n- Zoi Mango — SAR 12\n- Zoi Lemon — SAR 12')} value={productsList} onChange={(e) => setProductsList(e.currentTarget.value)} />
              </Field>

              <Field label={L('وصف العميل المثالي', 'Ideal Customer Description')} hint={L('صِف عميلك المثالي كشخص حقيقي', 'Describe your ideal customer as a real person')}>
                <Textarea dir="auto" rows={3} maxLength={400} placeholder={L('مثال: شاب سعودي مهتم بالصحة، يعمل بين الاجتماعات ويطلب الطعام أونلاين', 'e.g. Young Saudi professional, health-conscious, orders food online')} value={custDesc} onChange={(e) => setCustDesc(e.currentTarget.value)} />
              </Field>

              <Field label={L('هدف المحتوى', 'Content Goal')}>
                <div className="flex flex-wrap gap-2">
                  {GOAL.map((g) => (
                    <button key={g.v} type="button" onClick={() => setGoal(g.v)} aria-pressed={goal === g.v}
                      className={'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' + (goal === g.v ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={L('الشعار / السلوجان', 'Tagline / Slogan')}>
                <Input dir="auto" maxLength={100} placeholder={L('مثال: "صُنع للجريئين"', 'e.g. "Made for the bold"')} value={tagline} onChange={(e) => setTagline(e.currentTarget.value)} />
              </Field>

              <Field label={L('اقتباس حقيقي من عميل', 'Real Customer Quote')}>
                <Textarea dir="auto" rows={2} maxLength={300} value={custQuote} onChange={(e) => setCustQuote(e.currentTarget.value)} />
              </Field>

              <Field label={L('تعليق تحبه', 'Favourite Caption')} hint={L('تعليق نشرته سابقاً وأعجبك', 'A caption you published before that you loved')}>
                <Textarea dir="auto" rows={2} maxLength={300} value={captionEx} onChange={(e) => setCaptionEx(e.currentTarget.value)} />
              </Field>

              <Field label={L('مؤشر النجاح الوحيد', 'Single Success Metric')}>
                <Input dir="auto" maxLength={100} placeholder={L('مثال: رسائل DM يومياً، الطلبات، الزيارات', 'e.g. Daily DMs, orders, foot traffic')} value={metric} onChange={(e) => setMetric(e.currentTarget.value)} />
              </Field>

              <Field label={L('القيود المخصصة', 'Custom Restriction')} hint={L('أي قيد إضافي خارج القائمة المعدة مسبقاً', 'Any extra restriction not in the preset list')}>
                <Input dir="auto" maxLength={200} value={customRestriction} onChange={(e) => setCustomRestriction(e.currentTarget.value)} />
              </Field>

              <Field label={L('مناسبة مخصصة', 'Custom Occasion')} hint={L('أي مناسبة رئيسية أخرى لعلامتك', 'Any other key occasion for your brand')}>
                <Input dir="auto" maxLength={100} placeholder={L('مثال: العودة للمدرسة', 'e.g. Back to school')} value={customOccasion} onChange={(e) => setCustomOccasion(e.currentTarget.value)} />
              </Field>

              <Field label={L('أفضل 3 مناسبات (مرتبة)', 'Top 3 Occasions (ranked)')}>
                <div className="flex flex-wrap gap-2">
                  {OCCASIONS_LIST.map((occ) => {
                    const rank = occasionsRanked.indexOf(occ)
                    const selected = rank !== -1
                    return (
                      <button key={occ} type="button" onClick={() => toggleOccasionRank(occ)} aria-pressed={selected}
                        className={'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' + (selected ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                        {selected && <span className="font-bold">{rank + 1}.</span>}
                        {occ}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={L('قيود المحتوى', 'Content Restrictions')} hint={L('ما لا يجب إظهاره أبداً', 'What must never appear')}>
                <div className="flex flex-wrap gap-2">
                  {RESTRICTIONS_LIST.map((r) => {
                    const active = restrictions.has(r)
                    return (
                      <button key={r} type="button" onClick={() => toggleSet(setRestrictions, r)} aria-pressed={active}
                        className={'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' + (active ? 'border-(--danger)/60 bg-(--danger)/10 text-(--danger)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                        {r.replace(/_/g, ' ')}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={L('مشاكل المحتوى التي واجهتها', 'Content Problems Faced')}>
                <div className="flex flex-wrap gap-2">
                  {PROBLEMS_LIST.map((p) => {
                    const active = problems.has(p)
                    return (
                      <button key={p} type="button" onClick={() => toggleSet(setProblems, p)} aria-pressed={active}
                        className={'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' + (active ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)')}>
                        {p}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={L('أي شيء آخر تريدنا أن نعرفه', 'Anything Else We Should Know')}>
                <Textarea dir="auto" rows={3} maxLength={500} value={anything} onChange={(e) => setAnything(e.currentTarget.value)} />
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-4 border-t border-(--border-subtle) bg-(--surface-2) px-5 py-4" dir={dir}>
          <div className="text-sm text-(--fg-muted)">
            {error
              ? <span className="text-(--danger)">{error}</span>
              : changedCount === 0
                ? (isAr ? 'غيّر أي حقل لإرسال تصحيح' : 'Change any field to submit a correction')
                : <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                    {isAr
                      ? `${changedCount} ${changedCount !== 1 ? 'حقول' : 'حقل'} تم تعديلها`
                      : `${changedCount} field${changedCount !== 1 ? 's' : ''} changed`}
                  </span>
            }
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
            <Button type="submit" size="sm" disabled={changedCount === 0}>
              {isAr ? `حفظ التغييرات${changedCount > 0 ? ` (${changedCount})` : ''}` : `Save Changes${changedCount > 0 ? ` (${changedCount})` : ''}`}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
  })()

  return (
    <>
      <Button variant="secondary" size="sm" onClick={handleOpen}>
        {isAr ? 'تعديل BrandDNA' : 'Edit BrandDNA'}
      </Button>

      {/* Modal backdrop + dialog */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          dir={dir}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden="true"
          />
          {/* Panel — fixed width, scrollable */}
          <div className="relative z-10 flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-2xl">
            {modalContent}
          </div>
        </div>
      )}
    </>
  )
}

// ── CorrectionForm — single-field inline form (evidence bundle rows) ──────────
// Kept for the per-bundle inline "Flag correction" feature in the profile page.

export type CorrectableField = string

export interface CurrentValues_Legacy {
  [key: string]: string | string[] | null | undefined
}

// Map enum fields to their allowed values for inline correction selects.
// Free-text fields (founding_story, etc.) are not listed here → textarea fallback.
const FIELD_OPTIONS: Record<string, readonly string[]> = {
  // ── Enum / single-select fields ───────────────────────────────────────────
  arabic_dialect:         DIALECTS,
  bilingual_ratio:        BILINGUAL,
  formality_level:        FORMALITY,
  humor_tolerance:        HUMOR,
  religious_sensitivity:  RELIGIOUS,
  tone_register:          TONE_REGISTER,
  price_position:         PRICE,
  primary_channel:        CHANNELS,
  primary_kpi_type:       KPI,
  goal_phase:             GOAL_PHASE,
  way_of_speaking:        WAY_OF_SPEAKING,
  region_primary:         REGIONS,
  city_primary:           [...SAUDI_CITIES],
  sector:                 [...SECTORS],
  archetype_family:       ARCHETYPE_FAMILY.map((a) => a.v),
  archetype_primary:      [
    'Innocent', 'Sage', 'Explorer', 'Outlaw', 'Magician',
    'Hero', 'Lover', 'Jester', 'Everyman', 'Caregiver', 'Ruler', 'Creator',
  ],
  archetype_secondary:    [
    'Innocent', 'Sage', 'Explorer', 'Outlaw', 'Magician',
    'Hero', 'Lover', 'Jester', 'Everyman', 'Caregiver', 'Ruler', 'Creator',
  ],
  music:                  MUSIC.map((m) => m.v),
  lifestyle:              LIFESTYLE.map((l) => l.v),
  permission_level:       PERMISSION_LEVEL.map((p) => p.v),
  posting_rhythm:         POSTING_RHYTHM.map((r) => r.v),
  caption_style:          CAPTION_STYLE.map((c) => c.v),
  intent_state:           INTENTS.map((i) => i.v),
  comfort_on_camera:      COMFORT_ON_CAMERA.map((c) => c.v),
  vision:                 VISION.map((v) => v.v),
  goal:                   GOAL.map((g) => g.v),
  ramadan_relevance:      [...RELEVANCE],
  eid_fitr_relevance:     [...RELEVANCE],
  eid_adha_relevance:     [...RELEVANCE],
  national_day_relevance: [...RELEVANCE],
  founding_day_relevance: [...RELEVANCE],
  lifecycle:              ['launch', 'growth', 'established', 'mature', 'legacy'],
  lifecycle_stage:        ['pre_launch', 'launch', 'growth', 'maturity', 'recovery'],
  // Audience profile fields (remapped by page.tsx before reaching here)
  audience_language_preference: BILINGUAL,
  audience_description_ar:      [], // free text — falls through to textarea
  audience_age_range:           [], // free text — falls through to textarea
}

// Fields that render as multi-select checkboxes (text[] columns)
const FIELD_MULTI_OPTIONS: Record<string, readonly string[]> = {
  tone_anti_attribute_ids: [...ANTI_ATTRIBUTES],
  emotions:                [...EMOTIONS],
  platforms:               [...PLATFORMS_LIST],
  occasions_ranked:        [...OCCASIONS_LIST],
  problems:                [...PROBLEMS_LIST],
}

// ── GenderSplitInput — Female % + Male % with live sum=100 validation ────────
function GenderSplitInput({
  currentValue,
  parsePct,
  disabled,
  isAr,
}: {
  currentValue: string | null
  parsePct: (v: string | null) => { female: number; male: number }
  disabled: boolean
  isAr: boolean
}) {
  const init = parsePct(currentValue)
  const [mounted, setMounted] = useState(false)
  const [female, setFemale] = useState(init.female)
  const [male,   setMale]   = useState(init.male)

  // Suppress hydration mismatch — this component is interactive-only.
  // Render a neutral placeholder on the server; mount the real UI on the client.
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) {
    return (
      <div className="h-24 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) animate-pulse" />
    )
  }

  const sum   = female + male
  const valid = sum === 100

  // Derive the enum value and display string from the percentages
  const enumVal = female >= 60 ? 'female_skewed' : male >= 60 ? 'male_skewed' : 'mixed'

  function handleFemale(v: number) {
    const clamped = Math.max(0, Math.min(100, v))
    setFemale(clamped)
    setMale(100 - clamped)
  }
  function handleMale(v: number) {
    const clamped = Math.max(0, Math.min(100, v))
    setMale(clamped)
    setFemale(100 - clamped)
  }

  return (
    <div className="space-y-3" dir="ltr">
      {/* Hidden fields read by onSubmit */}
      <input type="hidden" name="_female_pct" value={female} />
      <input type="hidden" name="_male_pct"   value={male}   />
      {/* corrected_value = the enum the Memory Controller expects */}
      <input type="hidden" name="corrected_value" value={valid ? enumVal : ''} />

      <div className="grid grid-cols-2 gap-3">
        {/* Female */}
        <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">👩</span>
            <span className="text-xs font-semibold text-(--fg)">{isAr ? 'نساء' : 'Female'}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={100} step={5}
              value={female}
              onChange={(e) => handleFemale(Number(e.currentTarget.value))}
              disabled={disabled}
              className="flex-1 h-2 cursor-pointer accent-pink-500"
            />
            <input
              type="number" min={0} max={100} step={1}
              value={female}
              onChange={(e) => handleFemale(Number(e.currentTarget.value))}
              disabled={disabled}
              className="w-14 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1 text-center text-sm font-mono text-(--fg) focus:outline-none focus:ring-1 focus:ring-(--accent)"
            />
            <span className="text-xs text-(--fg-muted)">%</span>
          </div>
        </div>

        {/* Male */}
        <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">👨</span>
            <span className="text-xs font-semibold text-(--fg)">{isAr ? 'رجال' : 'Male'}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={100} step={5}
              value={male}
              onChange={(e) => handleMale(Number(e.currentTarget.value))}
              disabled={disabled}
              className="flex-1 h-2 cursor-pointer accent-blue-500"
            />
            <input
              type="number" min={0} max={100} step={1}
              value={male}
              onChange={(e) => handleMale(Number(e.currentTarget.value))}
              disabled={disabled}
              className="w-14 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1 text-center text-sm font-mono text-(--fg) focus:outline-none focus:ring-1 focus:ring-(--accent)"
            />
            <span className="text-xs text-(--fg-muted)">%</span>
          </div>
        </div>
      </div>

      {/* Sum indicator */}
      <div className={`flex items-center gap-1.5 text-xs font-medium ${valid ? 'text-(--success)' : 'text-(--danger)'}`}>
        {valid ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {isAr ? `المجموع 100% · ${enumVal.replace('_', ' ')}` : `Total = 100% · ${enumVal.replace('_', ' ')}`}
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {isAr ? `المجموع = ${sum}% (يجب أن يكون 100%)` : `Total = ${sum}% — must equal 100%`}
          </>
        )}
      </div>
    </div>
  )
}

function FieldInput({ fieldName, currentValue, disabled, locale }: { fieldName: string; currentValue: string | null; disabled: boolean; locale: string }) {
  const isAr = locale === 'ar'
  const dir = isAr ? 'rtl' : 'ltr'

  // ── Single-select (enum) ─────────────────────────────────────────────────
  const opts = FIELD_OPTIONS[fieldName]
  if (opts && opts.length > 0) {
    return (
      <Select name="corrected_value" defaultValue={currentValue ?? ''} required disabled={disabled} dir={dir}>
        <option value="">{isAr ? '— اختر —' : '— Select —'}</option>
        {opts.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </Select>
    )
  }

  // ── Multi-select (text[] columns) ────────────────────────────────────────
  const multiOpts = FIELD_MULTI_OPTIONS[fieldName]
  if (multiOpts) {
    const currentArr = (currentValue ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    return <MultiCheckInput fieldName={fieldName} options={multiOpts} currentArr={currentArr} disabled={disabled} />
  }

  // ── primary_audience_gender: Female % + Male % with sum=100 validation ──
  if (fieldName === 'primary_audience_gender') {
    // Parse current value — stored as "50% F / 50% M" or raw enum like "female_skewed"
    const parsePct = (v: string | null) => {
      if (!v) return { female: 50, male: 50 }
      const fMatch = v.match(/(\d+)\s*%?\s*F/i)
      const mMatch = v.match(/(\d+)\s*%?\s*M/i)
      if (fMatch && mMatch) return { female: Number(fMatch[1]), male: Number(mMatch[1]) }
      if (v === 'female_skewed') return { female: 65, male: 35 }
      if (v === 'male_skewed')   return { female: 35, male: 65 }
      return { female: 50, male: 50 }
    }
    return <GenderSplitInput currentValue={currentValue} parsePct={parsePct} disabled={disabled} isAr={isAr} />
  }

  // ── price_nums: SAR min – max ────────────────────────────────────────────
  if (fieldName === 'price_nums') {
    const parts = (currentValue ?? '').replace(/SAR/gi, '').split(/[-–]/).map((s) => s.trim())
    const minVal = parts[0] ?? ''
    const maxVal = parts[1] ?? ''
    return (
      <div className="flex items-center gap-2" dir="ltr">
        <span className="text-sm text-(--fg-muted) shrink-0">SAR</span>
        <Input name="_price_min" type="number" min={0} max={999999} step={1} defaultValue={minVal} placeholder="0" className="w-28" disabled={disabled} />
        <span className="text-sm text-(--fg-muted)">–</span>
        <Input name="_price_max" type="number" min={0} max={999999} step={1} defaultValue={maxVal} placeholder="0" className="w-28" disabled={disabled} />
        <input type="hidden" name="corrected_value" id={`price_nums_hidden_${fieldName}`} />
      </div>
    )
  }

  // ── Boolean toggle (brave_safe_default) ──────────────────────────────────
  if (fieldName === 'brave_safe_default') {
    const current = currentValue === 'true' || currentValue === '1'
    return (
      <Select name="corrected_value" defaultValue={current ? 'true' : 'false'} required disabled={disabled} dir={dir}>
        <option value="true">{isAr ? 'جريء (خارج الصندوق)' : 'Brave (push the envelope)'}</option>
        <option value="false">{isAr ? 'آمن (محافظ)' : 'Safe (conservative)'}</option>
      </Select>
    )
  }

  // ── founded_year: number input ───────────────────────────────────────────
  if (fieldName === 'founded_year') {
    return (
      <Input name="corrected_value" type="number" min={1900} max={new Date().getFullYear()} step={1}
        defaultValue={currentValue ?? ''} placeholder="e.g. 2015" required disabled={disabled} dir="ltr" />
    )
  }

  // ── Scale fields: 0-100 slider ───────────────────────────────────────────
  if (fieldName.startsWith('scale_')) {
    return (
      <Input name="corrected_value" type="number" min={0} max={100} step={1}
        defaultValue={currentValue ?? '50'} required disabled={disabled} dir="ltr" />
    )
  }

  // ── Default: free text ───────────────────────────────────────────────────
  return (
    <Textarea name="corrected_value" defaultValue={currentValue ?? ''} required minLength={1} maxLength={500} rows={3} dir="auto" disabled={disabled} />
  )
}

// Multi-checkbox for text[] fields — renders inline chips, hidden input holds comma-joined value
function MultiCheckInput({ fieldName, options, currentArr, disabled }: {
  fieldName: string; options: readonly string[]; currentArr: string[]; disabled: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentArr))
  const value = [...selected].join(', ')
  return (
    <div className="space-y-2">
      <input type="hidden" name="corrected_value" value={value || ' '} />
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.has(o)
          return (
            <button
              key={o}
              type="button"
              disabled={disabled}
              onClick={() => setSelected((prev) => {
                const next = new Set(prev)
                if (next.has(o)) next.delete(o)
                else next.add(o)
                return next
              })}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                on
                  ? 'bg-(--accent) text-white border-(--accent)'
                  : 'bg-transparent text-(--fg-muted) border-(--border-subtle) hover:border-(--accent) hover:text-(--accent)'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {o.replace(/_/g, ' ')}
            </button>
          )
        })}
      </div>
      {value.trim() === '' && (
        <p className="text-xs text-(--fg-faint) italic">Select at least one option</p>
      )}
    </div>
  )
}

export function CorrectionForm({
  brandId,
  fieldName,
  currentValue,
  locale = 'ar',
}: {
  brandId: string
  fieldName: string
  currentValue: string | null
  locale?: string
}) {
  const router = useRouter()
  const [, startT] = useTransition()
  const [status, setStatus] = useState<FieldStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [stage, setStage] = useState<CorrectionStage | null>(null)
  const [formKey, setFormKey] = useState(0)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const supabaseRef = useRef<ReturnType<typeof browserClient> | null>(null)
  function getSupa() {
    if (!supabaseRef.current) supabaseRef.current = browserClient()
    return supabaseRef.current
  }
  const channelRef = useRef<RealtimeChannel | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (channelRef.current) getSupa().removeChannel(channelRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  async function startRealtimeWatch(onReady?: () => void) {
    const supabase = getSupa()
    let resolved = false

    function resolve(finalStatus: FieldStatus, msg: string | null) {
      if (resolved) return
      resolved = true
      clearTimeout(timeoutRef.current!)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      if (finalStatus === 'written') {
        setStatus('written')
        router.refresh()
        setTimeout(() => {
          setFormKey((k) => k + 1)
          if (detailsRef.current) detailsRef.current.open = false
          setStatus('idle')
          setStage(null)
        }, 3000)
      } else {
        setStatus(finalStatus)
        if (msg) setMessage(msg)
      }
    }

    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData.session?.access_token) supabase.realtime.setAuth(sessionData.session.access_token)

    const channel = supabase
      .channel(`correction_${brandId}_${fieldName}_${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'branddna_event_log', filter: `brand_id=eq.${brandId}` }, (payload) => {
        const eventData = payload.new?.event_data as Record<string, unknown> | undefined
        const eventType = payload.new?.event_type as string
        if (eventType?.startsWith('correction_progress_')) {
          const s = (eventData?.stage ?? eventType.replace('correction_progress_', '')) as CorrectionStage
          const batchFields = Array.isArray(eventData?.fields) ? eventData.fields as string[] : null
          const evField = String(eventData?.field_name ?? '')
          if (batchFields) { if (!batchFields.includes(fieldName)) return }
          else if (evField && evField !== fieldName) return
          if (s === 'correction_applied') { resolve('written', null); return }
          if (s === 'correction_rejected') { resolve('rejected', humaniseRejection(String(eventData?.rejection_reason ?? ''))); return }
          setStage(s); return
        }
        const appliedTo = String(eventData?.applied_to ?? eventData?.field_name ?? '')
        const col = appliedTo.includes('.') ? appliedTo.split('.').pop()! : appliedTo
        if (col !== fieldName && appliedTo !== fieldName) return
        if (eventType === 'client_confirmed' || eventType === 'confidence_upgraded') resolve('written', null)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'memory_controller_queue', filter: `brand_id=eq.${brandId}` }, (payload) => {
        if (payload.new?.status !== 'rejected') return
        const nomData = payload.new?.nomination_data as Record<string, unknown> | undefined
        const fp = String(nomData?.field_path ?? '')
        const col = fp.includes('.') ? fp.split('.').pop()! : fp
        if (col !== fieldName && fp !== fieldName) return
        resolve('rejected', humaniseRejection(String(payload.new?.rejection_reason ?? '')))
      })
      .subscribe((connStatus) => {
        if (connStatus === 'SUBSCRIBED') { onReady?.() }
        else if (connStatus === 'CHANNEL_ERROR' || connStatus === 'CLOSED') {
          onReady?.()
          resolve('timeout', locale === 'ar'
            ? 'تم حفظ التصحيح — انقطع الاتصال المباشر. أعد تحميل الصفحة بعد لحظة للتحقق.'
            : 'Correction saved — live connection dropped. Reload the page in a moment to verify.')
        }
      })
    channelRef.current = channel
    timeoutRef.current = setTimeout(() => resolve('timeout', locale === 'ar'
      ? 'يستغرق وقتاً أطول من المعتاد — تم حفظ تصحيحك وسيُطبق قريباً.'
      : 'Taking longer than usual — your correction is saved and will be applied shortly.'), 90_000)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'submitting' || status === 'waiting') return
    setStatus('submitting')
    setMessage(null)
    setStage(null)
    const fd = new FormData(e.currentTarget)
    // Assemble price_nums from two number inputs
    if (fieldName === 'price_nums') {
      const min = fd.get('_price_min') ?? ''
      const max = fd.get('_price_max') ?? ''
      fd.set('corrected_value', `SAR ${min}–${max}`)
      fd.delete('_price_min')
      fd.delete('_price_max')
    }
    // Assemble primary_audience_gender: validate sum=100, derive enum + display
    if (fieldName === 'primary_audience_gender') {
      const femalePct = Number(fd.get('_female_pct') ?? 50)
      const malePct   = Number(fd.get('_male_pct')   ?? 50)
      if (femalePct + malePct !== 100) {
        setStatus('error')
        setMessage(locale === 'ar'
          ? `المجموع = ${femalePct + malePct}% — يجب أن يكون 100%`
          : `Total = ${femalePct + malePct}% — must equal 100%`)
        return
      }
      const enumVal = femalePct >= 60 ? 'female_skewed' : malePct >= 60 ? 'male_skewed' : 'mixed'
      fd.set('corrected_value', enumVal)
      fd.delete('_female_pct')
      fd.delete('_male_pct')
    }
    startT(async () => {
      await new Promise<void>((resolve) => startRealtimeWatch(resolve))
      const result = await submitBrandCorrection(fd)
      if (!result.ok) {
        if (channelRef.current) { getSupa().removeChannel(channelRef.current); channelRef.current = null }
        setStatus('error')
        setMessage(result.error ?? (locale === 'ar' ? 'فشل الإرسال.' : 'Submission failed.'))
        return
      }
      setStatus('waiting')
    })
  }

  const isBusy = status === 'submitting' || status === 'waiting'
  const stageIdx = stage ? STAGE_ORDER[stage] : -1
  const isAr = locale === 'ar'

  const T = {
    reportLink:      isAr ? 'الإبلاغ عن تصحيح'                                    : 'Report a correction',
    processing:      isAr ? 'جارٍ معالجة التصحيح'                                  : 'Processing correction',
    sending:         isAr ? 'إرسال إلى Pipeline…'                                  : 'Sending to pipeline…',
    applied:         isAr ? 'تم التطبيق على BrandDNA'                              : 'Applied to BrandDNA',
    appliedSub:      isAr ? 'سيتم تحديث الملف الشخصي قريباً'                        : 'Profile will refresh shortly',
    correctValue:    isAr ? 'القيمة الصحيحة'                                       : 'Correct value',
    whyWrong:        isAr ? 'لماذا كانت القيمة السابقة خاطئة؟ (اختياري)'           : 'Why was the previous value wrong? (optional)',
    submit:          isAr ? 'إرسال التصحيح'                                        : 'Submit correction',
    rejected:        isAr ? 'مرفوض: '                                              : 'Rejected: ',
    failed:          isAr ? 'فشل الإرسال.'                                         : 'Submission failed.',
    timeoutMsg:      isAr ? 'تم حفظ التصحيح — انقطع الاتصال المباشر. أعد تحميل الصفحة بعد لحظة للتحقق.' : 'Correction saved — live connection dropped. Reload the page in a moment to verify.',
    timeoutLong:     isAr ? 'يستغرق وقتاً أطول من المعتاد — تم حفظ تصحيحك وسيُطبق قريباً.' : 'Taking longer than usual — your correction is saved and will be applied shortly.',
  }

  return (
    <details ref={detailsRef} className="group" dir={isAr ? 'rtl' : 'ltr'}>
      <summary className="cursor-pointer text-xs font-medium text-(--accent) hover:underline">
        {T.reportLink}
      </summary>

      <div key={formKey} className="mt-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) overflow-hidden">
        {isBusy ? (
          <div className="px-4 py-4 space-y-3">
            <div className="text-xs font-medium text-(--fg-muted) uppercase tracking-wider">{T.processing}</div>
            <div className="flex items-center gap-0">
              {PIPELINE_STEPS.slice(0, 4).map((step, idx) => {
                const done = stageIdx > idx
                const active = stageIdx === idx
                return (
                  <div key={step.stage} className="flex items-center gap-0">
                    <div className={['flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-500 border', done ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-blue-500 bg-blue-500/10 text-blue-400 animate-pulse' : 'border-(--border-subtle) text-(--fg-faint)'].join(' ')}>
                      {done ? '✓' : idx + 1}
                    </div>
                    <div className={['text-[10px] ml-1 mr-2', done ? 'text-emerald-400' : active ? 'text-(--fg)' : 'text-(--fg-faint)'].join(' ')}>{step.label}</div>
                    {idx < 3 && <div className={['w-4 h-px mx-1', done ? 'bg-emerald-500' : 'bg-(--border-subtle)'].join(' ')} />}
                  </div>
                )
              })}
            </div>
            <div className="text-xs text-(--fg-muted)">
              {stage ? PIPELINE_STEPS.find((s) => s.stage === stage)?.sublabel ?? T.sending : T.sending}
            </div>
          </div>
        ) : status === 'written' ? (
          <div className="px-4 py-4 flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-emerald-400">{T.applied}</div>
              <div className="text-xs text-(--fg-muted)">{T.appliedSub}</div>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="p-3 space-y-3" dir={isAr ? 'rtl' : 'ltr'}>
            <input type="hidden" name="brand_id" value={brandId} />
            <input type="hidden" name="field_name" value={fieldName} />
            <input type="hidden" name="current_value" value={currentValue ?? ''} />
            <Field label={T.correctValue} required={fieldName !== 'price_nums'}>
              <FieldInput fieldName={fieldName} currentValue={currentValue} disabled={isBusy} locale={locale} />
            </Field>
            <Field label={T.whyWrong}>
              <Textarea name="reasoning" maxLength={500} rows={2} disabled={isBusy} />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs">
                {status === 'rejected' && <span className="text-(--danger)">{T.rejected}{message}</span>}
                {status === 'timeout'  && <span className="text-(--warning)">{message}</span>}
                {status === 'error'    && <span className="text-(--danger)">{message}</span>}
              </div>
              <Button type="submit" size="sm">{T.submit}</Button>
            </div>
          </form>
        )}
      </div>
    </details>
  )
}
