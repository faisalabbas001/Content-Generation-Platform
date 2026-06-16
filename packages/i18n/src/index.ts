/**
 * @repo/i18n — Arabic / English locale system
 *
 * Server-rendered, cookie-based. No client hydration mismatch.
 *
 * Usage in a server component:
 *
 *   import { getT } from '@repo/i18n'
 *   const t = getT(locale)
 *   return <h1>{t('landing.title')}</h1>
 */

import ar from './locales/ar.json'
import en from './locales/en.json'

export const LOCALES = ['ar', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ar'
export const COOKIE_NAME = 'oc-locale'

export type Direction = 'rtl' | 'ltr'

export const LOCALE_META: Record<Locale, { label: string; nativeLabel: string; dir: Direction; intlTag: string }> = {
  ar: { label: 'Arabic',  nativeLabel: 'العربية',  dir: 'rtl', intlTag: 'ar-SA' },
  en: { label: 'English', nativeLabel: 'English', dir: 'ltr', intlTag: 'en-US' },
}

export const dictionaries = { ar, en } as const
export type Dictionary = typeof ar

// ── typed key paths (e.g. 'landing.brandsSection.title') ──
type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Prev<N extends number> = N extends 6 ? 5 : N extends 5 ? 4 : N extends 4 ? 3 : N extends 3 ? 2 : N extends 2 ? 1 : 0
type Paths<T, D extends number = 6> = D extends 0
  ? never
  : T extends object
    ? { [K in keyof T]-?: K extends string ? K | Join<K, Paths<T[K], Prev<D>>> : never }[keyof T]
    : never
export type TKey = Paths<Dictionary>

function lookup(dict: Dictionary, key: string): string {
  const parts = key.split('.')
  let cur: unknown = dict
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return key
    }
  }
  return typeof cur === 'string' ? cur : key
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`))
}

export type Translator = (key: TKey, vars?: Record<string, string | number>) => string

export function getT(locale: Locale): Translator {
  const dict = (dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]) as Dictionary
  return (key, vars) => interpolate(lookup(dict, key), vars)
}

export function direction(locale: Locale): Direction {
  return LOCALE_META[locale].dir
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
