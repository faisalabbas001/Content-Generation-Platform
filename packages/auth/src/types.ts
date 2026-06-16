/**
 * @repo/auth — shared types.
 *
 * Hand-written domain types for auth flows. Avoid leaking Supabase internals
 * across the package boundary.
 */

export interface AuthCredentials {
  email: string
  password: string
}

export interface SignupCredentials extends AuthCredentials {
  fullName: string
}

export interface AuthResult {
  ok: true
  redirectTo?: string
  message?: string
}

export interface AdminPrincipal {
  email?: string | null
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

export type OAuthProvider = 'google'
