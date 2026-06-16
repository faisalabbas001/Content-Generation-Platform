'use client'

import { useApiMutation } from './use-api-mutation'
import {
  signInWithPassword,
  signOut,
  signUpWithPassword,
  requestPasswordReset,
  updatePassword,
  type AuthCredentials,
  type SignupCredentials,
} from '@/lib/api'

export function useLogin() {
  return useApiMutation<AuthCredentials, Awaited<ReturnType<typeof signInWithPassword>>>(
    signInWithPassword,
  )
}

export function useSignup() {
  return useApiMutation<SignupCredentials, Awaited<ReturnType<typeof signUpWithPassword>>>(
    signUpWithPassword,
  )
}

export function useLogout() {
  return useApiMutation<void, void>(async () => {
    await signOut()
  })
}

export function useForgotPassword() {
  return useApiMutation<{ email: string }, void>(async ({ email }) => {
    await requestPasswordReset(email)
  })
}

export function useResetPassword() {
  return useApiMutation<{ password: string }, void>(async ({ password }) => {
    await updatePassword(password)
  })
}
