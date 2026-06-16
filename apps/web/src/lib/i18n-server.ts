/**
 * Next.js-specific i18n glue.
 *
 *   getLocale() — read the locale cookie at request time (server-only).
 *   getT()      — re-export typed translator factory.
 */
import { cookies } from 'next/headers'
import { COOKIE_NAME, DEFAULT_LOCALE, isLocale, type Locale, getT } from '@repo/i18n'

export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const v = store.get(COOKIE_NAME)?.value
  return isLocale(v) ? v : DEFAULT_LOCALE
}

export async function getServerT() {
  const locale = await getLocale()
  return { locale, t: getT(locale) }
}

export { getT }
