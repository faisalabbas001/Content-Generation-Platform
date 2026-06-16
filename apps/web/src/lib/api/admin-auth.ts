'use client'

import { apiFetch } from './http'
import type { AuthCredentials, AuthResult } from './types'

export async function signInAdmin(input: AuthCredentials): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function signOutAdmin(): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/admin/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
