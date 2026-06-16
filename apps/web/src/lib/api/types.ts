export interface ApiErrorShape {
  message: string
  code?: string
  details?: string
}

// Auth types now live in @repo/auth/types — re-export for backwards-compat.
export type { AuthCredentials, SignupCredentials, AuthResult } from '@repo/auth/types'
