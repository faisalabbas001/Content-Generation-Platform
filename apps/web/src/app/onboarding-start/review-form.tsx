'use client'

/**
 * Step 3 — Review & confirm + 20-question doc questionnaire.
 *
 * Per OGZ_COMPLETE_SYSTEM_DOCUMENT §3.1 + §3.2 and the Brand DNA Onboarding PDF:
 *
 * SECTION A — CONFIRM (pre-filled from extraction, user corrects):
 *   Brand name AR/EN · Sector · City · Dialect · Colour · Logo
 *
 * SECTION B — THE 20 QUESTIONS (from the PDF/docx)
 *   Questions where extraction CAN auto-fill are shown pre-filled with an
 *   "auto" badge — user confirms or edits.
 *   Questions that extraction CANNOT fill are always blank.
 *
 *   Q01 · Brand name + meaning           → pre-filled (confirm)
 *   Q02 · Products/services list          → user fills (extraction can't know prices)
 *   Q03 · How long in business            → pre-filled from extraction hint
 *   Q04 · Platforms & handles             → pre-filled from IG + seed
 *   Q05 · Five brand words (style sliders)→ user fills
 *   Q06 · Brand references                → user fills
 *   Q07 · Customer lifestyle + description→ partially inferred, user confirms
 *   Q08 · Price position + range          → inferred, user confirms
 *   Q09 · Target emotions + customer quote→ partially inferred
 *   Q10 · Brand persona / archetype       → inferred from content, user confirms
 *   Q11 · Brand soundtrack                → inferred, user confirms
 *   Q12 · Content restrictions            → partially inferred, always ask
 *   Q13 · Language / bilingual ratio      → inferred, confirm + tagline
 *   Q14 · Seasonal moments                → user picks top 3 + custom
 *   Q15 · Competitors (already in Step 1) → show what was seeded
 *   Q16 · Content goal (intent)           → ALWAYS ASK
 *   Q17 · Past content problems           → user fills
 *   Q18 · Founding story + assets         → brief at onboarding (SPEC Step 5)
 *   Q19 · Vision (12 months)              → user picks
 *   Q20 · Anything else                   → open text
 *
 * Layer 2 owner depth (comfort on camera, values, way of speaking,
 * communication style) → dashboard chat tab, NOT collected here.
 * Layer 3/4 (archetype deep, posting rhythm, caption style, permission
 * level, cultural tension) → COO infers and writes via Memory Controller.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { Field, Input, Select, Textarea } from '@repo/ui/input'
import { submitFinal, type FinalResult } from '@/app/actions/onboarding-v2'

// ── ReviewFields interface ────────────────────────────────────────────────────

export interface ReviewFields {
  // Section A — confirm
  brandNameAr: string
  brandNameEn: string
  sector: string
  cityPrimary: string
  dialect: string
  primaryColor: string
  igLogoUrl: string | null
  // Critical fields surfaced in confirm block
  brandDifferentiator: string
  primaryAudienceGender: string   // 'female_skewed' | 'male_skewed' | 'mixed'
  ramadanRelevance: string        // 'High' | 'Medium' | 'Low'
  // Q01
  nameMeaning: string
  // Q02 — structured product list; serialised as "Name — SAR Price\n..." for DB
  productsList: string
  // Internal structured state for Q02 (not submitted directly — serialised into productsList)
  products: Array<{ name: string; price: string }>
  // Q03
  brandAgeBucket: string
  foundingStory: string
  // Q04
  platforms: string[]
  social: string
  // Q05
  brandWords: string[]
  brandWordCustom: string
  // Q06
  brandRefs: string[]
  // Q07
  lifestyle: string
  custDesc: string
  // Q08
  pricePosition: string
  priceNums: string
  // Q09
  emotions: string[]
  custQuote: string
  // Q10 (archetype family — COO fills sub-type)
  archetypeFamily: string
  captionEx: string
  // Q11
  music: string
  musicLink: string
  // Q12 — ALWAYS ASK
  restrictions: string[]
  customRestriction: string
  // Q13
  bilingual: string
  tagline: string
  // Q14
  occasionsRanked: string[]
  customOccasion: string
  // Q15 — shown readonly (seeded in Step 1)
  competitorNames: string
  // Q16 — ALWAYS ASK
  intent: string
  // Q16 metric
  metric: string
  // Q17
  problems: string[]
  // Q18 — ALWAYS ASK (spec Step 5 "first questions")
  religious: string
  // Q19
  vision: string
  visionText: string
  // Q20
  anything: string
  // Business events (spec §3.2 Step 4)
  businessEvents: Array<{ event_type: string; title: string; event_date: string }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RAMADAN     = ['High', 'Medium', 'Low'] as const
const AUDIENCE_GENDER = [
  { v: 'female_skewed', l: 'Mostly women',    d: '70%+ female' },
  { v: 'mixed',         l: 'Mixed audience',  d: 'Roughly equal' },
  { v: 'male_skewed',   l: 'Mostly men',      d: '70%+ male' },
] as const

const SECTORS     = ['F&B', 'Retail', 'Beauty_Wellness', 'Healthcare', 'Finance', 'Government', 'Other'] as const
const SAUDI_CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar', 'Tabuk', 'Abha', 'Other'] as const
const DIALECTS    = ['Najdi', 'Hejazi', 'Gulf', 'MSA_formal', 'MSA_accessible', 'Mixed'] as const
const RELIGIOUS   = ['Low', 'Medium', 'High'] as const
// Q13 options — used inline, not as a named constant
// const BILINGUAL = ['arabic_only', 'arabic_primary', 'balanced', 'english_primary'] as const

// Q05 — 20 brand words (exact from PDF doc)
const BRAND_WORDS = [
  'Warm','Bold','Minimal','Playful','Trusted','Luxury','Raw','Elegant',
  'Loud','Quiet','Honest','Aspirational','Cozy','Sharp','Youthful',
  'Timeless','Local','Global','Rebellious','Refined',
] as const

// Q06 — 30 brand references (exact from PDF doc)
const BRAND_REFS = [
  'Nike','Apple','Zara','Starbucks','H&M','Louis Vuitton','IKEA',"McDonald's",
  'Rolex','Chanel','Adidas','Amazon','Gucci','Lululemon','Dyson','Glossier',
  'Aesop','Dior','Sephora','Bath & Body Works','Noon','Namshi','Jarir',
  'Centrepoint','Carrefour','Panda','Aldo','Shein','Netflix','Samsung',
] as const

// Q07 — lifestyle scenes (exact from PDF doc)
const LIFESTYLE = [
  { v: 'family_home',  e: '🏠', l: 'Family Home Evening',    d: 'Cooking, gathering, warmth' },
  { v: 'coffee_solo',  e: '☕', l: 'Coffee Shop Solo',        d: 'Working, discovering, scrolling' },
  { v: 'mall_friends', e: '🛍', l: 'Mall with Friends',       d: 'Shopping, socialising, trending' },
  { v: 'gym',          e: '💪', l: 'Active & Health-Conscious',d: 'Gym, clean eating, self-care' },
  { v: 'gathering',    e: '🕯', l: 'Home Gathering',           d: 'Hosting, entertaining, sharing' },
  { v: 'outdoor',      e: '🌿', l: 'Outdoor & Adventure',      d: 'Travel, exploration, freedom' },
] as const

// Q08 — price tiers (exact from PDF doc)
const PRICE_TIERS = [
  { v: 'budget',     l: 'Corner Bakery',    d: 'Everyday, accessible — under SAR 30',    t: 'Budget'   },
  { v: 'mid_market', l: 'Café Specialty',   d: 'Quality-conscious — SAR 30–100',          t: 'Mid range'},
  { v: 'premium',    l: 'Boutique Brand',   d: 'Selective, considered — SAR 100–500',     t: 'Premium'  },
  { v: 'luxury',     l: 'Luxury Experience',d: 'Exclusive investment piece — SAR 500+',   t: 'Luxury'   },
] as const

// Q09 — emotions (exact from PDF doc)
const EMOTIONS = [
  'Hungry','Inspired','Reassured','Excited','Proud','Curious',
  'Nostalgic','Impressed','Included','Understood','Motivated','Pampered',
] as const

// Q10 — archetype families (simplified to 4 per PDF; COO fills sub-type)
const ARCHETYPE_FAMILY = [
  { v: 'hero',      l: 'Hero',      d: 'Drive change, prove worth, master a craft' },
  { v: 'caregiver', l: 'Caregiver', d: 'Protect, nurture, serve others' },
  { v: 'explorer',  l: 'Explorer',  d: 'Discover, innovate, push boundaries' },
  { v: 'creator',   l: 'Creator',   d: 'Express, refine, craft beauty' },
] as const

// Q11 — music (exact from PDF doc)
const MUSIC = [
  { v: 'acoustic',  e: '🎸', l: 'Warm Acoustic',          d: 'Intimate, soulful, human'           },
  { v: 'arabic',    e: '🎵', l: 'Arabic Contemporary',     d: 'Cultural, current, local'           },
  { v: 'pop',       e: '✨', l: 'Upbeat Pop',              d: 'Energetic, positive, youthful'      },
  { v: 'cinematic', e: '🎬', l: 'Cinematic Instrumental',  d: 'Elevated, dramatic, premium'        },
  { v: 'lofi',      e: '🌙', l: 'Lo-fi Minimal',           d: 'Calm, clean, thoughtful'            },
  { v: 'energy',    e: '⚡', l: 'High Energy Commercial',  d: 'Bold, fast, attention-grabbing'     },
] as const

// Q12 — restrictions (exact from PDF doc)
const RESTRICTIONS = [
  'Human faces','Alcohol','Pork / Non-halal','Revealing clothing',
  'Western holidays','Competitor brands','Young children',
  'English-only content','AI-looking visuals','Overly polished content',
] as const

// Q14 — occasions (exact from PDF doc)
const OCCASIONS = [
  'Ramadan / Eid Al-Fitr','Eid Al-Adha','Saudi National Day',
  'Founding Day',"Mother's Day",'Back to School',
  "Valentine's Day",'Seasonal Offers',
] as const

// Q16 — content goals (exact from PDF doc)
const GOALS = [
  { v: 'defend',  e: '📦', l: 'Get More Orders',         d: 'Drive direct sales and conversions'       },
  { v: 'grow',    e: '👁', l: 'Build Brand Recognition',  d: 'Make more people know who we are'        },
  { v: 'launch',  e: '🚀', l: 'Launch Something New',     d: 'Introduce a product or location'         },
  { v: 'harvest', e: '❤️', l: 'Grow My Following',        d: 'Build an audience and community online'  },
  { v: 'recover', e: '🏆', l: 'Build Trust & Credibility',d: 'Establish authority in our category'     },
] as const

// Q17 — problems (exact from PDF doc)
const PROBLEMS = [
  'Too generic','Didn\'t match our brand','Too expensive',
  'Inconsistent quality','Took too long','Low engagement',
  'Wrong audience','Never tried before',
] as const

// Q19 — vision (exact from PDF doc)
const VISIONS = [
  { v: 'customers',   e: '🚪', l: 'Doors Always Open',        d: 'More customers, traffic and sales every day' },
  { v: 'recognition', e: '⭐', l: 'Instantly Recognizable',   d: 'People know us just by the look'              },
  { v: 'community',   e: '❤️', l: 'A Real Community',          d: 'Followers who care, share, and return'       },
  { v: 'premium',     e: '💎', l: 'Undeniably Premium',        d: 'A brand that commands respect and price'      },
] as const

// Anti-attributes (tone — always collected)
const ANTI_ATTRIBUTES = [
  { v: 'aggressive',       label: 'Aggressive'        },
  { v: 'western_casual',   label: 'Western casual'    },
  { v: 'flashy',           label: 'Flashy / showy'    },
  { v: 'edgy',             label: 'Edgy'              },
  { v: 'ironic',           label: 'Ironic'            },
  { v: 'formal_corporate', label: 'Formal / corporate'},
  { v: 'casual_humor',     label: 'Casual humor'      },
  { v: 'salesy',           label: 'Salesy / pushy'    },
] as const

// ── Pre-fill type ─────────────────────────────────────────────────────────────

interface PreFill {
  brand_name_en: string | null
  sector_hint: string | null
  dialect_hint: string | null
  primary_color_hex: string | null
  differentiator_seed: string | null
  differentiator_source: string | null
  ig_username: string | null
  ig_full_name: string | null
  ig_profile_pic_url: string | null
  ig_followers_count: number | null
  ig_posts_count_total: number | null
  ig_is_business_account: boolean
  ig_is_verified: boolean
  formatted_address: string | null
  city_hint: string | null
  lifecycle_stage_hint: string | null
  business_category: string | null
  religious_sensitivity: string | null
  tone_anti_attribute_ids: string[]
  price_position: string | null
  bilingual_ratio: string | null
  lifestyle: string | null
  emotions: string[]
  restrictions: string[]
  occasions_ranked: string[]
  archetype_family: string | null
  music: string | null
  goal: string | null
  ig_post_image_urls: string[]
  rating: number | null
  posts_observed_count: number | null
  // Critical-field prefills
  ramadan_relevance: string | null
  audience_female_pct: number | null
  audience_male_pct: number | null
}

interface CompetitorEntry {
  competitor_id: string
  handle_instagram: string
  display_name: string
}

interface ExtractionResponse {
  ok: boolean
  pre_fill?: PreFill
  seed?: { brand_name_ar: string | null; sector: string | null; city_primary: string | null }
  competitors?: CompetitorEntry[]
}

// ── Q02 ProductsInput ─────────────────────────────────────────────────────────

// Sector-smart product name suggestions — shown as quick-add chips
const SECTOR_PRODUCT_SUGGESTIONS: Record<string, string[]> = {
  'F&B':             ['Signature dish', 'Family meal', 'Gift box', 'Catering package', 'Daily special', 'Seasonal item'],
  'Retail':          ['T-shirt', 'Hoodie', 'Accessories set', 'Gift bundle', 'Limited edition', 'Seasonal collection'],
  'Beauty_Wellness': ['Facial treatment', 'Massage session', 'Skincare set', 'Monthly membership', 'Gift voucher', 'Package deal'],
  'Healthcare':      ['Consultation', 'Follow-up visit', 'Lab test', 'Health package', 'Home visit', 'Vaccine'],
  'Education':       ['Course', 'Workshop', 'Private session', 'Study pack', 'Monthly plan', 'Group class'],
  'Real_Estate':     ['Studio apartment', '1-bed unit', 'Villa', 'Commercial space', 'Showroom visit', 'Off-plan unit'],
  'Technology':      ['Starter plan', 'Pro plan', 'Enterprise plan', 'Setup fee', 'Monthly subscription', 'Annual plan'],
  'Finance':         ['Consultation', 'Monthly plan', 'Annual plan', 'Advisory session', 'Package', 'Report'],
}
const FALLBACK_SUGGESTIONS = ['Main product', 'Service package', 'Premium option', 'Starter offer', 'Bundle deal']

interface ProductItem { name: string; price: string }

// Single product chip — displays as a pill, click the price badge to edit it inline
function ProductChip({
  item,
  index,
  onPriceChange,
  onRemove,
}: {
  item: ProductItem
  index: number
  onPriceChange: (index: number, price: string) => void
  onRemove: (index: number) => void
}) {
  const [editing, setEditing] = useState(!item.price) // auto-open editor when price is empty
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    setEditing(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commitEdit() }
  }

  return (
    <div className="inline-flex items-center gap-0 rounded-full border border-(--border) bg-(--bg-subtle) overflow-hidden text-sm">
      {/* Name pill */}
      <span className="px-3 py-1.5 font-medium text-(--fg) leading-none">{item.name}</span>

      {/* Price section — view or edit */}
      {editing ? (
        <div className="flex items-center gap-1 border-l border-(--border) bg-(--bg) px-2 py-1">
          <span className="text-[11px] text-(--fg-muted) font-medium">SAR</span>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
            value={item.price}
            onChange={(e) => onPriceChange(index, e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
            onKeyDown={handleKey}
            onBlur={commitEdit}
            maxLength={10}
            className="w-14 bg-transparent text-sm text-(--fg) text-right focus:outline-none"
            aria-label={`Price for ${item.name}`}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title="Click to edit price"
          className={[
            'flex items-center gap-1 border-l border-(--border) px-2.5 py-1.5 text-xs font-semibold leading-none transition-colors hover:bg-(--accent-soft)',
            item.price ? 'text-(--accent)' : 'text-(--fg-subtle) italic',
          ].join(' ')}
        >
          {item.price ? `SAR ${item.price}` : 'add price'}
        </button>
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="flex h-full items-center px-2 border-l border-(--border) text-(--fg-muted) hover:text-(--danger) hover:bg-(--danger)/8 transition-colors text-sm leading-none"
        aria-label={`Remove ${item.name}`}
      >
        ×
      </button>
    </div>
  )
}

function ProductsInput({
  products,
  onChange,
  sector,
}: {
  products: ProductItem[]
  onChange: (items: ProductItem[]) => void
  sector: string
}) {
  const [name,  setName]   = useState('')
  const [price, setPrice]  = useState('')
  const [open,  setOpen]   = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const suggestions = SECTOR_PRODUCT_SUGGESTIONS[sector] ?? FALLBACK_SUGGESTIONS

  function add() {
    const n = name.trim()
    if (!n) return
    onChange([...products, { name: n, price: price.trim() }])
    setName('')
    setPrice('')
    setOpen(false)
  }

  function openAdd() {
    setOpen(true)
    setTimeout(() => nameRef.current?.focus(), 0)
  }

  function cancel() {
    setName('')
    setPrice('')
    setOpen(false)
  }

  function addSuggestion(suggestion: string) {
    if (products.some(p => p.name.toLowerCase() === suggestion.toLowerCase())) return
    onChange([...products, { name: suggestion, price: '' }])
  }

  function remove(index: number) {
    onChange(products.filter((_, i) => i !== index))
  }

  function updatePrice(index: number, newPrice: string) {
    onChange(products.map((p, i) => i === index ? { ...p, price: newPrice } : p))
  }

  function handleNameKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); add() }
  }

  function handlePriceKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); add() }
  }

  return (
    <div className="space-y-3">
      {/* Chips + inline add trigger — all in one flex-wrap row */}
      <div className="flex flex-wrap gap-2 items-center">
        {products.map((item, i) => (
          <ProductChip
            key={i}
            item={item}
            index={i}
            onPriceChange={updatePrice}
            onRemove={remove}
          />
        ))}

        {/* + Add trigger or expanded entry — lives inline with the chips */}
        {open ? (
          <div className="flex items-center gap-1.5 rounded-full border border-(--accent) bg-(--bg) pl-3 pr-1.5 py-1">
            <input
              ref={nameRef}
              type="text"
              dir="auto"
              placeholder="Name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleNameKey}
              maxLength={80}
              className="w-32 bg-transparent text-sm text-(--fg) placeholder:text-(--fg-subtle) focus:outline-none"
            />
            <span className="text-xs text-(--fg-muted) shrink-0">SAR</span>
            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              placeholder="0"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
              onKeyDown={handlePriceKey}
              maxLength={10}
              className="w-12 bg-transparent text-sm text-(--fg) text-right placeholder:text-(--fg-subtle) focus:outline-none"
              aria-label="Price in SAR"
            />
            <button
              type="button"
              onClick={add}
              disabled={!name.trim()}
              className="rounded-full bg-(--accent) px-2.5 py-0.5 text-xs font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
            >
              Add
            </button>
            <button
              type="button"
              onClick={cancel}
              className="flex h-5 w-5 items-center justify-center rounded-full text-(--fg-muted) hover:bg-(--border) hover:text-(--fg) transition-colors text-sm leading-none"
              aria-label="Cancel"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-1 rounded-full border border-dashed border-(--border) px-3 py-1.5 text-xs font-medium text-(--fg-muted) hover:border-(--accent) hover:text-(--accent) transition-colors"
          >
            <span className="text-sm leading-none font-bold">+</span> Add product
          </button>
        )}
      </div>

      {/* Quick-add sector suggestions */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-(--fg-subtle) uppercase tracking-wide font-medium">Quick add</p>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => {
            const already = products.some(p => p.name.toLowerCase() === s.toLowerCase())
            return (
              <button
                key={s}
                type="button"
                onClick={() => addSuggestion(s)}
                disabled={already}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  already
                    ? 'border-(--accent)/40 bg-(--accent-soft) text-(--accent) cursor-default'
                    : 'border-(--border) text-(--fg-muted) hover:border-(--accent) hover:text-(--fg)',
                ].join(' ')}
              >
                {already ? '✓ ' : '+ '}{s}
              </button>
            )
          })}
        </div>
      </div>

      {products.length === 0 && !open && (
        <p className="text-xs text-(--fg-subtle) italic">
          Click &ldquo;+ Add product&rdquo; or use Quick add below. Tap any chip&apos;s price to edit it.
        </p>
      )}
    </div>
  )
}

