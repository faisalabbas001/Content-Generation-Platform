/**
 * Theme glue (server-only).
 *
 * The active theme ('dark' | 'light') is stored in a cookie so the server
 * can stamp `data-theme` on <html> during SSR — this avoids a flash of the
 * wrong theme on first paint. Mirrors the locale cookie pattern.
 *
 * Default is 'dark' (the app/dashboard look). Marketing pages may force a
 * theme via their own layout if desired, but the toggle lets users override.
 */
import { cookies } from 'next/headers'

export type Theme = 'dark' | 'light'

export const THEME_COOKIE = 'oc-theme'
export const DEFAULT_THEME: Theme = 'dark'

export function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light'
}

export async function getTheme(): Promise<Theme> {
  const store = await cookies()
  const v = store.get(THEME_COOKIE)?.value
  return isTheme(v) ? v : DEFAULT_THEME
}
