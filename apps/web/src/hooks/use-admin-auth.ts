'use client'

import { useApiMutation } from './use-api-mutation'
import { signInAdmin, signOutAdmin, type AuthCredentials } from '@/lib/api'

export function useAdminLogin() {
  return useApiMutation<AuthCredentials, Awaited<ReturnType<typeof signInAdmin>>>(signInAdmin)
}

export function useAdminLogout() {
  return useApiMutation<void, Awaited<ReturnType<typeof signOutAdmin>>>(async () => signOutAdmin())
}
