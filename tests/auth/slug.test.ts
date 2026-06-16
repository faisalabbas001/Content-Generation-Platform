/**
 * Unit tests for slug generation rules.
 * Run via:  pnpm test
 */
import { describe, expect, it } from 'vitest'
import { generateSlug, nextCandidate, isReservedSlug } from '@repo/auth/slug'

describe('@repo/auth/slug', () => {
  it('uses brand_name_en when present', () => {
    const slug = generateSlug({ brand_name_ar: 'مطعم نجد', brand_name_en: 'Najd Restaurant' })
    expect(slug).toMatch(/^najd-restaurant-[a-z0-9]{4}$/)
  })

  it('transliterates Arabic when no English name', () => {
    const slug = generateSlug({ brand_name_ar: 'مطعم نجد' })
    expect(slug).toMatch(/^[a-z0-9-]+-[a-z0-9]{4}$/)
    expect(slug.length).toBeGreaterThan(5)
  })

  it('falls back to "brand" for unrenderable input', () => {
    const slug = generateSlug({ brand_name_ar: '!@#$%^' })
    expect(slug).toMatch(/^brand-[a-z0-9]{4}$/)
  })

  it('produces a different suffix on nextCandidate', () => {
    const a = generateSlug({ brand_name_ar: 'X', brand_name_en: 'Test Brand' })
    const b = nextCandidate(a)
    expect(a).not.toEqual(b)
    expect(b).toMatch(/^test-brand-[a-z0-9]{4}$/)
  })

  it('flags reserved slugs', () => {
    expect(isReservedSlug('admin')).toBe(true)
    expect(isReservedSlug('login')).toBe(true)
    expect(isReservedSlug('onboarding-start')).toBe(true)
    expect(isReservedSlug('najd-restaurant')).toBe(false)
  })

  it('truncates to 40 chars before suffix', () => {
    const long = 'a'.repeat(80)
    const slug = generateSlug({ brand_name_ar: long })
    // root <= 40 + '-' + 4 = 45 max
    expect(slug.length).toBeLessThanOrEqual(45)
  })
})
