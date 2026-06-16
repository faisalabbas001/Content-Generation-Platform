/**
 * loadComplianceRules(brandId) — assemble the rule set the gate runs against.
 *
 * Reuses getBrandDna() (one parallelized read) for the brand's
 * negative_patterns, the active global_negative_patterns, the override_rules,
 * and the brand's religious_sensitivity/sector. Cultural gesture blocks load
 * from the cultural_gesture_blocks table, falling back to the in-code constants.
 *
 * Resilient by design: if the brand can't be read (mid-onboarding, RLS), the
 * gate still enforces the global blocklist + gesture blocks.
 */
import { adminClient, isDbConfigured, type Db } from '@repo/db/client'
import { getBrandDna, getAllGlobalNegativePatterns } from '@repo/db/queries/brand-dna'
import type { ComplianceRuleSet, GestureBlock, Severity, TextPattern } from './types'
import { CULTURAL_GESTURE_BLOCKS } from './gestures'

// 60-second in-process TTL cache. Keyed by brandId (or '__global__' for the no-dna path).
// Cleared via clearComplianceCache() when admin writes a gesture block.
const _cache = new Map<string, { rules: ComplianceRuleSet; expiresAt: number }>()
const CACHE_TTL_MS = 60_000

export function clearComplianceCache(brandId?: string): void {
  if (brandId) {
    _cache.delete(brandId)
  } else {
    _cache.clear()
  }
}

/**
 * Brand override convention (override_rules table):
 *   rule_key 'allow_pattern'      + rule_value string | string[]  → allow those texts
 *   rule_key 'allow_pattern:<txt>'                                → allow that one text
 * Allowed texts are excluded from matching for this brand.
 */
function collectDisabledPatterns(
  overrides: { rule_key: string; rule_value: unknown; is_active: boolean }[],
): Set<string> {
  const out = new Set<string>()
  for (const r of overrides) {
    if (!r.is_active) continue
    if (r.rule_key === 'allow_pattern') {
      const v = r.rule_value
      if (typeof v === 'string') out.add(v.toLowerCase())
      else if (Array.isArray(v)) for (const t of v) if (typeof t === 'string') out.add(t.toLowerCase())
    } else if (r.rule_key.startsWith('allow_pattern:')) {
      out.add(r.rule_key.slice('allow_pattern:'.length).toLowerCase())
    }
  }
  return out
}

export async function loadGestureBlocks(supabase: Db | null): Promise<GestureBlock[]> {
  if (!supabase) return CULTURAL_GESTURE_BLOCKS
  try {
    const { data, error } = await supabase
      .from('cultural_gesture_blocks')
      .select('*')
      .eq('is_active', true)
    if (error || !Array.isArray(data) || data.length === 0) return CULTURAL_GESTURE_BLOCKS
    return data.map((r) => ({
      gesture_key: r.gesture_key,
      severity: r.severity as Severity,
      detection_keywords: Array.isArray(r.detection_keywords) ? r.detection_keywords : [],
      applies_to_register: r.applies_to_register ?? null,
      applies_to_sector: r.applies_to_sector ?? null,
      occasion_scope: r.occasion_scope ?? null,
    }))
  } catch {
    return CULTURAL_GESTURE_BLOCKS
  }
}

export async function loadComplianceRules(brandId: string, db?: Db): Promise<ComplianceRuleSet> {
  const cacheKey = brandId
  const hit = _cache.get(cacheKey)
  if (hit && Date.now() < hit.expiresAt) return hit.rules

  const supabase = db ?? (isDbConfigured() ? adminClient() : null)
  const dna = await getBrandDna(brandId, supabase ?? undefined)
  const gesture_blocks = await loadGestureBlocks(supabase)

  // Fallback: brand unreadable → global blocklist only (still enforces).
  if (!dna) {
    const globals = await getAllGlobalNegativePatterns(supabase ?? undefined, true)
    const rules: ComplianceRuleSet = {
      brand_id: null,
      text_patterns: globals.map((g) => ({
        pattern_text: g.pattern_text,
        severity: g.severity,
        category: g.category,
        source: 'global' as const,
        occasion_scope: (g as { occasion_scope?: string | null }).occasion_scope ?? null,
      })),
      gesture_blocks,
      disabled_pattern_texts: new Set<string>(),
      religious_sensitivity: null,
      sector: null,
    }
    _cache.set(cacheKey, { rules, expiresAt: Date.now() + CACHE_TTL_MS })
    return rules
  }

  const text_patterns: TextPattern[] = [
    ...dna.global_negative_patterns.map((g) => ({
      pattern_text: g.pattern_text,
      severity: g.severity,
      category: g.category,
      source: 'global' as const,
      occasion_scope: (g as { occasion_scope?: string | null }).occasion_scope ?? null,
    })),
    ...dna.negative_patterns.map((n) => ({
      pattern_text: n.pattern_text,
      severity: n.severity,
      category: 'brand',
      source: 'brand' as const,
      occasion_scope: null,
    })),
  ]

  const rules: ComplianceRuleSet = {
    brand_id: brandId,
    text_patterns,
    gesture_blocks,
    disabled_pattern_texts: collectDisabledPatterns(dna.override_rules),
    religious_sensitivity: (dna.brand.religious_sensitivity as string | null) ?? null,
    sector: (dna.brand.sector as string | null) ?? null,
  }
  _cache.set(cacheKey, { rules, expiresAt: Date.now() + CACHE_TTL_MS })
  return rules
}
