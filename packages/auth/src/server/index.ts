/**
 * @repo/auth/server — server component / server action auth helpers.
 *
 * Reads the current Supabase user from request cookies (set by `@supabase/ssr`).
 * Use these in:
 *   - server components (layout.tsx, page.tsx)
 *   - server actions ('use server')
 *   - API routes (route.ts)
 *
 * Per Next.js 16 docs: always re-verify auth in server functions; do NOT
 * rely on proxy.ts alone (a refactor can silently move a server function
 * out of the matched path).
 */
import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { serverComponentClient } from '@repo/db/client'
import type { Db } from '@repo/db/client'

/** User-scoped Supabase client (RLS-respecting). Pass to query helpers
 *  in `@repo/db/queries/*` so reads honor `auth.uid()`. */
export async function getUserScopedClient(): Promise<Db> {
  return buildClient()
}

async function buildClient(): Promise<Db> {
  const cookieStore = await cookies()
  return serverComponentClient({
    getAll: () => cookieStore.getAll(),
    setAll: (toSet) => {
      // Cookies can only be mutated in server actions / route handlers, not
      // in pure server components. We catch the throw and let the proxy
      // handle refresh on the next request.
      try {
        for (const c of toSet) cookieStore.set(c.name, c.value, c.options)
      } catch {
        /* read-only context */
      }
    },
  })
}

/** Returns the signed-in user or null. Never throws. */
export async function getCurrentUser() {
  const supabase = await buildClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user
}

/** Redirects to `/login?next=<path>` if no user. Returns the user. */
export async function requireUser(opts?: { next?: string }) {
  const user = await getCurrentUser()
  if (!user) {
    const next = opts?.next ? `?next=${encodeURIComponent(opts.next)}` : ''
    redirect(`/login${next}`)
  }
  return user
}

/**
 * Returns the brand_profiles row for the given slug IFF the current user
 * owns it. Otherwise null. Use this in `[slug]/layout.tsx` to gate access.
 *
 * Uses the USER-SCOPED client so RLS's `client_own_select` policy
 * (auth_user_id = auth.uid()) is the source of truth for ownership.
 * We don't try to bypass RLS — the database enforces it for us.
 */
export async function getBrandForCurrentUser(slug: string) {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await buildClient()
  const { data, error } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('client_slug', slug)
    .maybeSingle()

  if (error || !data) return null
  // Defense-in-depth: even though RLS already filters by auth.uid(), assert
  // the row matches the current user.
  if (data.auth_user_id !== user.id) return null
  return data
}

/**
 * Returns the first brand_profiles row owned by the current user, if any.
 * Used for "where do I send a logged-in user?" decisions.
 */
export async function getFirstBrandForCurrentUser() {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await buildClient()
  const { data } = await supabase
    .from('brand_profiles')
    .select('client_slug, brand_id, onboarding_status, total_calendars_generated, completeness_score')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

/**
 * Combines `requireUser` + brand ownership check in one call.
 * Use as the single auth gate at the top of `[slug]/layout.tsx`.
 */
export async function requireBrandAccess(slug: string) {
  const user = await requireUser({ next: `/${slug}/dashboard` })
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) {
    // Authenticated but doesn't own this slug — send to their own dashboard
    // if they have one, otherwise to onboarding.
    redirect('/onboarding-start')
  }
  return { user, brand }
}
