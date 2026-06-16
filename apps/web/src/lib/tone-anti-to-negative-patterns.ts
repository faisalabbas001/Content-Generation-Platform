/**
 * Convert form-supplied `tone_anti_attribute_ids` (e.g. ["salesy", "flashy"])
 * into Memory-Controller `negative_pattern_add` nominations.
 *
 * Why this matters:
 *   The form stores anti-attributes on `brand_profiles.tone_anti_attribute_ids`,
 *   but A01/V01 quality gates read `negative_patterns` rows, not the array
 *   column. Without this conversion the user's "never sound salesy" preference
 *   is informational only — it doesn't actually block salesy captions.
 *
 * Each tag maps to one canonical pattern_text with a default severity. Severity
 * defaults to STRONG_WARN — clear violations should warn but not hard-block
 * (the user can promote any pattern to HARD_BLOCK via /admin later).
 */
type Severity = 'SOFT_WARN' | 'STRONG_WARN' | 'HARD_BLOCK'

interface ToneAntiMapping {
  pattern_text: string
  severity: Severity
}

// Vocabulary anchored on the form's tone_anti_attribute_ids enum (Doc §4.2,
// matches packages/core/src/schemas/onboarding.ts AntiAttributeId).
const TONE_ANTI_TO_PATTERN: Record<string, ToneAntiMapping> = {
  salesy: {
    pattern_text: 'Avoid hard-sell language: "buy now", "limited time", urgency framing, salesy CTAs. The brand should educate and invite, not push.',
    severity: 'STRONG_WARN',
  },
  flashy: {
    pattern_text: 'Avoid flashy / showy phrasing: superlatives ("the best", "amazing", "incredible"), excessive emojis, exclamation chains. Tone is grounded, not loud.',
    severity: 'STRONG_WARN',
  },
  aggressive: {
    pattern_text: 'Avoid aggressive or confrontational language: imperatives without warmth, dismissive comparisons to competitors, urgency that feels coercive.',
    severity: 'STRONG_WARN',
  },
  edgy: {
    pattern_text: 'Avoid edgy / provocative tone: sarcasm aimed at audiences, taboo-bordering humour, controversial cultural references. Stay respectful and inclusive.',
    severity: 'STRONG_WARN',
  },
  ironic: {
    pattern_text: 'Avoid ironic / sarcastic framing where intent could be misread. The brand voice is sincere; rhetorical questions and dry wit are fine, but sarcasm is not.',
    severity: 'SOFT_WARN',
  },
  formal_corporate: {
    pattern_text: 'Avoid stiff corporate-speak: passive voice, jargon ("synergy", "leverage"), legalistic phrasing. The brand sounds human, not bureaucratic.',
    severity: 'STRONG_WARN',
  },
  casual_humor: {
    pattern_text: 'Avoid casual humour / memes / slang that undermine credibility. The brand voice is professional even when warm.',
    severity: 'STRONG_WARN',
  },
  western_casual: {
    pattern_text: 'Avoid Western casual register / Anglicisms that feel imported. Voice should sound culturally rooted in Saudi context.',
    severity: 'STRONG_WARN',
  },
}

/**
 * Build the nominations. Returns an empty array if no recognised IDs are
 * supplied — callers should still enqueue the rest.
 */
export function buildNegativePatternNominationsFromToneAnti(
  brand_id: string,
  tone_anti_attribute_ids: string[] | null | undefined,
): unknown[] {
  if (!tone_anti_attribute_ids || tone_anti_attribute_ids.length === 0) return []
  const nominations: unknown[] = []
  const seen = new Set<string>()
  for (const id of tone_anti_attribute_ids) {
    const key = String(id || '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const mapping = TONE_ANTI_TO_PATTERN[key]
    if (!mapping) continue
    nominations.push({
      nomination_type: 'negative_pattern_add',
      brand_id,
      data: {
        pattern_text: mapping.pattern_text,
        severity: mapping.severity,
        reasoning: `User-supplied tone anti-attribute "${key}" at onboarding`,
        source: 'onboarding',
      },
    })
  }
  return nominations
}