// ── Q08b PriceRangeInput ───────────────────────────────────────────────────────
// Replaces the free-text "SAR 15 (coffee) → SAR 280" input with two structured
// fields that serialise to the same "SAR X – SAR Y" format the DB expects.

function PriceRangeInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  // Parse existing value back into from/to on mount
  const parse = (v: string) => {
    const m = v.match(/SAR\s*(\d[\d.,]*)\s*[-–—]\s*SAR\s*(\d[\d.,]*)/i)
    if (m) return { from: m[1]!, to: m[2]! }
    const single = v.match(/SAR\s*(\d[\d.,]*)/i)
    if (single) return { from: single[1]!, to: '' }
    return { from: '', to: '' }
  }
  const parsed = parse(value)
  const [from, setFrom] = useState(parsed.from)
  const [to,   setTo]   = useState(parsed.to)

  function emit(f: string, t: string) {
    const parts = [f && `SAR ${f}`, t && `SAR ${t}`].filter(Boolean)
    onChange(parts.length === 2 ? parts.join(' – ') : parts[0] ?? '')
  }

  const clean = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 flex-1 rounded-(--r-md) border border-(--border) bg-(--bg) px-3 py-2">
        <span className="text-xs text-(--fg-muted) shrink-0">SAR</span>
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          placeholder="Lowest price"
          value={from}
          maxLength={10}
          onChange={(e) => { const v = clean(e.target.value); setFrom(v); emit(v, to) }}
          className="flex-1 bg-transparent text-sm text-(--fg) placeholder:text-(--fg-subtle) focus:outline-none"
          aria-label="Lowest price in SAR"
        />
      </div>
      <span className="text-(--fg-muted) text-sm shrink-0">to</span>
      <div className="flex items-center gap-1.5 flex-1 rounded-(--r-md) border border-(--border) bg-(--bg) px-3 py-2">
        <span className="text-xs text-(--fg-muted) shrink-0">SAR</span>
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          placeholder="Highest price"
          value={to}
          maxLength={10}
          onChange={(e) => { const v = clean(e.target.value); setTo(v); emit(from, v) }}
          className="flex-1 bg-transparent text-sm text-(--fg) placeholder:text-(--fg-subtle) focus:outline-none"
          aria-label="Highest price in SAR"
        />
      </div>
    </div>
  )
}

