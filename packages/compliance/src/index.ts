/**
 * @repo/compliance — the deterministic Compliance Gate (Spine, OGZ doc §9.2).
 *
 * LLM-free, cannot be bypassed by a prompt. Runs BEFORE paid generation:
 *   - checkCaption    after DeepSeek, before CCO/image (cheap fail-fast)
 *   - checkVisualBrief after the composer, before the image model
 *
 * Public API:
 *   loadComplianceRules(brandId, db?)  → ComplianceRuleSet
 *   checkCaption(text, rules, ctx)     → ComplianceVerdict
 *   checkVisualBrief(brief, rules, ctx)→ ComplianceVerdict
 *   isRamadanDaylight(occasion, time)  → boolean
 *
 * ComplianceVerdict.religious_content_detected → true when the text contains
 *   keywords from RELIGIOUS_CONTENT_KEYWORDS_AR/EN; callers must force HOLD
 *   (doc §11.4 — never auto-published regardless of confidence score).
 */
export { loadComplianceRules, loadGestureBlocks, clearComplianceCache } from './rules'
export { checkCaption, checkVisualBrief } from './gate'
export { renderVisualProhibitions } from './render'
export { isRamadanDaylight, CULTURAL_GESTURE_BLOCKS, RELIGIOUS_CONTENT_KEYWORDS_AR, RELIGIOUS_CONTENT_KEYWORDS_EN } from './gestures'
export type {
  Severity,
  GateAction,
  TextPattern,
  GestureBlock,
  ComplianceRuleSet,
  GateContext,
  Match,
  ComplianceVerdict,
} from './types'
