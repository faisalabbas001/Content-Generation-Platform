/**
 * Human-readable prohibition text — the PREVENTION layer (F4).
 *
 * The deterministic gate (gate.ts) is the enforcement backstop; this renders the
 * same rules into a compact instruction string that gets injected into the
 * generation prompts (Visual Composer cultural_constraints, COO Layer 4) so the
 * content is born compliant and the gate rarely has to fire.
 */
import type { ComplianceRuleSet, GateContext } from './types'
import { isRamadanDaylight } from './gestures'

/** English prohibition line for the visual brief (gesture blocks + daylight). */
export function renderVisualProhibitions(rules: ComplianceRuleSet, ctx: GateContext = {}): string {
  const register = ctx.register ?? null
  const sector = ctx.sector ?? rules.sector ?? null
  const ramadanDaylight = isRamadanDaylight(ctx.occasion, ctx.posting_time)

  const active = rules.gesture_blocks.filter((g) => {
    if (g.applies_to_register && register && g.applies_to_register !== register) return false
    if (g.applies_to_sector && sector && g.applies_to_sector !== sector) return false
    if (g.occasion_scope === 'ramadan_daylight') return ramadanDaylight
    if (g.occasion_scope) return ctx.occasion === g.occasion_scope
    return true
  })
  if (active.length === 0) return ''

  const phrases = active.map((g) => g.detection_keywords[0] ?? g.gesture_key)
  return `Never depict: ${phrases.join('; ')}.`
}
