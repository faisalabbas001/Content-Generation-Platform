'use client'

/**
 * Re-export client auth from `@repo/auth/client` so existing imports keep
 * working. New code should import directly from '@repo/auth/client'.
 */
export {
  signInWithPassword,
  signUpWithPassword,
  signInWithOAuth,
  signOut,
  requestPasswordReset,
  updatePassword,
  exchangeRecoveryCode,
} from '@repo/auth/client'
