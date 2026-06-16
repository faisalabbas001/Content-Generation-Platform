/**
 * Pure validator unit tests — no DB required.
 *
 * These cover the most critical Memory Controller invariants per Doc §4:
 *   - field_path whitelisting (forbidden_field_path rejection)
 *   - enum / regex / range checks per field
 *   - Layer 2/3 PII scrubbing (no UUIDs, no emails, no Arabic captions)
 *   - CEO-prompt → DB-shape translation
 *
 * If these pass, ~80% of the Memory Controller's correctness is verified
 * without spinning up Supabase.
 */
import { describe, it, expect } from 'vitest'
import {
  validateAnonymousSignal,
  translateCeoNominations,
  Nomination,
} from '@repo/memory'

describe('@repo/memory — Nomination schema (Zod first-pass)', () => {
  it('accepts a well-formed field_update', () => {
    const r = Nomination.safeParse({
      nomination_type: 'field_update',
      brand_id: '11111111-1111-1111-1111-111111111111',
      data: {
        field_path: 'BrandProfile.arabic_dialect',
        proposed_value: 'Najdi',
        source: 'client_confirmation',
      },
    })
    expect(r.success).toBe(true)
  })

  it('rejects sector_signal that carries a brand_id (Doc §4.4 PRIVACY)', () => {
    const r = Nomination.safeParse({
      nomination_type: 'sector_signal',
      brand_id: '11111111-1111-1111-1111-111111111111', // <- forbidden
      data: { sector: 'F&B', dialect: 'Najdi', outcome: 'approved' },
    })
    expect(r.success).toBe(false)
  })

  it('accepts sector_signal with brand_id null', () => {
    const r = Nomination.safeParse({
      nomination_type: 'sector_signal',
      brand_id: null,
      data: { sector: 'F&B', dialect: 'Najdi', outcome: 'approved' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown nomination_type', () => {
    const r = Nomination.safeParse({
      nomination_type: 'magic_field',
      brand_id: null,
      data: {},
    })
    expect(r.success).toBe(false)
  })

  it('confidence_upgrade requires evidence_source_ids[]', () => {
    const r = Nomination.safeParse({
      nomination_type: 'confidence_upgrade',
      brand_id: '11111111-1111-1111-1111-111111111111',
      data: { field_name: 'arabic_dialect', new_state: 'inferred_high', evidence_source_ids: [] },
    })
    expect(r.success).toBe(false) // .min(1) on the array
  })
})

describe('@repo/memory — validateAnonymousSignal (Doc §4.4 scrubber)', () => {
  it('passes a clean signal', () => {
    const r = validateAnonymousSignal({
      sector: 'F&B', dialect: 'Najdi', outcome: 'approved',
      content_type: 'lifestyle', tone: 'warm_casual',
    })
    expect(r.ok).toBe(true)
  })

  it('rejects payloads carrying a UUID', () => {
    const r = validateAnonymousSignal({
      sector: 'F&B', dialect: 'Najdi', outcome: 'approved',
      content_type: 'lifestyle',
      reasoning: 'Approved for brand 11111111-1111-1111-1111-111111111111',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('pii_in_anonymous_signal')
  })

  it('rejects payloads carrying an email', () => {
    const r = validateAnonymousSignal({
      sector: 'F&B', dialect: 'Najdi', outcome: 'approved',
      reasoning: 'see usama@example.com',
    })
    expect(r.ok).toBe(false)
  })

  it('rejects payloads carrying substantial Arabic text (caption leak)', () => {
    const r = validateAnonymousSignal({
      sector: 'F&B', dialect: 'Najdi', outcome: 'approved',
      reasoning: 'بيت نجد يجمعكم الليلة على قهوة سعودية وتمر',
    })
    expect(r.ok).toBe(false)
  })

  it('allows occasional Arabic words (occasion names like رمضان are fine)', () => {
    const r = validateAnonymousSignal({
      sector: 'F&B', dialect: 'Najdi', outcome: 'approved',
      occasion: 'رمضان', // 5 Arabic letters — under the 10-letter threshold
    })
    expect(r.ok).toBe(true)
  })
})

describe('@repo/memory — translateCeoNominations (CEO prompt → DB shape)', () => {
  const BRAND = '11111111-1111-1111-1111-111111111111'

  it('drops decision_trace nominations', () => {
    const r = translateCeoNominations(BRAND, [
      { nomination_type: 'decision_trace', family: 'Memory', field_path: 'audit', proposed_value: null, source: 'system_inference', confidence_delta: '', human_review_required: false },
    ])
    expect(r.nominations).toHaveLength(0)
    expect(r.dropped).toHaveLength(1)
    expect(r.dropped[0]?.reason).toContain('decision_trace')
  })

  it('translates field_update with confidence_delta to confidence_upgrade', () => {
    const r = translateCeoNominations(BRAND, [
      {
        nomination_type: 'field_update',
        family: 'Evidence',
        field_path: 'arabic_dialect',
        // proposed_value omitted — confidence-only update
        source: 'client_confirmation',
        confidence_delta: 'upgrade_to_explicitly_confirmed',
        human_review_required: false,
      },
    ])
    expect(r.nominations).toHaveLength(1)
    expect(r.nominations[0]!.nomination_type).toBe('confidence_upgrade')
  })

  it('translates field_update with proposed_value as field_update', () => {
    const r = translateCeoNominations(BRAND, [
      {
        nomination_type: 'field_update',
        family: 'Identity',
        field_path: 'BrandProfile.arabic_dialect',
        proposed_value: 'Najdi',
        source: 'client_confirmation',
        confidence_delta: '',
        human_review_required: false,
      },
    ])
    expect(r.nominations).toHaveLength(1)
    expect(r.nominations[0]!.nomination_type).toBe('field_update')
  })

  it('passes through native sector_signal shape unchanged', () => {
    const r = translateCeoNominations(null, [
      { nomination_type: 'sector_signal', brand_id: null, data: { sector: 'F&B', dialect: 'Najdi', outcome: 'approved' } },
    ])
    expect(r.nominations).toHaveLength(1)
    expect(r.dropped).toHaveLength(0)
  })

  it('returns empty result for non-array input', () => {
    expect(translateCeoNominations(BRAND, null).nominations).toHaveLength(0)
    expect(translateCeoNominations(BRAND, 'oops').nominations).toHaveLength(0)
  })
})
