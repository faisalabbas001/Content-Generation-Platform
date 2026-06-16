/**
 * Slug generation for client_slug.
 *
 * Auto-generates a URL-safe slug from brand_name_ar (or _en fallback).
 * Strategy:
 *   1. Take brand_name_en if present (already Latin-safe).
 *   2. Otherwise transliterate brand_name_ar (basic mapping).
 *   3. Lowercase, replace whitespace with -, strip non [a-z0-9-].
 *   4. Append a 4-char random suffix to avoid collisions.
 *
 * Caller verifies uniqueness against brand_profiles.client_slug and retries
 * with a fresh suffix on conflict (small loop is fine — collisions are rare).
 */

const ARABIC_TRANSLIT: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'aa', ب: 'b', ت: 't', ث: 'th',
  ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z',
  س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l',
  م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y', ى: 'a', ة: 'a',
  ء: '', ؤ: 'w', ئ: 'y', ' ': '-', ' ': '-',
}

function transliterate(input: string): string {
  let out = ''
  for (const ch of input) {
    out += ARABIC_TRANSLIT[ch] ?? ch
  }
  return out
}

function randomSuffix(len = 4): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789' // no l, o, 0, 1
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

export interface SlugInput {
  brand_name_en?: string | null
  brand_name_ar: string
}

/**
 * Generates a candidate slug. Caller should test for collision and call
 * `nextCandidate` if taken (just regenerates the suffix).
 */
export function generateSlug(input: SlugInput): string {
  const base = (input.brand_name_en && input.brand_name_en.trim()) || input.brand_name_ar
  const transliterated = transliterate(base.trim())
  const cleaned = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

  // Guarantee non-empty + unique-ish via random suffix.
  const root = cleaned.length === 0 ? 'brand' : cleaned
  return `${root}-${randomSuffix()}`
}

/** Re-roll the suffix while keeping the root stable. */
export function nextCandidate(slug: string): string {
  const root = slug.replace(/-[a-z0-9]{4}$/, '')
  return `${root}-${randomSuffix()}`
}

const RESERVED = new Set([
  'admin', 'api', 'login', 'signup', 'logout', 'auth', 'admin-access',
  'about', 'pricing', 'contact', 'apply', 'legal', 'privacy', 'terms', 'pdpl',
  'dev', 'public', 'static', 'images', '_next', 'favicon.ico',
  'onboarding-start', 'oauth', 'callback', 'sitemap.xml', 'robots.txt',
])

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase())
}
