/**
 * @repo/auth/admin — admin auth (separate from client auth).
 *
 * Admin sessions live in two httpOnly cookies (oc_admin_access +
 * oc_admin_refresh). The current Supabase project is shared with client
 * auth, but admins are gated by user_metadata.is_admin OR email allowlist.
 *
 * When a separate admin Supabase project is provisioned (per Doc §2.1),
 * point SUPABASE_ADMIN_URL/SERVICE_KEY at it and swap the createClient call
 * in `getAdminUserByAccessToken`.
 */
import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { AdminPrincipal } from '../types'

export const ADMIN_ACCESS_COOKIE = 'oc_admin_access'
export const ADMIN_REFRESH_COOKIE = 'oc_admin_refresh'
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function parseCsv(value: string | undefined): string[] {
  if (!value) return []
  return value.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
}

export function getAdminAllowlistEmails(): Set<string> {
  const emails = new Set(parseCsv(process.env.ADMIN_ALLOWLIST_EMAILS))
  // Local bootstrap convenience only.
  if (process.env.NODE_ENV !== 'production') {
    emails.add('admin@openclaw.local')
    emails.add('admin@openclaw.dev')
  }
  return emails
}

export function isAdminPrincipal(user: AdminPrincipal): boolean {
  if (user.user_metadata?.is_admin === true) return true
  if (user.app_metadata?.role === 'admin') return true
  const email = user.email?.toLowerCase()
  if (!email) return false
  return getAdminAllowlistEmails().has(email)
}

async function getAdminUserByAccessToken(accessToken: string) {
  const supabaseUrl = process.env.SUPABASE_ADMIN_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data.user) return null
  if (!isAdminPrincipal(data.user)) return null
  return data.user
}

export async function getAdminUserOrNull() {
  const store = await cookies()
  const accessToken = store.get(ADMIN_ACCESS_COOKIE)?.value
  if (!accessToken) return null
  return getAdminUserByAccessToken(accessToken)
}

export async function requireAdmin() {
  const user = await getAdminUserOrNull()
  if (!user) redirect('/admin-access')
  return user
}

export function getAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  }
}
