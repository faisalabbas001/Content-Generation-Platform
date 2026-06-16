import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isAdminPrincipal } from '@/lib/admin-access'

export const ADMIN_ACCESS_COOKIE = 'oc_admin_access'
export const ADMIN_REFRESH_COOKIE = 'oc_admin_refresh'

const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

async function getAdminUserByAccessToken(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data.user) {
    return null
  }

  if (!isAdminPrincipal(data.user)) {
    return null
  }

  return data.user
}

export async function getAdminUserOrNull() {
  const store = await cookies()
  const accessToken = store.get(ADMIN_ACCESS_COOKIE)?.value
  if (!accessToken) {
    return null
  }

  return getAdminUserByAccessToken(accessToken)
}

export async function requireAdmin() {
  const user = await getAdminUserOrNull()
  if (!user) {
    redirect('/admin-access')
  }
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
