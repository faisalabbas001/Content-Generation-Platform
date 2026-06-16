/**
 * The deterministic gate itself — pure functions, no I/O, no LLM.
 *
 *   checkCaption(text, rules, ctx)     → scan generated Arabic/English caption
 *   checkVisualBrief(brief, rules, ctx)→ scan the English visual brief
 *
 * Both return a ComplianceVerdict whose `action` is:
 *   'block' — a HARD_BLOCK matched → caller must NOT generate / must hold
 *   'warn'  — STRONG_WARN/SOFT_WARN matched → route to QA / watermark
 *   'pass'  — clean
 */
import type { ComplianceRuleSet, ComplianceVerdict, GateContext, Match, Severity } from './types'
import { isRamadanDaylight, RELIGIOUS_CONTENT_KEYWORDS_AR, RELIGIOUS_CONTENT_KEYWORDS_EN } from './gestures'

const RANK: Record<Severity | 'NONE', number> = {
  NONE: 0,
  SOFT_WARN: 1,
  STRONG_WARN: 2,
  HARD_BLOCK: 3,
}

const isAscii = (s: string): boolean => /^[\x00-\x7f]+$/.test(s)

/**
 * Negation cues. When a banned phrase is immediately preceded by one of these,
 * the brief is INSTRUCTING the model to avoid the gesture (a cultural-safety
 * instruction like "no left-hand serving" / "avoid left hand") rather than
 * depicting it. Our visual prompts routinely carry such guidance
 * (cultural_constraints, e.g. "no faces, avoid left hand"), so without this the
 * gate hard-blocks its own safety text and the image never generates.
 */
const NEGATION_CUES = new Set([
  'no', 'not', 'never', 'without', 'avoid', 'avoiding', 'avoids',
  'exclude', 'excluding', 'omit', 'omitting', 'sans', 'free',
  'dont', "don't", 'forbid', 'forbidden', 'prohibit', 'prohibited',
])

/** True when the text right before `matchStart` is a negation cue. */
function isNegatedBefore(haystackLower: string, matchStart: number): boolean {
  const window = haystackLower.slice(Math.max(0, matchStart - 28), matchStart)
  const tokens = window.split(/[^a-z']+/i).filter(Boolean)
  // Last few tokens cover multi-word cues like "free of" / "do not".
  return tokens.slice(-3).some((t) => NEGATION_CUES.has(t))
}

/**
 * Match a single pattern against already-lower-cased haystack.
 * ASCII patterns use a non-alphanumeric boundary so "cure" does NOT fire on
 * "manicure"/"secure". Arabic patterns use substring (the seeds are whole words
 * and Arabic word boundaries are unreliable in JS regex).
 *
 * `negationAware` (visual-brief scans only): a match preceded by a negation cue
 * is treated as a safety instruction, not a violation. A non-negated occurrence
 * still matches, so a genuine "serving with the left hand" is unaffected.
 */
function patternMatches(haystackLower: string, patternLower: string, negationAware = false): boolean {
  if (!patternLower) return false
  if (isAscii(patternLower)) {
    const esc = patternLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!negationAware) {
      return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(haystackLower)
    }
    const re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'ig')
    let m: RegExpExecArray | null
    while ((m = re.exec(haystackLower)) !== null) {
      const start = m.index + (m[1]?.length ?? 0)
      if (!isNegatedBefore(haystackLower, start)) return true
      if (re.lastIndex === m.index) re.lastIndex++ // guard against zero-width loops
    }
    return false
  }
  return haystackLower.includes(patternLower)
}

function scopeActive(
  scope: string | null | undefined,
  ctx: GateContext,
  ramadanDaylight: boolean,
): boolean {
  if (!scope) return true
  if (scope === 'ramadan_daylight') return ramadanDaylight
  return ctx.occasion === scope
}

function verdictFrom(matched: Match[], religious_content_detected = false): ComplianceVerdict {
  let top: Severity | 'NONE' = 'NONE'
  for (const m of matched) if (RANK[m.severity] > RANK[top]) top = m.severity
  const action = top === 'HARD_BLOCK' ? 'block' : top === 'NONE' ? 'pass' : 'warn'
  return { action, severity: top, matched, negpat_flag: top, religious_content_detected }
}

/** Scan a generated caption (Arabic or English) against the text blocklist. */
export function checkCaption(
  text: string,
  rules: ComplianceRuleSet,
  ctx: GateContext = {},
): ComplianceVerdict {
  const hay = (text ?? '').toLowerCase()
  const ramadanDaylight = isRamadanDaylight(ctx.occasion, ctx.posting_time)
  const matched: Match[] = []
  for (const p of rules.text_patterns) {
    if (rules.disabled_pattern_texts.has(p.pattern_text.toLowerCase())) continue
    if (!scopeActive(p.occasion_scope, ctx, ramadanDaylight)) continue
    if (patternMatches(hay, p.pattern_text.toLowerCase())) {
      matched.push({ rule: p.pattern_text, severity: p.severity, category: p.category, source: p.source })
    }
  }
  // Doc §11.4: religious content always routes to human review.
  // Arabic uses substring (word boundaries unreliable); English uses patternMatches.
  const religious_content_detected =
    RELIGIOUS_CONTENT_KEYWORDS_AR.some((k) => hay.includes(k)) ||
    RELIGIOUS_CONTENT_KEYWORDS_EN.some((k) => patternMatches(hay, k))
  return verdictFrom(matched, religious_content_detected)
}

/**
 * Scan the English visual brief against (1) cultural gesture blocks and
 * (2) the ASCII HARD_BLOCK text patterns (alcohol/gambling/etc. can describe a
 * visual scene, not just a caption).
 */
export function checkVisualBrief(
  brief: string,
  rules: ComplianceRuleSet,
  ctx: GateContext = {},
): ComplianceVerdict {
  const hay = (brief ?? '').toLowerCase()
  const ramadanDaylight = isRamadanDaylight(ctx.occasion, ctx.posting_time)
  const register = ctx.register ?? null
  const sector = ctx.sector ?? rules.sector ?? null
  const matched: Match[] = []

  for (const g of rules.gesture_blocks) {
    if (g.applies_to_register && register && g.applies_to_register !== register) continue
    if (g.applies_to_sector && sector && g.applies_to_sector !== sector) continue
    if (!scopeActive(g.occasion_scope, ctx, ramadanDaylight)) continue
    if (g.detection_keywords.some((k) => patternMatches(hay, k.toLowerCase(), true))) {
      matched.push({ rule: g.gesture_key, severity: g.severity, category: 'cultural_gesture', source: 'gesture' })
    }
  }

  for (const p of rules.text_patterns) {
    if (p.severity !== 'HARD_BLOCK' || !isAscii(p.pattern_text)) continue
    if (rules.disabled_pattern_texts.has(p.pattern_text.toLowerCase())) continue
    if (!scopeActive(p.occasion_scope, ctx, ramadanDaylight)) continue
    if (patternMatches(hay, p.pattern_text.toLowerCase(), true)) {
      matched.push({ rule: p.pattern_text, severity: p.severity, category: p.category, source: p.source })
    }
  }

  // Doc §11.4: religious visual content (English brief) always routes to human review.
  const religious_content_detected = RELIGIOUS_CONTENT_KEYWORDS_EN.some((k) => patternMatches(hay, k))
  return verdictFrom(matched, religious_content_detected)
}
