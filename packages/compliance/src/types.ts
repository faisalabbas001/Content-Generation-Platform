/**
 * Compliance Gate — shared types.
 *
 * The gate is the deterministic "Spine" component (OGZ doc §9.2): a pure,
 * LLM-free check that runs BEFORE any paid generation. It cannot be bypassed
 * by an agent prompt. Severity mirrors the existing negpat_severity_type so the
 * verdict slots straight into qa_review_queue.flags / CCO parity.
 */
export type Severity = 'SOFT_WARN' | 'STRONG_WARN' | 'HARD_BLOCK'
export type GateAction = 'pass' | 'warn' | 'block'

/** A text blocklist entry (alcohol, gambling, miracle-cure, …). */
export interface TextPattern {
  pattern_text: string
  severity: Severity
  category: string
  source: 'global' | 'brand'
  /** null = always active; e.g. 'ramadan' | 'ramadan_daylight'. */
  occasion_scope?: string | null
}

/**
 * A cultural gesture / visual hard block (doc §11.1). Detected in the
 * English-only visual brief by keyword, optionally scoped to a register,
 * sector, or occasion window.
 */
export interface GestureBlock {
  gesture_key: string
  severity: Severity
  detection_keywords: string[]
  applies_to_register?: string | null
  applies_to_sector?: string | null
  occasion_scope?: string | null
}

export interface ComplianceRuleSet {
  brand_id: string | null
  text_patterns: TextPattern[]
  gesture_blocks: GestureBlock[]
  /** Lower-cased pattern texts a brand override_rule has explicitly allowed. */
  disabled_pattern_texts: Set<string>
  religious_sensitivity: string | null
  sector: string | null
}

export interface GateContext {
  /** Canonical occasion family ('ramadan' | 'eid' | 'national_day' | …). */
  occasion?: string | null
  /** ISO / "YYYY-MM-DDTHH:..." posting time (carries +03:00 AST offset). */
  posting_time?: string | null
  register?: string | null
  sector?: string | null
}

export interface Match {
  /** pattern_text for negpat, gesture_key for gesture blocks. */
  rule: string
  severity: Severity
  category: string
  source: string
}

export interface ComplianceVerdict {
  action: GateAction
  severity: Severity | 'NONE'
  matched: Match[]
  /** Convenience alias for qa_review_queue.flags parity with the CCO. */
  negpat_flag: Severity | 'NONE'
  /**
   * True when the text contains religious-content keywords (doc §11.4).
   * Does NOT change `action` — callers must force HOLD independently
   * ("never auto-published regardless of confidence score").
   */
  religious_content_detected: boolean
}
