import type { FieldConfidence, PostStatus, QaStatus, ConfidenceMode } from '@repo/db/types'
import { LOCALE_META, type Locale, type Translator } from '@repo/i18n'

export function formatDate(iso: string | null | undefined, locale: Locale = 'ar'): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(LOCALE_META[locale].intlTag, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatDateOnly(iso: string | null | undefined, locale: Locale = 'ar'): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(LOCALE_META[locale].intlTag, { dateStyle: 'medium' })
}

// ── Tones ──────────────────────────────────────────────────────────
export function confidenceTone(c: FieldConfidence): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (c) {
    case 'explicitly_confirmed':
    case 'inferred_high':
      return 'success'
    case 'inferred_medium':
      return 'info'
    case 'inferred_low':
      return 'warning'
    case 'rejected':
    case 'deprecated':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function postStatusTone(s: PostStatus): 'success' | 'warning' | 'info' | 'neutral' {
  return s === 'approved' ? 'success' : s === 'pending' ? 'warning' : 'neutral'
}

export function qaStatusTone(s: QaStatus): 'warning' | 'success' | 'danger' | 'info' {
  return s === 'pending' ? 'warning' : s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'info'
}

export function confidenceModeTone(m: ConfidenceMode | null): 'success' | 'info' | 'warning' | 'danger' {
  if (!m) return 'info'
  return m === 'Standard' ? 'success' : m === 'Cautious' ? 'info' : m === 'Minimal' ? 'warning' : 'danger'
}

// ── Locale-aware labels ────────────────────────────────────────────
export function confidenceLabel(c: FieldConfidence, t: Translator): string {
  return t(`confidence.${c}` as Parameters<Translator>[0])
}

export function postStatusLabel(s: PostStatus, t: Translator): string {
  return t(`postStatus.${s}` as Parameters<Translator>[0])
}

export function qaStatusLabel(s: QaStatus, t: Translator): string {
  return t(`qaStatus.${s}` as Parameters<Translator>[0])
}

export function tierLabel(tier: string, t: Translator): string {
  return t(`tier.${tier}` as Parameters<Translator>[0])
}

export function sarCents(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `$${Number(n).toFixed(4)}`
}
