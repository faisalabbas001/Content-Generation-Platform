/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookies on every request so users don't
 *      get silently logged out when their access token expires.
 *   2. Coarse route-level access control:
 *        - public routes pass through
 *        - /admin/* requires the oc_admin_access cookie (admin login flow)
 *        - /[slug]/* requires a Supabase session (brand ownership is
 *          re-verified inside the layout — see @repo/auth/server)
 *
 * IMPORTANT: per Next.js 16 docs, server functions are POSTs to the route
 * they live on. A matcher change can silently move them out of coverage.
 * So every server component / server action ALSO calls @repo/auth/server's
 * `requireUser` / `requireBrandAccess` / `requireAdmin`. Belt + braces.
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  refreshSession,
  isPublicPath,
  isAdminPath,
  isClientAppPath,
  hasAdminCookie,
  redirectToLogin,
} from '@repo/auth/proxy'

export async function proxy(request: NextRequest) {
  const { response, userId, pathname } = await refreshSession(request)

  // 1. Public routes — pass through with refreshed cookies.
  if (isPublicPath(pathname)) {
    // Bonus: if a logged-in user hits /login or /signup, send them home.
    if ((pathname === '/login' || pathname === '/signup') && userId) {
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding-start'
      url.search = ''
      return NextResponse.redirect(url)
    }
    return response
  }

  // 2. Admin routes — gated by the admin session cookie. The actual
  //    is_admin / allowlist check happens in the layout (requireAdmin).
  if (isAdminPath(pathname)) {
    if (!hasAdminCookie(request)) {
      return redirectToLogin(request, 'admin')
    }
    return response
  }

  // 3. Client app routes — require a Supabase session. Brand ownership
  //    (auth_user_id matches slug) is verified inside the layout.
  if (isClientAppPath(pathname)) {
    if (!userId) {
      return redirectToLogin(request, 'client')
    }
    // Inject the pathname so the [slug] layout can read it via headers()
    // without needing the Request object (not available in Server Components).
    response.headers.set('x-pathname', pathname)
    return response
  }

  // 4. Fallback (e.g. unknown root segments) — pass through.
  return response
}

export const config = {
  // Run on every path EXCEPT static assets and Next internals. We can't
  // exclude `_next/data` here even by negative match (intentional Next.js
  // behavior — see proxy.md doc).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|images/|fonts/).*)',
  ],
}
