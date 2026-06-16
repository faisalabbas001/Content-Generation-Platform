/**
 * @repo/auth/client — browser-side auth helpers.
 *
 * Imported from 'use client' files only. Wraps the SSR-aware browser
 * Supabase client so sessions land in cookies (readable by proxy.ts +
 * server components on next request).
 */
'use client'

import { browserClient } from '@repo/db/client'
import type { AuthCredentials, AuthResult, OAuthProvider, SignupCredentials } from '../types'

const GENERIC_AUTH_ERROR = 'Authentication failed. Please try again.'

function normalizeAuthError(error: unknown): Error {
  if (error instanceof Error && error.message.trim().length > 0) return error
  return new Error(GENERIC_AUTH_ERROR)
}

async function resolveBrandDashboardRoute(userId: string): Promise<string | undefined> {
  const supabase = browserClient()
  const { data, error } = await supabase
    .from('brand_profiles')
    .select('client_slug')
    .eq('auth_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error || !data || data.length === 0) return undefined
  const slug = data[0]?.client_slug
  return slug ? `/${slug}/dashboard` : undefined
}

export async function signInWithPassword(input: AuthCredentials): Promise<AuthResult> {
  const supabase = browserClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  })
  if (error) throw normalizeAuthError(error)

  const redirectTo = data.user ? await resolveBrandDashboardRoute(data.user.id) : undefined
  return { ok: true, redirectTo: redirectTo ?? '/onboarding-start' }
}

export async function signUpWithPassword(input: SignupCredentials): Promise<AuthResult> {
  const supabase = browserClient()
  const emailRedirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/api/auth/callback` : undefined

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo,
      data: { full_name: input.fullName },
    },
  })
  if (error) throw normalizeAuthError(error)

  if (!data.session) {
    return { ok: true, message: 'Check your email to confirm your account, then sign in.' }
  }

  const redirectTo = data.user ? await resolveBrandDashboardRoute(data.user.id) : undefined
  return { ok: true, redirectTo: redirectTo ?? '/onboarding-start' }
}

export async function signInWithOAuth(provider: OAuthProvider, redirectTo?: string): Promise<void> {
  const supabase = browserClient()
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const next = redirectTo ?? '/onboarding-start'

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
  if (error) throw normalizeAuthError(error)
}

export async function signOut(): Promise<void> {
  const supabase = browserClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw normalizeAuthError(error)
}

/**
 * Requests a password-reset email from Supabase. The user receives a
 * one-time link that lands on `/reset-password?code=...`, with a 1-hour
 * expiry enforced by Supabase Auth.
 *
 * Always resolves successfully even if the email is unknown — this prevents
 * account enumeration (an attacker can't tell whether an email is registered).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const supabase = browserClient()
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${origin}/reset-password`,
  })
  // Swallow "user not found" style errors to prevent account enumeration.
  // Real failures (network, server) still bubble up.
  if (error && error.status && error.status >= 500) {
    throw normalizeAuthError(error)
  }
}

/**
 * Updates the password for the currently-authenticated user. Called from
 * the /reset-password page after Supabase has exchanged the recovery code
 * for a temporary session.
 */
export async function updatePassword(newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }
  const supabase = browserClient()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw normalizeAuthError(error)
}

/**
 * Exchanges the `code` from a Supabase magic-link URL for a session.
 * Used on /reset-password landing — Supabase sends `?code=<uuid>` query
 * which must be exchanged before the user can call updateUser().
 */
export async function exchangeRecoveryCode(code: string): Promise<void> {
  const supabase = browserClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) throw normalizeAuthError(error)
}
