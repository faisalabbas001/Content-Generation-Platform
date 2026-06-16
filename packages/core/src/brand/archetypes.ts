/**
 * The 12 Jungian brand archetypes (Doc framework v2 § Axis 1).
 *
 * Pure constants + helpers — no I/O. The list is stable Jungian theory and
 * mirrors the `archetype_type` Postgres enum byte-for-byte. If you add an
 * archetype here, add it to the migration too.
 */

export const ARCHETYPES = [
  'Innocent',
  'Sage',
  'Explorer',
  'Outlaw',
  'Magician',
  'Hero',
  'Lover',
  'Jester',
  'Everyman',
  'Caregiver',
  'Ruler',
  'Creator',
] as const

export type Archetype = (typeof ARCHETYPES)[number]

/**
 * Saudi-SME frequency — the four "high-frequency" archetypes account for
 * ~70% of clients we expect (per framework v2). Used for prior-weighting
 * archetype detection: when COO has weak signal, ties go to higher-frequency
 * archetypes within the brand's sector.
 */
export const ARCHETYPE_FREQUENCY: Record<Archetype, number> = {
  Caregiver: 0.22,
  Everyman:  0.18,
  Sage:      0.16,
  Lover:     0.14,
  Magician:  0.06,
  Ruler:     0.06,
  Hero:      0.05,
  Creator:   0.05,
  Innocent:  0.03,
  Outlaw:    0.02,
  Explorer:  0.02,
  Jester:    0.01,
}

/**
 * Default archetype per sector — used as a fallback when COO scores
 * below the `inferred_medium` floor on archetype detection. The user can
 * always override via /[slug]/profile correction.
 */
import type { Sector } from './sectors'

export const SECTOR_DEFAULT_ARCHETYPE: Record<Sector, Archetype> = {
  'F&B':              'Everyman',
  Retail:             'Lover',
  Beauty_Wellness:    'Lover',
  Healthcare:         'Caregiver',
  Finance:            'Sage',
  Government:         'Ruler',
  Other:              'Caregiver',
}

export interface ArchetypeDefinition {
  name: Archetype
  /** One-line descriptor for UI tooltips. */
  blurb_en: string
  blurb_ar: string
  /** Method affinities — which methods are most likely to score highest. */
  default_methods: string[]
}

export const ARCHETYPE_DEFINITIONS: Record<Archetype, ArchetypeDefinition> = {
  Caregiver: {
    name: 'Caregiver',
    blurb_en: 'Serves and protects. Speaks in care, not commerce.',
    blurb_ar: 'يخدم ويحمي. يتحدث بلغة الرعاية، لا التجارة.',
    default_methods: ['Authenticity', 'Vulnerability'],
  },
  Everyman: {
    name: 'Everyman',
    blurb_en: 'Familiar, reliable, of-the-people. No pretense.',
    blurb_ar: 'مألوف وموثوق وقريب من الناس. بلا تكلف.',
    default_methods: ['Authenticity', 'Vulnerability', 'Paradox'],
  },
  Sage: {
    name: 'Sage',
    blurb_en: 'Knowing and unhurried. Authority earned through expertise.',
    blurb_ar: 'عارف ومتأنٍ. سلطة مكتسبة من الخبرة.',
    default_methods: ['Authenticity', 'Heritage'],
  },
  Lover: {
    name: 'Lover',
    blurb_en: 'Intimate and aesthetic. Desire is the message.',
    blurb_ar: 'حميمي وجمالي. الرغبة هي الرسالة.',
    default_methods: ['Paradox', 'Vulnerability', 'Authenticity'],
  },
  Magician: {
    name: 'Magician',
    blurb_en: 'Transformation through revelation. The "before/after" pattern.',
    blurb_ar: 'التحول من خلال الكشف. نمط "قبل/بعد".',
    default_methods: ['Paradox', 'Diagnostic'],
  },
  Ruler: {
    name: 'Ruler',
    blurb_en: 'Standard-setting. Speaks for the category, not within it.',
    blurb_ar: 'يضع المعايير. يتحدث باسم الفئة، لا من داخلها.',
    default_methods: ['Heritage', 'Diagnostic'],
  },
  Hero: {
    name: 'Hero',
    blurb_en: 'Earned overcoming. Conviction without arrogance.',
    blurb_ar: 'تغلب مكتسب. ثقة دون غرور.',
    default_methods: ['Paradox', 'Vulnerability'],
  },
  Creator: {
    name: 'Creator',
    blurb_en: 'Process-led. Craft visible. Iteration as content.',
    blurb_ar: 'موجه بالعملية. الحرفة ظاهرة. التكرار محتوى.',
    default_methods: ['Metaphor', 'Paradox'],
  },
  Innocent: {
    name: 'Innocent',
    blurb_en: 'Wholesome and simple. Doesn\'t complicate.',
    blurb_ar: 'صافٍ وبسيط. لا يُعقّد.',
    default_methods: ['Authenticity', 'Vulnerability'],
  },
  Outlaw: {
    name: 'Outlaw',
    blurb_en: 'Refuses the obvious frame. Names the contradiction.',
    blurb_ar: 'يرفض الإطار المعتاد. يسمّي التناقض.',
    default_methods: ['Paradox', 'Vulnerability'],
  },
  Explorer: {
    name: 'Explorer',
    blurb_en: 'Unfinished and forward-leaning. The next horizon as theme.',
    blurb_ar: 'غير منتهٍ ومتطلع للأمام. الأفق التالي هو الموضوع.',
    default_methods: ['Vulnerability'], // GAP per framework — composition required
  },
  Jester: {
    name: 'Jester',
    blurb_en: 'Plays for truth. Humor as honesty, not deflection.',
    blurb_ar: 'يلعب من أجل الحقيقة. الفكاهة صدق، لا تهرّب.',
    default_methods: [], // GAP per framework — composition required, no full method
  },
}

export function isArchetype(value: unknown): value is Archetype {
  return typeof value === 'string' && (ARCHETYPES as readonly string[]).includes(value)
}
