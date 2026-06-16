/**
 * @repo/auth/proxy — helpers for Next.js 16 `proxy.ts` files.
 *
 * Two responsibilities:
 *   1. Refresh the Supabase auth cookies on every request (so the user's
 *      access token doesn't expire mid-session).
 *   2. Decide whether the requested path is public, requires-auth, or
 *      admin-only.
 *
 * Per Next.js 16 docs: this is one of two layers. The other is the auth
 * check inside the page/server-action itself. Don't rely on proxy alone.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_ACCESS_COOKIE } from '../admin'

export interface ProxyAuthResult {
  /** The response to return from proxy.ts (with refreshed cookies). */
  response: NextResponse
  /** The current Supabase user id, if any. */
  userId: string | null
  /** The path requested. */
  pathname: string
}

const PUBLIC_PREFIXES = [
  '/',                  // Marketing home
  '/login',
  '/signup',
  '/admin-access',
  '/forgot-password',   // Public — anonymous reset request flow
  '/reset-password',    // Public — landing for the emailed reset link
  '/about',
  '/pricing',
  '/contact',
  '/legal',
  '/api/auth/callback', // OAuth + email confirm callback
  '/api/admin/auth/login',
  '/api/admin/auth/logout',
  '/score-cards',       // Public share pages — no auth required
  '/api/scorecard',     // Public scoring API
  '/api/webhooks',      // Stripe + n8n — own auth (signature)
  '/api/agents',        // n8n → AI agent calls — own auth (HMAC, see lib/n8n-auth)
  '/api/memory',        // Memory Controller queue processor — own auth (HMAC)
  '/api/processing',    // n8n stage-transition emitter — own auth (HMAC)
  '/_next',
  '/favicon.ico',
  '/sitemap.xml',
  '/robots.txt',
]

const PUBLIC_EXACT = new Set(['/favicon.ico', '/sitemap.xml', '/robots.txt'])

const RESERVED_TOP_LEVEL = new Set([
  '', 'login', 'signup', 'admin', 'admin-access',
  'forgot-password', 'reset-password',
  'about', 'pricing', 'contact', 'legal', 'api', '_next', 'favicon.ico',
  'sitemap.xml', 'robots.txt', 'dev', 'onboarding-start', 'oauth',
])

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** True for anything under `/admin/*` (excluding `/admin-access`). */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

/**
 * True for client app routes `/[slug]/*`.
 * Excludes reserved top-level segments (login, admin, api, etc.).
 */
export function isClientAppPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return false
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return false
  const top = segments[0]!
  if (RESERVED_TOP_LEVEL.has(top)) return false
  return true
}

/**
 * Refreshes the Supabase session via cookies and returns the user id.
 * Always returns a NextResponse with up-to-date cookies — pass it through
 * to keep the session alive.
 */
export async function refreshSession(request: NextRequest): Promise<ProxyAuthResult> {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { response, userId: null, pathname: request.nextUrl.pathname }
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const c of toSet) {
          request.cookies.set(c.name, c.value)
        }
        response = NextResponse.next({ request: { headers: request.headers } })
        for (const c of toSet) {
          response.cookies.set(c.name, c.value, c.options)
        }
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  return { response, userId: data.user?.id ?? null, pathname: request.nextUrl.pathname }
}

export function hasAdminCookie(request: NextRequest): boolean {
  return Boolean(request.cookies.get(ADMIN_ACCESS_COOKIE)?.value)
}

/**
 * Build a redirect response that preserves a `next` query param so we can
 * send the user back where they came from after login.
 */
export function redirectToLogin(request: NextRequest, redirectKind: 'client' | 'admin'): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = redirectKind === 'admin' ? '/admin-access' : '/login'
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url)
}