// ── Q06 CustomBrandInput ──────────────────────────────────────────────────────
function CustomBrandInput({ onAdd, disabled }: { onAdd: (name: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    const name = value.trim()
    if (!name || disabled) return
    onAdd(name)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        dir="auto"
        placeholder="Type a brand name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        disabled={disabled}
        maxLength={50}
        className="flex-1 rounded-(--r-md) border border-dashed border-(--border) bg-(--bg) px-3 py-1.5 text-sm text-(--fg) placeholder:text-(--fg-subtle) focus:outline-none focus:ring-2 focus:ring-(--accent)/40 disabled:opacity-40"
      />
      <button
        type="button"
        onClick={commit}
        disabled={!value.trim() || disabled}
        className="rounded-(--r-md) border border-(--accent) px-3 py-1.5 text-xs font-semibold text-(--accent) hover:bg-(--accent-soft) disabled:opacity-40 transition-colors shrink-0"
      >
        + Add
      </button>
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ReviewFormProps {
  brand_id: string
  savedFields: ReviewFields
  onFieldChange: (fields: ReviewFields) => void
  onBack: () => void
}

// ── Inline field error hint ───────────────────────────────────────────────────
function FieldErrorHint({ show, label }: { show: boolean; label: string }) {
  if (!show) return null
  return (
    <p className="flex items-center gap-1 text-xs text-(--danger) mt-1 animate-in fade-in duration-150">
      <span>⚠</span> {label} is required
    </p>
  )
}

// ── Q block — defined at module scope so its identity is stable across renders ─
function Q({ n, title, sub, children, error }: { n: string; title: string; sub?: string; children: React.ReactNode; error?: boolean }) {
  return (
    <div className={['space-y-3 rounded-(--r-md) transition-colors', error ? 'ring-1 ring-(--danger)/40 bg-(--danger)/5 p-3 -mx-3' : ''].join(' ')}>
      <div>
        <p className="text-xs font-semibold text-(--fg-muted) uppercase tracking-wide">{n}</p>
        <h3 className={['text-base font-semibold', error ? 'text-(--danger)' : 'text-(--fg)'].join(' ')}>{title}</h3>
        {sub && <p className="text-xs text-(--fg-muted)">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReviewForm({ brand_id, savedFields, onFieldChange, onBack }: ReviewFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Field-level errors shown inline after a failed Continue attempt
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set())
  const [pre, setPre] = useState<PreFill | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [antiAttrs, setAntiAttrs] = useState<Set<string>>(new Set())
  const [igPostImageUrls, setIgPostImageUrls] = useState<string[]>([])
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  // Q18 — extra brand asset files (up to 10)
  const [assetFiles, setAssetFiles] = useState<File[]>([])
  const assetInputRef = useRef<HTMLInputElement>(null)
  // ── Chapter stepper state — MUST be here before any early return ──
  const [chapter, setChapter] = useState(1)
  const [maxReached, setMaxReached] = useState(1)
  const formTopRef = useRef<HTMLDivElement>(null)

  // All controlled state
  const [brandNameAr,   setBrandNameAr]   = useState(savedFields.brandNameAr)
  const [brandNameEn,   setBrandNameEn]   = useState(savedFields.brandNameEn)
  const [sector,        setSector]        = useState(savedFields.sector)
  const [city,          setCity]          = useState(savedFields.cityPrimary)
  const [dialect,       setDialect]       = useState(savedFields.dialect)
  const [color,         setColor]         = useState(savedFields.primaryColor || '#10b981')
  const [igLogoUrl,     setIgLogoUrl]     = useState<string | null>(savedFields.igLogoUrl)
  // Critical fields in confirm block
  const [brandDifferentiator,   setBrandDifferentiator]   = useState(savedFields.brandDifferentiator ?? '')
  const [primaryAudienceGender, setPrimaryAudienceGender] = useState(savedFields.primaryAudienceGender ?? '')
  const [ramadanRelevance,      setRamadanRelevance]      = useState(savedFields.ramadanRelevance ?? '')
  const [nameMeaning,   setNameMeaning]   = useState(savedFields.nameMeaning)
  const [productsList,  setProductsList]  = useState(savedFields.productsList)
  // Q02 — parse any pre-existing productsList text back into structured items
  const [products, setProducts] = useState<ProductItem[]>(() => {
    if (savedFields.products?.length) return savedFields.products
    const raw = savedFields.productsList ?? ''
    if (!raw.trim()) return []
    return raw.split('\n').map(line => {
      const match = line.match(/^(.+?)\s*[—\-–]\s*(?:SAR\s*)?(\d[\d.,]*)?\s*$/i)
      if (match) return { name: match[1].trim(), price: match[2]?.trim() ?? '' }
      return { name: line.trim(), price: '' }
    }).filter(p => p.name)
  })
  const [brandAgeBucket,setBrandAgeBucket]= useState(savedFields.brandAgeBucket)
  const [foundingStory, setFoundingStory] = useState(savedFields.foundingStory)
  const [platforms,     setPlatforms]     = useState<Set<string>>(new Set(savedFields.platforms ?? []))
  const [social,        setSocial]        = useState(savedFields.social ?? '')
  const [brandWords,    setBrandWords]    = useState<Set<string>>(new Set(savedFields.brandWords ?? []))
  const [brandWordCustom, setBrandWordCustom] = useState(savedFields.brandWordCustom ?? '')
  const [brandRefs,     setBrandRefs]     = useState<Set<string>>(new Set(savedFields.brandRefs ?? []))
  const [lifestyle,     setLifestyle]     = useState(savedFields.lifestyle)
  const [custDesc,      setCustDesc]      = useState(savedFields.custDesc)
  const [pricePosition, setPricePosition] = useState(savedFields.pricePosition)
  const [priceNums,     setPriceNums]     = useState(savedFields.priceNums)
  const [emotions,      setEmotions]      = useState<Set<string>>(new Set(savedFields.emotions ?? []))
  const [custQuote,     setCustQuote]     = useState(savedFields.custQuote)
  const [archetypeFamily, setArchetypeFamily] = useState(savedFields.archetypeFamily)
  const [captionEx,     setCaptionEx]     = useState(savedFields.captionEx)
  const [music,         setMusic]         = useState(savedFields.music)
  const [musicLink,     setMusicLink]     = useState(savedFields.musicLink)
  const [restrictions,  setRestrictions]  = useState<Set<string>>(new Set(savedFields.restrictions ?? []))
  const [customRestriction, setCustomRestriction] = useState(savedFields.customRestriction)
  const [bilingual,     setBilingual]     = useState(savedFields.bilingual)
  const [tagline,       setTagline]       = useState(savedFields.tagline)
  const [occasionsRanked, setOccasionsRanked] = useState<string[]>(savedFields.occasionsRanked ?? [])
  const [customOccasion,  setCustomOccasion]  = useState(savedFields.customOccasion ?? '')
  const [intent,        setIntent]        = useState(savedFields.intent)
  const [metric,        setMetric]        = useState(savedFields.metric)
  const [problems,      setProblems]      = useState<Set<string>>(new Set(savedFields.problems ?? []))
  const [religious,     setReligious]     = useState(savedFields.religious)
  const [vision,        setVision]        = useState(savedFields.vision)
  const [visionText,    setVisionText]    = useState(savedFields.visionText)
  const [anything,      setAnything]      = useState(savedFields.anything)
  const [businessEvents, setBusinessEvents] = useState(savedFields.businessEvents ?? [])
  // Q15 — competitor handles loaded from competitor_accounts (seeded in Step 1)
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([])
  const [newCompetitor, setNewCompetitor] = useState('')

  // Snapshot current state into a ReviewFields object — called only on chapter
  // navigation so the parent can restore if the user goes back to step 1.
  // NOT called on every keystroke (that caused parent re-render → scroll reset).
  const onFieldChangeRef = useRef(onFieldChange)
  useEffect(() => { onFieldChangeRef.current = onFieldChange })

  const snapshotFields = useRef<() => ReviewFields>(() => ({
    brandNameAr: '', brandNameEn: '', sector: '', cityPrimary: '', dialect: '',
    primaryColor: '#10b981', igLogoUrl: null,
    brandDifferentiator: '', primaryAudienceGender: '', ramadanRelevance: '',
    nameMeaning: '', productsList: '', products: [], brandAgeBucket: '', foundingStory: '',
    platforms: [], social: '', brandWords: [], brandWordCustom: '', brandRefs: [],
    lifestyle: '', custDesc: '', pricePosition: '', priceNums: '',
    emotions: [], custQuote: '', archetypeFamily: '', captionEx: '',
    music: '', musicLink: '', restrictions: [], customRestriction: '',
    bilingual: '', tagline: '', occasionsRanked: [], customOccasion: '',
    competitorNames: '', intent: '', metric: '', problems: [], religious: '',
    vision: '', visionText: '', anything: '', businessEvents: [],
  }))

  // Keep snapshot fn up-to-date with latest closure values without triggering renders
  useEffect(() => {
    snapshotFields.current = () => ({
      brandNameAr, brandNameEn, sector, cityPrimary: city, dialect,
      primaryColor: color, igLogoUrl,
      brandDifferentiator, primaryAudienceGender, ramadanRelevance,
      nameMeaning, productsList, products, brandAgeBucket, foundingStory,
      platforms: [...platforms], social,
      brandWords: [...brandWords], brandWordCustom,
      brandRefs: [...brandRefs],
      lifestyle, custDesc, pricePosition, priceNums,
      emotions: [...emotions], custQuote,
      archetypeFamily, captionEx, music, musicLink,
      restrictions: [...restrictions], customRestriction,
      bilingual, tagline, occasionsRanked, customOccasion,
      competitorNames: '', intent, metric,
      problems: [...problems], religious,
      vision, visionText, anything, businessEvents,
    })
  })

  // Load extraction pre-fill on mount
  useEffect(() => {
    let cancel = false
    void (async () => {
      try {
        const res = await fetch(`/api/onboarding/extraction-status/${brand_id}`, { cache: 'no-store' })
        if (!res.ok || cancel) { setLoaded(true); return }
        const json = (await res.json()) as ExtractionResponse
        if (cancel) return
        const p = json.pre_fill ?? null
        setPre(p)
        if (p) {
          if (!brandNameEn && p.brand_name_en)        setBrandNameEn(p.brand_name_en)
          if (!dialect     && p.dialect_hint)          setDialect(p.dialect_hint)
          if ((!color || color === '#10b981') && p.primary_color_hex) setColor(p.primary_color_hex)
          if (!religious   && p.religious_sensitivity) setReligious(p.religious_sensitivity)
          if (!igLogoUrl   && p.ig_profile_pic_url)    setIgLogoUrl(p.ig_profile_pic_url)
          if (!pricePosition && p.price_position)      setPricePosition(p.price_position)
          if (!bilingual   && p.bilingual_ratio)       setBilingual(p.bilingual_ratio)
          if (!lifestyle   && p.lifestyle)             setLifestyle(p.lifestyle)
          if (!archetypeFamily && p.archetype_family)  setArchetypeFamily(p.archetype_family)
          if (!music       && p.music)                 setMusic(p.music)
          if (!intent      && p.goal)                  setIntent(p.goal)
          if (emotions.size === 0 && p.emotions?.length) {
            const known = (p.emotions as string[]).filter((e) => (EMOTIONS as readonly string[]).includes(e))
            setEmotions(new Set(known.slice(0, 3)))
          }
          if (restrictions.size === 0 && p.restrictions?.length) setRestrictions(new Set(p.restrictions))
          if (occasionsRanked.length === 0 && p.occasions_ranked?.length) {
            const known = (p.occasions_ranked as string[]).filter((o) => (OCCASIONS as readonly string[]).includes(o))
            setOccasionsRanked(known.slice(0, 3))
          }
          if (antiAttrs.size === 0 && p.tone_anti_attribute_ids?.length) setAntiAttrs(new Set(p.tone_anti_attribute_ids))
          if (igPostImageUrls.length === 0 && p.ig_post_image_urls?.length) setIgPostImageUrls(p.ig_post_image_urls)
          if (platforms.size === 0 && p.ig_username) setPlatforms(new Set(['Instagram']))
          // Critical confirm-block fields
          if (!brandDifferentiator && p.differentiator_seed) setBrandDifferentiator(p.differentiator_seed)
          if (!ramadanRelevance && p.ramadan_relevance) setRamadanRelevance(p.ramadan_relevance)
          if (!primaryAudienceGender) {
            const female = p.audience_female_pct ?? null
            const male   = p.audience_male_pct   ?? null
            if (female != null && male != null) {
              if (female >= 65) setPrimaryAudienceGender('female_skewed')
              else if (male >= 65) setPrimaryAudienceGender('male_skewed')
              else setPrimaryAudienceGender('mixed')
            }
          }
          if (!social && p.ig_username) setSocial(`@${p.ig_username}`)
          if (!brandAgeBucket && p.lifecycle_stage_hint) {
            const map: Record<string, string> = {
              pre_launch: 'launch', launch: 'launch', growth: 'growth',
              maturity: 'established', recovery: 'mature',
            }
            setBrandAgeBucket(map[p.lifecycle_stage_hint] ?? '')
          }
        }
        if (json.competitors?.length) setCompetitors(json.competitors)
        const savedAr = json.seed?.brand_name_ar ?? null
        if (!brandNameAr && savedAr) setBrandNameAr(savedAr)
        else if (!brandNameAr && p?.ig_full_name && /[؀-ۿ]/.test(p.ig_full_name)) setBrandNameAr(p.ig_full_name)
        if (!sector && json.seed?.sector) setSector(json.seed.sector)
        else if (!sector && p?.sector_hint) setSector(p.sector_hint)
        if (!city && json.seed?.city_primary) setCity(json.seed.city_primary)
        else if (!city && p?.city_hint) setCity(p.city_hint)
      } catch { /* keep defaults */ }
      finally { if (!cancel) setLoaded(true) }
    })()
    return () => { cancel = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand_id])

  // Toggle helpers
  const toggleSet = (set: Set<string>, val: string, setter: (s: Set<string>) => void, max?: number) => {
    const next = new Set(set)
    if (next.has(val)) { next.delete(val); setter(next) }
    else if (!max || next.size < max) { next.add(val); setter(next) }
  }
  const toggleOccasion = (occ: string) => {
    setOccasionsRanked((prev) => {
      if (prev.includes(occ)) return prev.filter((o) => o !== occ)
      if (prev.length >= 3) return prev
      return [...prev, occ]
    })
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const missing: string[] = []
    if (!brandNameAr.trim())             missing.push('Brand name (Arabic)')
    if (!sector)                         missing.push('Sector')
    if (!city)                           missing.push('City')
    if (!dialect)                        missing.push('Arabic dialect')
    if (!brandDifferentiator.trim())     missing.push('What makes you different')
    if (!primaryAudienceGender)          missing.push('Primary audience')
    if (!ramadanRelevance)               missing.push('Ramadan relevance')
    if (!brandAgeBucket)                 missing.push('How long in business')
    if (platforms.size === 0)            missing.push('Platforms (Q04)')
    if (!pricePosition)                  missing.push('Price position')
    if (!archetypeFamily)                missing.push('Brand persona (Q10)')
    if (antiAttrs.size === 0)            missing.push('Brand anti-attributes (Q12b)')
    if (!bilingual)                      missing.push('Language / bilingual ratio')
    if (!religious)                      missing.push('Religious sensitivity')
    if (!intent)                         missing.push('Content goal')
    if (missing.length > 0) { setError(`Please fill in: ${missing.join(', ')}`); return }

    const fd = new FormData()
    fd.set('brand_id',              brand_id)
    fd.set('brand_name_ar',         brandNameAr)
    fd.set('brand_name_en',         brandNameEn)
    fd.set('sector',                sector)
    fd.set('city_primary',          city)
    fd.set('arabic_dialect',        dialect)
    fd.set('primary_color_hex',     color)
    fd.set('religious_sensitivity', religious)
    fd.set('intent_state',          intent)
    fd.set('ig_logo_url',           igLogoUrl ?? '')
    fd.set('business_events_json',  JSON.stringify(businessEvents))
    // Critical fields from confirm block
    if (brandDifferentiator.trim()) fd.set('brand_differentiator', brandDifferentiator.trim())
    if (primaryAudienceGender)      fd.set('primary_audience_gender', primaryAudienceGender)
    if (ramadanRelevance)           fd.set('ramadan_relevance', ramadanRelevance)

    // Anti-attributes
    for (const v of antiAttrs) fd.append('tone_anti_attribute_ids', v)

    // Lifecycle inferred from extraction
    if (brandAgeBucket) fd.set('lifecycle', brandAgeBucket)

    // Q01
    if (nameMeaning) fd.set('name_meaning', nameMeaning)

    // Q02 — serialise structured product items into "Name — SAR Price\n..." string
    const serialisedProducts = products
      .map(p => p.price ? `${p.name} — SAR ${p.price}` : p.name)
      .join('\n')
    if (serialisedProducts) {
      fd.set('products_list', serialisedProducts)
      setProductsList(serialisedProducts)
    }

    // Q03
    if (foundingStory)  fd.set('founding_story', foundingStory)

    // Q04
    for (const v of platforms) fd.append('platforms', v)
    if (social) fd.set('social', social)

    // Q05 — brand words stored in anything field for COO to parse
    const words = [...brandWords]
    if (brandWordCustom) words.push(brandWordCustom)
    // Q06 — brand refs sent as dedicated field so DB column is populated
    const refs = [...brandRefs]
    if (refs.length) fd.set('brand_refs', refs.join(', '))

    // Q07
    if (lifestyle) fd.set('lifestyle', lifestyle)
    if (custDesc)  fd.set('cust_desc', custDesc)

    // Q08
    if (pricePosition) fd.set('price_position', pricePosition)
    if (priceNums)     fd.set('price_nums', priceNums)

    // Q09
    for (const v of emotions) fd.append('emotions', v)
    if (custQuote)     fd.set('cust_quote', custQuote)

    // Q10
    if (archetypeFamily) fd.set('archetype_family', archetypeFamily)
    if (captionEx)       fd.set('caption_ex', captionEx)

    // Q11
    if (music)     fd.set('music', music)
    if (musicLink) fd.set('music_link', musicLink)

    // Q12
    for (const v of restrictions) fd.append('restrictions', v)
    if (customRestriction) fd.set('custom_restriction', customRestriction)

    // Q13
    if (bilingual) fd.set('bilingual_ratio', bilingual)
    if (tagline)   fd.set('tagline', tagline)

    // Q14
    for (const v of occasionsRanked) fd.append('occasions_ranked', v)
    if (customOccasion) fd.set('custom_occasion', customOccasion)

    // Q16
    if (metric) fd.set('metric', metric)
    // Q16 — goal key matches DB enum comment: orders|awareness|launch|community|trust
    // Map the intent enum to the goal key the DB column expects
    const INTENT_TO_GOAL: Record<string, string> = {
      defend:  'orders',
      grow:    'awareness',
      launch:  'launch',
      harvest: 'community',
      recover: 'trust',
    }
    const goalKey = INTENT_TO_GOAL[intent]
    if (goalKey) fd.set('goal', goalKey)

    // Q17
    for (const v of problems) fd.append('problems', v)

    // Q19
    if (vision)     fd.set('vision', vision)
    if (visionText) fd.set('vision_text', visionText)

    // Q20 — combine brand words and free-text into anything
    // (brand_refs sent separately above as brand_refs column)
    const combinedAnything = [
      words.length ? `Brand words: ${words.join(', ')}` : '',
      anything     ? anything : '',
    ].filter(Boolean).join('\n')
    if (combinedAnything) fd.set('anything', combinedAnything)

    // Logo
    const logoInput = e.currentTarget.querySelector('input[name="logo"]') as HTMLInputElement | null
    const logoFile = logoInput?.files?.[0]
    if (logoFile) fd.set('logo', logoFile)

    // IG post images (hidden inputs — server uploads to Storage)
    for (const url of igPostImageUrls) fd.append('ig_post_image_url', url)

    // Extra brand asset files from the Q18 dropzone
    for (const file of assetFiles) fd.append('brand_assets', file)

    startTransition(async () => {
      const r: FinalResult = await submitFinal(fd)
      if (!r.ok) { setError(r.error ?? 'Submission failed'); return }
      if (r.redirect_to) router.push(r.redirect_to)
    })
  }

  // Compute live completeness across the 12 critical fields. useMemo so a chip
  // click on Q17 (problems) doesn't trigger a full re-render of the sticky bar.
  // MUST be before any early return to satisfy the Rules of Hooks.
  const completenessScore = useMemo(() => {
    const filled = [
      // Ch1
      !!brandNameAr.trim(), !!sector, !!city, !!dialect,
      !!brandDifferentiator.trim(), !!primaryAudienceGender, !!ramadanRelevance,
      !!brandAgeBucket, platforms.size > 0,
      // Ch2
      brandWords.size > 0, !!lifestyle, !!pricePosition, emotions.size > 0,
      // Ch3
      !!archetypeFamily, !!music, restrictions.size > 0, antiAttrs.size > 0,
      !!bilingual, occasionsRanked.length > 0,
      // Ch4
      !!intent, !!religious,
      // Ch5
      !!vision,
    ]
    return Math.round((filled.filter(Boolean).length / filled.length) * 100)
  }, [brandNameAr, sector, city, dialect, brandDifferentiator, primaryAudienceGender,
      ramadanRelevance, brandAgeBucket, platforms, brandWords, lifestyle, pricePosition,
      emotions, archetypeFamily, music, restrictions, antiAttrs, bilingual,
      occasionsRanked, intent, religious, vision])

  if (!loaded) {
    return (
      <div className="flex min-h-50 flex-col items-center justify-center gap-3 text-sm text-(--fg-muted)">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-(--accent) border-t-transparent" />
        <p>Loading what we found about your brand…</p>
      </div>
    )
  }

  const auto = (note?: string) => (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-(--accent-soft) px-2 py-0.5 text-[10px] font-semibold text-(--accent)"
      title={note ?? 'Auto-detected from your sources'}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-(--accent)" />
      auto
    </span>
  )

  const chip = (label: string, active: boolean, onClick: () => void, danger = false) => (
    <button
      key={label} type="button" onClick={onClick} aria-pressed={active}
      className={[
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? danger
            ? 'border-(--danger)/60 bg-(--danger)/10 text-(--danger)'
            : 'border-(--accent) bg-(--accent) text-(--accent-fg)'
          : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)',
      ].join(' ')}
    >
      {label}
    </button>
  )

  const CHAPTERS = [
    { id: 1, label: 'Foundation',   sub: 'Who you are',           color: '#C9A84C' },
    { id: 2, label: 'The Feel',     sub: 'Aesthetic & mood',      color: '#7C6AF5' },
    { id: 3, label: 'The Voice',    sub: 'How you communicate',   color: '#E5667A' },
    { id: 4, label: 'The Business', sub: 'Market & goals',        color: '#3DB88A' },
    { id: 5, label: 'The Vision',   sub: 'Where you\'re going',   color: '#A78BFA' },
  ] as const

  const currentChapter = CHAPTERS.find((c) => c.id === chapter)!

  // ── Reactive required-field map — tells us exactly which fields are missing
  // per chapter so we can: (a) show inline errors, (b) badge the Continue button,
  // (c) mark chapter pills complete/incomplete.
  const REQUIRED: Record<number, Array<{ key: string; label: string; missing: boolean }>> = {
    1: [
      { key: 'brandNameAr',         label: 'Brand name (Arabic)',             missing: !brandNameAr.trim() },
      { key: 'sector',              label: 'Sector',                          missing: !sector },
      { key: 'city',                label: 'City',                            missing: !city },
      { key: 'dialect',             label: 'Arabic dialect',                  missing: !dialect },
      { key: 'brandDifferentiator', label: 'What makes you different',        missing: !brandDifferentiator.trim() },
      { key: 'primaryAudienceGender',label: 'Primary audience',               missing: !primaryAudienceGender },
      { key: 'ramadanRelevance',    label: 'Ramadan relevance',               missing: !ramadanRelevance },
      { key: 'brandAgeBucket',      label: 'How long in business',            missing: !brandAgeBucket },
      { key: 'platforms',           label: 'Where your audience finds you',   missing: platforms.size === 0 },
    ],
    2: [
      { key: 'brandWords',          label: 'Five brand words (Q05)',          missing: brandWords.size === 0 },
      { key: 'lifestyle',           label: 'Customer lifestyle (Q07)',         missing: !lifestyle },
      { key: 'pricePosition',       label: 'Price position (Q08)',             missing: !pricePosition },
      { key: 'emotions',            label: 'Emotions to evoke (Q09)',          missing: emotions.size === 0 },
    ],
    3: [
      { key: 'archetypeFamily',     label: 'Brand persona (Q10)',              missing: !archetypeFamily },
      { key: 'music',               label: 'Brand soundtrack (Q11)',           missing: !music },
      { key: 'restrictions',        label: 'Content restrictions (Q12)',       missing: restrictions.size === 0 },
      { key: 'antiAttrs',           label: 'Never sound like (Q12b)',          missing: antiAttrs.size === 0 },
      { key: 'bilingual',           label: 'Language ratio (Q13)',             missing: !bilingual },
      { key: 'occasionsRanked',     label: 'Seasonal moments (Q14)',           missing: occasionsRanked.length === 0 },
    ],
    4: [
      { key: 'intent',              label: 'Main content goal (Q16)',          missing: !intent },
      { key: 'religious',           label: 'Religious sensitivity (Q16b)',     missing: !religious },
    ],
    5: [
      { key: 'vision',              label: 'Success vision (Q19)',             missing: !vision },
    ],
  }

  const currentMissing = REQUIRED[chapter]?.filter((f) => f.missing) ?? []
  const currentMissingKeys = new Set(currentMissing.map((f) => f.key))
  const isCurrentChapterValid = currentMissing.length === 0

  // Per-chapter completion for pills — only check chapters that have been reached
  const chapterComplete = (id: number) =>
    id <= maxReached && (REQUIRED[id]?.every((f) => !f.missing) ?? true)

  // Clear a field's inline error as soon as the user fills it
  function clearFieldError(key: string) {
    if (fieldErrors.has(key)) {
      setFieldErrors((prev) => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  function syncToParent() {
    onFieldChangeRef.current(snapshotFields.current())
  }

  function goNext() {
    if (!isCurrentChapterValid) {
      // Mark all missing fields so they show inline errors
      setFieldErrors(currentMissingKeys)
      setError(null) // clear old bottom error — inline errors take over
      // Scroll to the top so user sees the highlighted fields
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setFieldErrors(new Set())
    setError(null)
    if (chapter < 5) {
      syncToParent()
      setMaxReached((m) => Math.max(m, chapter + 1))
      setChapter((c) => c + 1)
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
  function goPrev() {
    setError(null)
    syncToParent()
    if (chapter > 1) {
      setChapter((c) => c - 1)
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      onBack()
    }
  }

  return (
    <form onSubmit={onSubmit} encType="multipart/form-data" noValidate className="space-y-0">
      <div ref={formTopRef} aria-hidden="true" style={{ scrollMarginTop: '0px' }} />

      {/* ── Hidden IG post image URLs (always present) ──────────────── */}
      {igPostImageUrls.map((url, i) => <input key={i} type="hidden" name="ig_post_image_url" value={url} />)}

      {/* ── Sticky chapter progress bar ─────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-(--surface-1)/95 backdrop-blur-sm border-b border-(--border-subtle) px-0 pb-3 pt-2 -mx-1 mb-6">
        {/* Progress track */}
        <div className="h-1 bg-(--surface-3) rounded-full overflow-hidden mb-3">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${completenessScore}%`, backgroundColor: currentChapter.color }}
          />
        </div>
        {/* Chapter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar px-1">
          {CHAPTERS.map((ch) => {
            const isActive    = chapter === ch.id
            const isLocked    = ch.id > maxReached
            const isDone      = !isActive && chapterComplete(ch.id)
            const isIncomplete = !isActive && !isLocked && !isDone
            return (
              <button
                key={ch.id} type="button"
                onClick={() => {
                  if (isLocked) return
                  syncToParent(); setChapter(ch.id); setFieldErrors(new Set()); formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className={[
                  'shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-all border',
                  isActive
                    ? 'text-black border-transparent'
                    : isLocked
                      ? 'border-(--border-subtle) text-(--fg-faint) cursor-not-allowed opacity-40'
                      : isDone
                        ? 'border-(--success)/50 text-(--success) hover:border-(--success)'
                        : 'border-(--warning)/60 text-(--warning) hover:border-(--warning)',
                ].join(' ')}
                style={isActive ? { backgroundColor: ch.color } : {}}
                title={isLocked ? 'Complete earlier chapters first' : isDone ? 'Complete' : isIncomplete ? 'Required fields missing' : ''}
              >
                {/* Completion indicator */}
                {!isActive && !isLocked && (
                  <span className="text-[10px] leading-none">
                    {isDone ? '✓' : '!'}
                  </span>
                )}
                {ch.label}
              </button>
            )
          })}
        </div>
        {/* Chapter subtitle */}
        <div className="mt-1.5 px-1">
          <p className="text-xs text-(--fg-muted)">{currentChapter.sub}</p>
        </div>
      </div>

      {/* ── Auto-detected summary card (shown on Ch1 only) ──────────── */}

      {/* ── Auto-detected summary (Ch1 only) ─────────────────────── */}
      {chapter === 1 && pre && (pre.ig_full_name || pre.ig_username || pre.formatted_address) && (
        <div className="rounded-(--r-md) border border-(--accent)/30 bg-(--accent-soft)/20 p-3 flex items-center gap-3 mb-4">
          {pre.ig_profile_pic_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pre.ig_profile_pic_url} alt="IG" referrerPolicy="no-referrer" loading="lazy"
              className="h-9 w-9 shrink-0 rounded-full border border-(--border-subtle) object-cover"
              onError={(e) => {
                const el = e.currentTarget as HTMLImageElement
                if (!el.src.includes('/api/img-proxy')) el.src = `/api/img-proxy?u=${encodeURIComponent(pre.ig_profile_pic_url!)}`
                else el.style.display = 'none'
              }} />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-(--accent)">Found from your Instagram</p>
            <p className="text-xs text-(--fg-muted) truncate">
              {[pre.ig_username && `@${pre.ig_username}`, pre.ig_followers_count != null && `${formatCount(pre.ig_followers_count)} followers`, pre.business_category].filter(Boolean).join(' · ')}
            </p>
          </div>
          <span className="ml-auto shrink-0 text-[10px] text-(--fg-muted) font-mono">Fields with <span className="text-(--accent) font-bold">auto</span> were pre-filled</span>
        </div>
      )}

      {/* ── CHAPTER CONTENT ──────────────────────────────────────── */}
      <div className="space-y-6">

        {/* ══ CHAPTER 1 — FOUNDATION ══ */}
        {chapter === 1 && <>

          {/* ── No social history callout ──────────────────────────────
              Shown when extraction found no Instagram/website signals.
              Tells the brand they're in sector-default mode and prompts
              them to be more detailed — the "more questions" spec requirement
              is met by the enhanced hint copy and the required differentiator. */}
          {loaded && !pre?.ig_username && !pre?.ig_followers_count && (
            <div className="rounded-(--r-md) border border-(--accent)/30 bg-(--accent-soft)/15 px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold text-(--accent)">No social media found — your answers matter more</p>
              <p className="text-xs text-(--fg-muted)">
                We couldn&apos;t find any Instagram or website signals for your brand, so we&apos;re building
                your BrandDNA from your answers below plus your sector&apos;s performance data.
                The more specific you are — especially on Q01, Q02, and &ldquo;What makes you different?&rdquo; —
                the better your starting strategy will be.
              </p>
              <p className="text-xs text-(--fg-muted)">
                Your first 90 days are a calibration period. The system will get sharper as real
                content data accumulates.
              </p>
            </div>
          )}

          {/* Confirm block — compact grid */}
          <div className="space-y-4 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-(--fg-muted)">Confirm — correct anything wrong</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Brand name (Arabic)" required badge={brandNameAr && pre?.ig_full_name ? auto() : null}>
                <Input name="brand_name_ar" dir="rtl" required minLength={2} placeholder="مثلاً: قهوة عواد"
                  value={brandNameAr} onChange={(e) => { setBrandNameAr(e.currentTarget.value); clearFieldError('brandNameAr') }}
                  className={fieldErrors.has('brandNameAr') ? 'ring-2 ring-(--danger)/60' : ''} />
                <FieldErrorHint show={fieldErrors.has('brandNameAr')} label="Brand name (Arabic)" />
              </Field>
              <Field label="Brand name (English)" hint="Used in image generation." badge={brandNameEn && pre?.brand_name_en ? auto() : null}>
                <Input name="brand_name_en" dir="ltr" value={brandNameEn} onChange={(e) => setBrandNameEn(e.currentTarget.value)} />
              </Field>
              <Field label="Sector" required badge={sector && pre?.sector_hint ? auto() : null}>
                <Select name="sector" required value={sector} onChange={(e) => { setSector(e.currentTarget.value); clearFieldError('sector') }}
                  className={fieldErrors.has('sector') ? 'ring-2 ring-(--danger)/60' : ''}>
                  <option value="" disabled>—</option>
                  {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
                <FieldErrorHint show={fieldErrors.has('sector')} label="Sector" />
              </Field>
              <Field label="City" required badge={city && pre?.city_hint ? auto() : null}>
                <Select name="city_primary" required value={city} onChange={(e) => { setCity(e.currentTarget.value); clearFieldError('city') }}
                  className={fieldErrors.has('city') ? 'ring-2 ring-(--danger)/60' : ''}>
                  <option value="" disabled>—</option>
                  {SAUDI_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <FieldErrorHint show={fieldErrors.has('city')} label="City" />
              </Field>
              <Field label="Arabic dialect" required hint="Wrong dialect = wrong voice everywhere." badge={dialect && pre?.dialect_hint ? auto() : null}>
                <Select name="arabic_dialect" required value={dialect} onChange={(e) => { setDialect(e.currentTarget.value); clearFieldError('dialect') }}
                  className={fieldErrors.has('dialect') ? 'ring-2 ring-(--danger)/60' : ''}>
                  <option value="" disabled>—</option>
                  {DIALECTS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
                </Select>
                <FieldErrorHint show={fieldErrors.has('dialect')} label="Arabic dialect" />
              </Field>
                <Field label="Primary colour" badge={color !== '#10b981' && pre?.primary_color_hex ? auto() : null}>
                <input name="primary_color_hex" type="color" value={color}
                  onChange={(e) => setColor(e.currentTarget.value)}
                  className="h-10 w-full cursor-pointer rounded-(--r-md) border border-(--border-default) bg-(--surface-4) p-1" />
              </Field>
            </div>

            {/* ── 3 missing critical fields ────────────────────────── */}
            <Field label="What makes you different?" required
              hint={!pre?.ig_username
                ? "Critical for new brands — be specific. What do you do that no one else does?"
                : "One sentence — your unfair advantage."}
              badge={brandDifferentiator && pre?.differentiator_seed ? auto(pre.differentiator_source ? `from your ${pre.differentiator_source.replace(/_/g, ' ')}` : undefined) : null}>
              <Textarea name="brand_differentiator_display" dir="auto" maxLength={500}
                rows={!pre?.ig_username ? 3 : 2}
                placeholder={!pre?.ig_username
                  ? "e.g. We're the only flower studio in Jeddah that designs in Hejazi style — no global templates. Every arrangement is made to order."
                  : "e.g. The only bakery in Riyadh that uses grandmother-era Najdi recipes without shortcuts."}
                value={brandDifferentiator} onChange={(e) => { setBrandDifferentiator(e.currentTarget.value); clearFieldError('brandDifferentiator') }}
                className={fieldErrors.has('brandDifferentiator') ? 'ring-2 ring-(--danger)/60' : ''} />
              <FieldErrorHint show={fieldErrors.has('brandDifferentiator')} label="What makes you different" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary audience" required
                badge={primaryAudienceGender && pre?.audience_female_pct != null ? auto('from your Instagram insights') : null}>
                <div className={['flex gap-2 rounded-(--r-md) transition-colors', fieldErrors.has('primaryAudienceGender') ? 'ring-2 ring-(--danger)/40 p-1' : ''].join(' ')}>
                  {AUDIENCE_GENDER.map((ag) => (
                    <button key={ag.v} type="button"
                      onClick={() => { setPrimaryAudienceGender(primaryAudienceGender === ag.v ? '' : ag.v); clearFieldError('primaryAudienceGender') }}
                      aria-pressed={primaryAudienceGender === ag.v}
                      className={['flex-1 rounded-(--r-sm) border p-2.5 text-left text-xs font-medium transition-colors',
                        primaryAudienceGender === ag.v
                          ? 'border-(--accent) bg-(--accent-soft)/40 text-(--fg)'
                          : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)'].join(' ')}>
                      <span className="block font-semibold text-(--fg)">{ag.l}</span>
                      <span className="text-[10px] text-(--fg-muted)">{ag.d}</span>
                    </button>
                  ))}
                </div>
                <FieldErrorHint show={fieldErrors.has('primaryAudienceGender')} label="Primary audience" />
              </Field>

              <Field label="Ramadan relevance" required
                hint="Controls seasonal content weighting."
                badge={ramadanRelevance && pre?.ramadan_relevance ? auto() : null}>
                <div className={['flex gap-2 rounded-(--r-md) transition-colors', fieldErrors.has('ramadanRelevance') ? 'ring-2 ring-(--danger)/40 p-1' : ''].join(' ')}>
                  {RAMADAN.map((r) => (
                    <button key={r} type="button"
                      onClick={() => { setRamadanRelevance(ramadanRelevance === r ? '' : r); clearFieldError('ramadanRelevance') }}
                      aria-pressed={ramadanRelevance === r}
                      className={['flex-1 rounded-(--r-sm) border p-2.5 text-center text-xs font-semibold transition-colors',
                        ramadanRelevance === r
                          ? 'border-(--accent) bg-(--accent-soft)/40 text-(--fg)'
                          : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)'].join(' ')}>
                      {r}
                    </button>
                  ))}
                </div>
                <FieldErrorHint show={fieldErrors.has('ramadanRelevance')} label="Ramadan relevance" />
              </Field>
            </div>

            <Field label="Logo" required={!igLogoUrl && !logoPreview}
              hint={igLogoUrl ? 'Auto from Instagram — upload to replace.' : 'PNG / JPEG / WebP / SVG, ≤ 2 MB.'}
              badge={igLogoUrl && !logoPreview ? auto('from your Instagram profile picture') : null}>
              <div className="flex items-center gap-3">
                {(logoPreview || igLogoUrl) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreview ?? igLogoUrl!} alt="Logo" referrerPolicy="no-referrer"
                    className="h-10 w-10 shrink-0 rounded-(--r-md) border border-(--border-subtle) object-cover"
                    onError={(e) => {
                      const el = e.currentTarget as HTMLImageElement
                      if (igLogoUrl && !logoPreview && !el.src.includes('/api/img-proxy'))
                        el.src = `/api/img-proxy?u=${encodeURIComponent(igLogoUrl)}`
                      else el.style.display = 'none'
                    }} />
                )}
                <input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  required={!igLogoUrl && !logoPreview}
                  onChange={(e) => setLogoPreview(e.target.files?.[0] ? URL.createObjectURL(e.target.files[0]) : null)}
                  className="block w-full text-sm text-(--fg) file:me-3 file:cursor-pointer file:rounded-(--r-md) file:border file:border-(--border-default) file:bg-(--surface-4) file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-(--surface-3)" />
              </div>
            </Field>
            <input type="hidden" name="ig_logo_url" value={igLogoUrl ?? ''} />
          </div>

          <Q n="Q01" title="What does your name mean?" sub="Is it named after someone, a place, or a feeling?">
            <Textarea name="name_meaning" dir="auto" maxLength={300} rows={2}
              placeholder="Named after my grandmother's recipe, the street I grew up on…"
              value={nameMeaning} onChange={(e) => setNameMeaning(e.currentTarget.value)} />
          </Q>

          <Q n="Q02" title="Show us what you sell." sub="Add each product or service with its price. You can add as many as you like.">
            <ProductsInput
              products={products}
              onChange={setProducts}
              sector={sector}
            />
          </Q>

          <Q n="Q03" title="How long have you been doing this?" error={fieldErrors.has('brandAgeBucket')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { v: 'launch',      l: 'Just started',     d: '0–12 months'    },
                { v: 'growth',      l: '1–3 years',        d: 'Finding what works' },
                { v: 'established', l: 'Established brand', d: '3–7 years'      },
                { v: 'mature',      l: 'Legacy brand',      d: '7+ years'       },
              ] as const).map((lc) => (
                <button key={lc.v} type="button"
                  onClick={() => { setBrandAgeBucket(lc.v === brandAgeBucket ? '' : lc.v); clearFieldError('brandAgeBucket') }}
                  aria-pressed={brandAgeBucket === lc.v}
                  className={['rounded-(--r-md) border p-3 text-left transition-colors',
                    brandAgeBucket === lc.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)'].join(' ')}>
                  <span className="block text-xs font-semibold text-(--fg)">{lc.l}</span>
                  <span className="text-[10px] text-(--fg-muted)">{lc.d}</span>
                </button>
              ))}
            </div>
            <Textarea name="founding_story_display" dir="auto" maxLength={500} rows={2}
              placeholder="When, where, and why you started — 2–3 sentences."
              value={foundingStory} onChange={(e) => setFoundingStory(e.currentTarget.value)} />
          </Q>

          <Q n="Q04" title="Where does your audience find you?" error={fieldErrors.has('platforms')}>
            <div className="flex flex-wrap gap-2">
              {(['Instagram','Snapchat','TikTok','WhatsApp','Online store','Physical store','YouTube','X (Twitter)'] as const).map((p) =>
                chip(p, platforms.has(p), () => { toggleSet(platforms, p, setPlatforms); clearFieldError('platforms') })
              )}
            </div>
            <Input name="social_display" dir="ltr" maxLength={300}
              placeholder="@yourinstagram, @yoursnapchat, yourwebsite.com"
              value={social} onChange={(e) => setSocial(e.currentTarget.value)} />
          </Q>
        </>}

        {/* ══ CHAPTER 2 — THE FEEL ══ */}
        {chapter === 2 && <>
          <Q n="Q05" title="In five words, what is your brand?" sub="Pick exactly five. Trust your gut." error={fieldErrors.has('brandWords')}>
            <div className="flex flex-wrap gap-2">
              {BRAND_WORDS.map((w) => chip(w, brandWords.has(w), () => { toggleSet(brandWords, w, setBrandWords, 5); clearFieldError('brandWords') }))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-(--fg-muted)">{brandWords.size}/5 selected</span>
            </div>
            <Input name="brand_word_custom" dir="auto" maxLength={50}
              placeholder="A word not in the list…"
              value={brandWordCustom} onChange={(e) => setBrandWordCustom(e.currentTarget.value)} />
          </Q>

          <Q n="Q06" title="Which brands do you wish you looked like?" sub="Pick up to three — or type your own.">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {BRAND_REFS.map((b) => (
                <button key={b} type="button"
                  onClick={() => toggleSet(brandRefs, b, setBrandRefs, 3)}
                  aria-pressed={brandRefs.has(b)}
                  disabled={!brandRefs.has(b) && brandRefs.size >= 3}
                  className={['rounded-(--r-sm) border px-2 py-1.5 text-xs font-medium transition-colors text-center',
                    brandRefs.has(b) ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3) disabled:opacity-40'].join(' ')}>
                  {b}
                </button>
              ))}
            </div>
            {/* Custom brand entry — same chip system, type + Enter */}
            {brandRefs.size < 3 && (
              <CustomBrandInput
                onAdd={(name) => setBrandRefs((prev) => { const n = new Set(prev); n.add(name); return n })}
                disabled={brandRefs.size >= 3}
              />
            )}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-(--fg-muted)">{brandRefs.size}/3 selected</span>
              {/* Show custom-added brands (not in BRAND_REFS list) as removable chips */}
              {[...brandRefs].filter(b => !(BRAND_REFS as readonly string[]).includes(b)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {[...brandRefs]
                    .filter(b => !(BRAND_REFS as readonly string[]).includes(b))
                    .map(b => (
                      <span key={b} className="inline-flex items-center gap-1 rounded-full border border-(--accent) bg-(--accent) text-(--accent-fg) pl-2.5 pr-1 py-0.5 text-xs font-medium">
                        {b}
                        <button type="button" onClick={() => toggleSet(brandRefs, b, setBrandRefs, 3)}
                          className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-white/20 text-sm leading-none">×</button>
                      </span>
                    ))}
                </div>
              )}
            </div>
          </Q>

          <Q n="Q07" title="Picture your best customer's Friday evening." sub="One scene. The one that feels most like them." error={fieldErrors.has('lifestyle')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LIFESTYLE.map((ls) => (
                <button key={ls.v} type="button"
                  onClick={() => { setLifestyle(lifestyle === ls.v ? '' : ls.v); clearFieldError('lifestyle') }}
                  aria-pressed={lifestyle === ls.v}
                  className={['flex flex-col items-start rounded-(--r-md) border p-3 text-left transition-colors',
                    lifestyle === ls.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)'].join(' ')}>
                  <span className="text-xl mb-1">{ls.e}</span>
                  <span className="text-xs font-semibold text-(--fg)">{ls.l}</span>
                  <span className="text-[10px] text-(--fg-muted)">{ls.d}</span>
                </button>
              ))}
            </div>
            <Textarea name="cust_desc" dir="auto" maxLength={400} rows={2}
              placeholder="Describe your ideal customer — age, what they care about, how they discover products…"
              value={custDesc} onChange={(e) => setCustDesc(e.currentTarget.value)} />
          </Q>

          <Q n="Q08" title="Where does your product sit in the market?" sub="Honest positioning creates better content than aspirational." error={fieldErrors.has('pricePosition')}>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRICE_TIERS.map((p) => (
                <button key={p.v} type="button"
                  onClick={() => { setPricePosition(pricePosition === p.v ? '' : p.v); clearFieldError('pricePosition') }}
                  aria-pressed={pricePosition === p.v}
                  className={['rounded-(--r-md) border p-3 text-left transition-colors',
                    pricePosition === p.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)'].join(' ')}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-(--fg)">{p.l}</span>
                    <span className="text-[10px] text-(--accent) bg-(--accent-soft) rounded-full px-2 py-0.5">{p.t}</span>
                  </div>
                  <span className="text-xs text-(--fg-muted)">{p.d}</span>
                </button>
              ))}
            </div>
            <PriceRangeInput value={priceNums} onChange={setPriceNums} />
          </Q>

          <Q n="Q09" title="How do you want people to feel?" sub="Pick three emotions." error={fieldErrors.has('emotions')}>
            <div className="flex flex-wrap gap-2">
              {EMOTIONS.map((em) => chip(em, emotions.has(em), () => { toggleSet(emotions, em, setEmotions, 3); clearFieldError('emotions') }))}
            </div>
            <span className="text-[11px] text-(--fg-muted)">{emotions.size}/3 selected</span>
            <Textarea name="cust_quote" dir="auto" maxLength={300} rows={2}
              placeholder="Paste a customer review or message that captured exactly how you want people to feel."
              value={custQuote} onChange={(e) => setCustQuote(e.currentTarget.value)} />
          </Q>
        </>}

        {/* ══ CHAPTER 3 — THE VOICE ══ */}
        {chapter === 3 && <>
          <Q n="Q10" title="If your brand was a person, who would they be?" sub="This single answer routes hundreds of creative decisions." error={fieldErrors.has('archetypeFamily')}>
            <div className="grid grid-cols-2 gap-2">
              {ARCHETYPE_FAMILY.map((af) => (
                <button key={af.v} type="button"
                  onClick={() => { setArchetypeFamily(archetypeFamily === af.v ? '' : af.v); clearFieldError('archetypeFamily') }}
                  aria-pressed={archetypeFamily === af.v}
                  className={['rounded-(--r-md) border p-3 text-left transition-colors',
                    archetypeFamily === af.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)'].join(' ')}>
                  <span className="text-sm font-semibold text-(--fg)">{af.l}</span>
                  <span className="block text-[11px] text-(--fg-muted)">{af.d}</span>
                </button>
              ))}
            </div>
            <Textarea name="caption_ex" dir="auto" maxLength={300} rows={2}
              placeholder="Paste a caption or sentence that felt perfectly on-brand…"
              value={captionEx} onChange={(e) => setCaptionEx(e.currentTarget.value)} />
          </Q>

          <Q n="Q11" title="If your brand had a soundtrack, what would it sound like?" error={fieldErrors.has('music')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MUSIC.map((m) => (
                <button key={m.v} type="button"
                  onClick={() => { setMusic(music === m.v ? '' : m.v); clearFieldError('music') }}
                  aria-pressed={music === m.v}
                  className={['rounded-(--r-md) border p-3 text-left transition-colors',
                    music === m.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)'].join(' ')}>
                  <span className="text-xl mb-1 block">{m.e}</span>
                  <span className="text-xs font-semibold text-(--fg)">{m.l}</span>
                  <span className="block text-[10px] text-(--fg-muted)">{m.d}</span>
                </button>
              ))}
            </div>
            <Input name="music_link" type="url" dir="ltr"
              placeholder="Paste a YouTube or Spotify link to a reference track"
              value={musicLink} onChange={(e) => setMusicLink(e.currentTarget.value)} />
          </Q>

          <Q n="Q12" title="What should we never show?" sub="Your rules become hard policy on every generated output." error={fieldErrors.has('restrictions')}>
            <div className="flex flex-wrap gap-2">
              {RESTRICTIONS.map((r) => chip(r, restrictions.has(r), () => { toggleSet(restrictions, r, setRestrictions); clearFieldError('restrictions') }, true))}
            </div>
            <Input name="custom_restriction" dir="auto" maxLength={200}
              placeholder="Any restriction not in the list above…"
              value={customRestriction} onChange={(e) => setCustomRestriction(e.currentTarget.value)} />
          </Q>

          <Q n="Q12b" title="What should your brand NEVER sound like?" sub="Enforced on every caption and copy output." error={fieldErrors.has('antiAttrs')}>
            <div className="flex flex-wrap gap-2">
              {ANTI_ATTRIBUTES.map((a) => chip(a.label, antiAttrs.has(a.v), () => { toggleSet(antiAttrs, a.v, setAntiAttrs); clearFieldError('antiAttrs') }, true))}
            </div>
          </Q>

          <Q n="Q13" title="What language do you speak to your customers?" error={fieldErrors.has('bilingual')}>
            <div className="grid grid-cols-2 gap-2">
              {(['arabic_only','arabic_primary','balanced','english_primary'] as const).map((b) => (
                <button key={b} type="button"
                  onClick={() => { setBilingual(bilingual === b ? '' : b); clearFieldError('bilingual') }}
                  aria-pressed={bilingual === b}
                  className={['rounded-(--r-sm) border p-2.5 text-left text-xs font-medium transition-colors',
                    bilingual === b ? 'border-(--accent) bg-(--accent-soft)/40 text-(--fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)'].join(' ')}>
                  {b.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <Input name="tagline" dir="auto" maxLength={100}
              placeholder="Your tagline or slogan — in Arabic, English, or both"
              value={tagline} onChange={(e) => setTagline(e.currentTarget.value)} />
          </Q>

          <Q n="Q14" title="Which seasonal moments matter most?" sub="Tap in order — #1 first, #2, #3." error={fieldErrors.has('occasionsRanked')}>
            <div className="flex flex-wrap gap-2">
              {OCCASIONS.map((occ) => {
                const rank = occasionsRanked.indexOf(occ)
                const selected = rank !== -1
                return (
                  <button key={occ} type="button" onClick={() => { toggleOccasion(occ); clearFieldError('occasionsRanked') }} aria-pressed={selected}
                    className={['flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      selected ? 'border-(--accent) bg-(--accent) text-(--accent-fg)' : 'border-(--border-default) bg-(--surface-4) text-(--fg-muted) hover:bg-(--surface-3)'].join(' ')}>
                    {selected && <span className="font-bold">{rank + 1}.</span>}
                    {occ}
                  </button>
                )
              })}
            </div>
            <Input name="custom_occasion" dir="auto" maxLength={100}
              placeholder="Any occasion specific to your city or community not listed above"
              value={customOccasion} onChange={(e) => setCustomOccasion(e.currentTarget.value)} />
          </Q>
        </>}

        {/* ══ CHAPTER 4 — THE BUSINESS ══ */}
        {chapter === 4 && <>
          <Q n="Q15" title="Your competitors" sub="We'll track their posts and surface gaps automatically.">
            {/* Chips for each confirmed competitor */}
            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {competitors.map((c) => (
                  <div key={c.competitor_id}
                    className="flex items-center gap-1.5 rounded-full border border-(--border-default) bg-(--surface-3) pl-3 pr-1.5 py-1 text-xs font-medium text-(--fg)">
                    <span className="text-(--fg-muted)">@</span>
                    <span>{c.handle_instagram}</span>
                    <button type="button" aria-label={`Remove @${c.handle_instagram}`}
                      onClick={() => setCompetitors((prev) => prev.filter((x) => x.competitor_id !== c.competitor_id))}
                      className="ml-0.5 rounded-full p-0.5 text-(--fg-muted) hover:bg-(--danger)/10 hover:text-(--danger) transition-colors">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {competitors.length === 0 && (
              <p className="text-xs text-(--fg-muted) italic">No competitors added yet — add up to 3 below.</p>
            )}
            {/* Add a new competitor inline (max 3 total) */}
            {competitors.length < 3 && (
              <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-1.5 rounded-(--r-md) border border-(--border-default) bg-(--surface-4) px-3 py-1.5">
                  <span className="text-xs text-(--fg-muted) font-mono">@</span>
                  <input dir="ltr" maxLength={30}
                    placeholder="competitorhandle"
                    value={newCompetitor}
                    onChange={(e) => setNewCompetitor(e.currentTarget.value.replace(/[@\s]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const h = newCompetitor.trim()
                        if (h && competitors.length < 3 && !competitors.find((c) => c.handle_instagram === h)) {
                          setCompetitors((prev) => [...prev, { competitor_id: `new_${h}`, handle_instagram: h, display_name: h }])
                          setNewCompetitor('')
                        }
                      }
                    }}
                    className="flex-1 bg-transparent text-xs text-(--fg) outline-none placeholder:text-(--fg-faint)" />
                </div>
                <button type="button"
                  onClick={() => {
                    const h = newCompetitor.trim()
                    if (h && competitors.length < 3 && !competitors.find((c) => c.handle_instagram === h)) {
                      setCompetitors((prev) => [...prev, { competitor_id: `new_${h}`, handle_instagram: h, display_name: h }])
                      setNewCompetitor('')
                    }
                  }}
                  className="rounded-(--r-md) border border-(--border-default) bg-(--surface-3) px-3 py-1.5 text-xs font-medium text-(--fg) hover:bg-(--surface-2) transition-colors">
                  Add
                </button>
              </div>
            )}
            <p className="text-[11px] text-(--fg-muted)">{competitors.length}/3 competitors · posts tracked bi-weekly after onboarding</p>
            {/* Pass competitor handles as hidden inputs so submitFinal can sync them */}
            {competitors.map((c) => (
              <input key={c.competitor_id} type="hidden" name="competitor_ig" value={c.handle_instagram} />
            ))}
          </Q>

          <Q n="Q16" title="What's the main thing content needs to do?" sub="One goal. The most important one right now." error={fieldErrors.has('intent')}>
            <div className="space-y-2">
              {GOALS.map((g) => (
                <label key={g.v}
                  className={['flex cursor-pointer items-start gap-3 rounded-(--r-sm) border bg-(--surface-4) p-3 hover:border-(--border-strong)',
                    intent === g.v ? 'border-(--accent)' : 'border-(--border-subtle)'].join(' ')}>
                  <input type="radio" name="intent_state" value={g.v}
                    checked={intent === g.v} onChange={() => { setIntent(g.v); clearFieldError('intent') }}
                    className="mt-0.5 accent-(--accent)" />
                  <span>
                    <span className="mr-1">{g.e}</span>
                    <span className="text-sm font-medium text-(--fg)">{g.l}</span>
                    <span className="block text-xs text-(--fg-muted)">{g.d}</span>
                  </span>
                </label>
              ))}
            </div>
            <Input name="metric" dir="auto" maxLength={100}
              placeholder="A concrete number you're working toward — orders, followers, revenue…"
              value={metric} onChange={(e) => setMetric(e.currentTarget.value)} />
          </Q>

          <Q n="Q16b" title="Religious sensitivity" sub="Always asked — never inferred. Controls content rules everywhere." error={fieldErrors.has('religious')}>
            <div className="flex gap-3">
              {RELIGIOUS.map((r) => (
                <label key={r}
                  className={['flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-(--r-md) border p-3 text-center transition-colors',
                    religious === r ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-subtle) bg-(--surface-4) hover:border-(--border-default)'].join(' ')}>
                  <input type="radio" name="religious_sensitivity" value={r}
                    checked={religious === r} onChange={() => { setReligious(r); clearFieldError('religious') }} className="sr-only" />
                  <span className="text-sm font-semibold text-(--fg)">{r}</span>
                  <span className="text-[10px] text-(--fg-muted)">
                    {r === 'Low' ? 'Modern, relaxed' : r === 'Medium' ? 'Standard Saudi' : 'Conservative'}
                  </span>
                </label>
              ))}
            </div>
          </Q>

          <Q n="Q17" title="Has content ever not worked for you?" sub="What felt wrong is more useful than what felt right.">
            <div className="flex flex-wrap gap-2">
              {PROBLEMS.map((p) => chip(p, problems.has(p), () => toggleSet(problems, p, setProblems)))}
            </div>
          </Q>

          <Q n="Q18" title="Share everything you already have." sub="The more we start with, the less we have to invent.">
            {igPostImageUrls.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-(--success)/15 px-2 py-0.5 text-[11px] font-semibold text-(--success)">Auto-detected</span>
                  <span className="text-xs text-(--fg-muted)">{igPostImageUrls.length} Instagram post image{igPostImageUrls.length !== 1 ? 's' : ''} — saved on submit</span>
                </div>
                <div className="grid grid-cols-5 gap-1 sm:grid-cols-8">
                  {igPostImageUrls.map((url, i) => (
                    <div key={i} className="relative aspect-square overflow-hidden rounded-(--r-sm) bg-(--surface-3)">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/img-proxy?u=${encodeURIComponent(url)}`} alt={`IG post ${i + 1}`}
                        className="h-full w-full object-cover" loading="lazy"
                        onError={(e) => { const el = e.currentTarget as HTMLImageElement; if (!el.src.includes(url)) el.src = url }} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-2) px-3 py-2.5 text-xs text-(--fg-muted)">
                <span className="shrink-0">ℹ️</span>
                <span>No Instagram images detected. Add brand files below.</span>
              </div>
            )}
            <input ref={assetInputRef} name="brand_assets" type="file" multiple
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,application/pdf,video/mp4,video/quicktime"
              className="sr-only"
              onChange={(e) => setAssetFiles(Array.from(e.currentTarget.files ?? []).slice(0, 10))} />
            <button type="button" onClick={() => assetInputRef.current?.click()}
              className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-(--r-md) border-2 border-dashed border-(--border-default) bg-(--surface-2) px-4 py-4 text-center transition hover:border-(--accent) hover:bg-(--surface-3)">
              <span className="text-xl">📎</span>
              <span className="text-sm font-medium text-(--fg)">
                {assetFiles.length === 0 ? 'Add extra files — logos, PDFs, photos, guidelines…' : `${assetFiles.length} file${assetFiles.length !== 1 ? 's' : ''} selected`}
              </span>
              <span className="text-xs text-(--fg-muted)">Images · PDF · Video · up to 10 files</span>
            </button>
            {assetFiles.length > 0 && (
              <ul className="space-y-1">
                {assetFiles.map((file, i) => (
                  <li key={i} className="flex items-center justify-between rounded-(--r-sm) bg-(--surface-3) px-3 py-1.5 text-xs text-(--fg)">
                    <span className="truncate max-w-[80%]">{file.name}</span>
                    <span className="shrink-0 text-(--fg-muted)">{(file.size / 1024).toFixed(0)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </Q>
        </>}

        {/* ══ CHAPTER 5 — THE VISION ══ */}
        {chapter === 5 && <>
          <Q n="Q19" title="What does success look like in 12 months?" sub="One vision. The one that excites you most." error={fieldErrors.has('vision')}>
            <div className="grid grid-cols-2 gap-2">
              {VISIONS.map((v) => (
                <button key={v.v} type="button"
                  onClick={() => { setVision(vision === v.v ? '' : v.v); clearFieldError('vision') }}
                  aria-pressed={vision === v.v}
                  className={['rounded-(--r-md) border p-3 text-left transition-colors',
                    vision === v.v ? 'border-(--accent) bg-(--accent-soft)/40' : 'border-(--border-default) bg-(--surface-4) hover:bg-(--surface-3)'].join(' ')}>
                  <span className="text-xl mb-1 block">{v.e}</span>
                  <span className="text-sm font-semibold text-(--fg)">{v.l}</span>
                  <span className="block text-[11px] text-(--fg-muted)">{v.d}</span>
                </button>
              ))}
            </div>
            <Textarea name="vision_text" dir="auto" maxLength={500} rows={2}
              placeholder="In your own words — who knows about you, where is it sold, how does it feel different?"
              value={visionText} onChange={(e) => setVisionText(e.currentTarget.value)} />
          </Q>

          <Q n="Q20" title="One last thing." sub="Anything we haven't asked. A rule, a story, a fear, a dream.">
            <Textarea name="anything_display" dir="auto" maxLength={500} rows={3}
              placeholder="The brands who write the most here always get the best results."
              value={anything} onChange={(e) => setAnything(e.currentTarget.value)} />
          </Q>

          {/* Business events */}
          <div className="space-y-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) p-4">
            <div>
              <h3 className="text-sm font-semibold text-(--fg)">Upcoming events <span className="text-(--fg-muted) font-normal text-xs">— Optional</span></h3>
              <p className="text-xs text-(--fg-muted) mt-0.5">Launches, promotions, openings, or dates to avoid — anchors your content calendar.</p>
            </div>
            {businessEvents.map((ev, i) => (
              <div key={i} className="flex gap-2 items-center">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <select className="rounded-(--r-sm) border border-(--border-default) bg-(--surface-4) px-2 py-1.5 text-sm text-(--fg)"
                    value={ev.event_type}
                    onChange={(e) => { const n=[...businessEvents]; n[i]={...n[i]!,event_type:e.currentTarget.value}; setBusinessEvents(n) }}>
                    <option value="product_launch">Product launch</option>
                    <option value="promotion">Promotion</option>
                    <option value="store_opening">Store opening</option>
                    <option value="event">Event</option>
                    <option value="avoid_period">Avoid dates</option>
                    <option value="other">Other</option>
                  </select>
                  <input className="rounded-(--r-sm) border border-(--border-default) bg-(--surface-4) px-2 py-1.5 text-sm text-(--fg)"
                    placeholder="Title" value={ev.title}
                    onChange={(e) => { const n=[...businessEvents]; n[i]={...n[i]!,title:e.currentTarget.value}; setBusinessEvents(n) }} />
                  <input type="date" className="rounded-(--r-sm) border border-(--border-default) bg-(--surface-4) px-2 py-1.5 text-sm text-(--fg)"
                    value={ev.event_date}
                    onChange={(e) => { const n=[...businessEvents]; n[i]={...n[i]!,event_date:e.currentTarget.value}; setBusinessEvents(n) }} />
                </div>
                <button type="button" onClick={() => setBusinessEvents(businessEvents.filter((_,j)=>j!==i))}
                  className="shrink-0 text-lg leading-none text-(--fg-muted) hover:text-(--danger)">×</button>
              </div>
            ))}
            {businessEvents.length < 5 && (
              <button type="button"
                onClick={() => setBusinessEvents([...businessEvents, {event_type:'product_launch',title:'',event_date:''}])}
                className="text-xs text-(--accent) hover:underline">+ Add event</button>
            )}
          </div>
        </>}

      </div>

      {/* ── Error ─────────────────────────────────────────────────── */}
      {error && (
        <p className="mt-4 rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)" role="alert">
          {error}
        </p>
      )}

      {/* ── Chapter nav ───────────────────────────────────────────── */}
      <div className="mt-6 flex items-center justify-between border-t border-(--border-subtle) pt-4">
        <Button type="button" variant="ghost" onClick={goPrev} disabled={pending}>
          ← {chapter === 1 ? 'Back' : 'Previous'}
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-(--fg-muted) font-mono">{chapter}/5</span>
          {chapter < 5 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={pending}
              className={[
                'relative inline-flex items-center gap-2 rounded-(--r-md) px-4 py-2 text-sm font-semibold transition-all',
                isCurrentChapterValid
                  ? 'text-black hover:opacity-90'
                  : 'text-black opacity-80 hover:opacity-100',
              ].join(' ')}
              style={{ backgroundColor: isCurrentChapterValid ? currentChapter.color : '#6B7280', borderColor: 'transparent' }}
            >
              {!isCurrentChapterValid && (
                <span className="inline-flex items-center justify-center rounded-full bg-white/30 px-1.5 py-0.5 text-[10px] font-bold leading-none">
                  {currentMissing.length} required
                </span>
              )}
              Continue →
            </button>
          ) : (
            <Button type="submit" disabled={pending} size="lg">
              {pending ? 'Building your BrandDNA…' : 'Generate my BrandDNA →'}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}
