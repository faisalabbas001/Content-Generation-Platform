import { describe, it, expect } from 'vitest'
import { checkCaption, checkVisualBrief } from './gate'
import { CULTURAL_GESTURE_BLOCKS } from './gestures'
import type { ComplianceRuleSet } from './types'

const rules: ComplianceRuleSet = {
  brand_id: 'test',
  text_patterns: [
    { pattern_text: 'alcohol', severity: 'HARD_BLOCK', category: 'alcohol_substances', source: 'global' },
    { pattern_text: 'cure', severity: 'HARD_BLOCK', category: 'false_claims', source: 'global' },
    { pattern_text: 'خمر', severity: 'HARD_BLOCK', category: 'alcohol_substances', source: 'global' },
    { pattern_text: 'limited time only', severity: 'SOFT_WARN', category: 'urgency', source: 'global' },
  ],
  gesture_blocks: CULTURAL_GESTURE_BLOCKS,
  disabled_pattern_texts: new Set<string>(),
  religious_sensitivity: 'High',
  sector: 'F&B',
}

describe('checkCaption', () => {
  it('blocks an English HARD_BLOCK term', () => {
    expect(checkCaption('drink alcohol tonight', rules).action).toBe('block')
  })
  it('blocks an Arabic HARD_BLOCK term (substring)', () => {
    expect(checkCaption('عرض على الخمر', rules).action).toBe('block')
  })
  it('does NOT false-positive "cure" inside "manicure"', () => {
    expect(checkCaption('best manicure and pedicure deals', rules).action).toBe('pass')
  })
  it('blocks a bare "cure" claim (word boundary)', () => {
    expect(checkCaption('this product will cure you', rules).action).toBe('block')
  })
  it('warns on a SOFT_WARN term', () => {
    expect(checkCaption('limited time only offer', rules).action).toBe('warn')
  })
  it('passes a clean caption', () => {
    expect(checkCaption('قهوتنا الطازجة بانتظاركم', rules).action).toBe('pass')
  })
  it('respects override_rules that allow a pattern', () => {
    const relaxed = { ...rules, disabled_pattern_texts: new Set(['alcohol']) }
    expect(checkCaption('alcohol-free mojito', relaxed).action).toBe('pass')
  })
})

describe('checkVisualBrief', () => {
  it('blocks a cultural gesture (left-hand serving)', () => {
    expect(checkVisualBrief('a waiter serving with the left hand', rules).action).toBe('block')
  })
  it('does NOT block a negated cultural-safety instruction ("no left-hand serving")', () => {
    // Visual prompts carry cultural_constraints like "no faces, avoid left hand".
    // The brief is instructing the model to AVOID the gesture, not depict it.
    expect(
      checkVisualBrief('warm family meal, halal presentation, no left-hand serving, no faces', rules).action,
    ).toBe('pass')
    expect(checkVisualBrief('cozy cafe scene, avoid left hand serving', rules).action).toBe('pass')
  })
  it('still blocks a genuine depiction even when other negations are present', () => {
    expect(
      checkVisualBrief('no faces, a waiter serving with the left hand to a guest', rules).action,
    ).toBe('block')
  })
  it('blocks food during Ramadan daylight', () => {
    expect(
      checkVisualBrief('a man eating kabsa', rules, { occasion: 'ramadan', posting_time: '2026-03-12T13:00:00+03:00' }).action,
    ).toBe('block')
  })
  it('allows food after Maghrib during Ramadan', () => {
    expect(
      checkVisualBrief('a man eating kabsa', rules, { occasion: 'ramadan', posting_time: '2026-03-12T20:00:00+03:00' }).action,
    ).toBe('pass')
  })
  it('allows food when no occasion is active', () => {
    expect(checkVisualBrief('a man eating kabsa', rules, {}).action).toBe('pass')
  })
})
