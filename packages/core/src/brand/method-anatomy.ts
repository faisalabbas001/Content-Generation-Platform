/**
 * Method anatomy — the 5 separately-addressable components of a method
 * (Doc framework v2 § "What a method actually contains").
 *
 * Patterns are sourced from any of the 6 creative methods. The closed-list
 * design forces the architecture to stay composable: a brand's method
 * profile is a 5-tuple, not a single label.
 *
 * Each enum mirrors a Postgres enum from migration 0020 byte-for-byte.
 * Adding values requires both a migration and an update here.
 */

// ── Voice register ────────────────────────────────────────────────────
export const VOICE_REGISTERS = [
  'intimate_humble',
  'authoritative_warm',
  'ironic_observer',
  'devotional_serene',
  'playful_curious',
  'crafted_precise',
] as const
export type VoiceRegister = (typeof VOICE_REGISTERS)[number]

// ── Diagnostic pattern (how a post opens) ─────────────────────────────
export const DIAGNOSTIC_PATTERNS = [
  'story_opener',
  'question_opener',
  'claim_opener',
  'contradiction_opener',
  'observation_opener',
] as const
export type DiagnosticPattern = (typeof DIAGNOSTIC_PATTERNS)[number]

// ── Visual idiom (imagery vocabulary) ─────────────────────────────────
export const VISUAL_IDIOMS = [
  'minimal_natural_light',
  'archive_film_grain',
  'flat_graphic_warm',
  'editorial_dramatic',
  'documentary_unposed',
  'studio_polished',
] as const
export type VisualIdiom = (typeof VISUAL_IDIOMS)[number]

// ── Cadence rule (pacing within a calendar) ───────────────────────────
export const CADENCE_RULES = [
  'steady_drumbeat',
  'burst_then_quiet',
  'narrative_arc',
  'occasion_aligned',
  'reactive_responsive',
] as const
export type CadenceRule = (typeof CADENCE_RULES)[number]

// ── Closing pattern (CTA style) ───────────────────────────────────────
export const CLOSING_PATTERNS = [
  'soft_invitation',
  'direct_ask',
  'open_question',
  'no_close',
  'community_call',
] as const
export type ClosingPattern = (typeof CLOSING_PATTERNS)[number]

// ── Creative methods (the 6) ──────────────────────────────────────────
export const CREATIVE_METHODS = [
  'Authenticity',
  'Heritage',
  'Metaphor',
  'Paradox',
  'Diagnostic',
  'Vulnerability',
] as const
export type CreativeMethod = (typeof CREATIVE_METHODS)[number]

// ── A complete method profile ────────────────────────────────────────
export interface MethodProfile {
  voice_register: VoiceRegister
  diagnostic_pattern: DiagnosticPattern
  visual_idiom: VisualIdiom
  cadence_rule: CadenceRule
  closing_pattern: ClosingPattern
  /** Per-component method source: { voice: 'Authenticity', diagnostic: 'Paradox', ... } */
  composition_blend: Partial<Record<MethodComponentSlot, CreativeMethod>>
  composition_score: number   // 0-100
  creative_direction_text: string
}

export type MethodComponentSlot =
  | 'voice'
  | 'diagnostic'
  | 'visual'
  | 'cadence'
  | 'closing'

// ── User-facing labels for UI tooltips ────────────────────────────────
export const COMPONENT_LABELS: Record<MethodComponentSlot, { en: string; ar: string; help_en: string }> = {
  voice: {
    en: 'Voice register',
    ar: 'النبرة الصوتية',
    help_en: 'How the brand sounds — the linguistic posture across all captions.',
  },
  diagnostic: {
    en: 'Opening pattern',
    ar: 'نمط الافتتاح',
    help_en: 'How posts begin — the hook that pulls readers in.',
  },
  visual: {
    en: 'Visual idiom',
    ar: 'الأسلوب البصري',
    help_en: 'Imagery vocabulary — the look and feel of generated visuals.',
  },
  cadence: {
    en: 'Cadence',
    ar: 'الإيقاع',
    help_en: 'How posts pace within a month — steady, bursty, narrative-driven.',
  },
  closing: {
    en: 'Closing pattern',
    ar: 'نمط الختام',
    help_en: 'How posts end — the call to action style.',
  },
}

// ── Type guards ───────────────────────────────────────────────────────
export const isVoiceRegister     = (v: unknown): v is VoiceRegister     => typeof v === 'string' && (VOICE_REGISTERS     as readonly string[]).includes(v)
export const isDiagnosticPattern = (v: unknown): v is DiagnosticPattern => typeof v === 'string' && (DIAGNOSTIC_PATTERNS as readonly string[]).includes(v)
export const isVisualIdiom       = (v: unknown): v is VisualIdiom       => typeof v === 'string' && (VISUAL_IDIOMS       as readonly string[]).includes(v)
export const isCadenceRule       = (v: unknown): v is CadenceRule       => typeof v === 'string' && (CADENCE_RULES       as readonly string[]).includes(v)
export const isClosingPattern    = (v: unknown): v is ClosingPattern    => typeof v === 'string' && (CLOSING_PATTERNS    as readonly string[]).includes(v)
export const isCreativeMethod    = (v: unknown): v is CreativeMethod    => typeof v === 'string' && (CREATIVE_METHODS    as readonly string[]).includes(v)
