/**
 * Tests `isAdminPrincipal` allowlist behavior.
 * Pure unit test — no Supabase calls.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { isAdminPrincipal, getAdminAllowlistEmails } from '@repo/auth/admin'

describe('@repo/auth/admin', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.ADMIN_ALLOWLIST_EMAILS = 'admin@openclaw.dev,owner@example.com'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('honors user_metadata.is_admin', () => {
    expect(isAdminPrincipal({ user_metadata: { is_admin: true } })).toBe(true)
  })

  it('honors app_metadata.role=admin', () => {
    expect(isAdminPrincipal({ app_metadata: { role: 'admin' } })).toBe(true)
  })

  it('matches allowlist emails (case-insensitive)', () => {
    expect(isAdminPrincipal({ email: 'admin@openclaw.dev' })).toBe(true)
    expect(isAdminPrincipal({ email: 'ADMIN@OPENCLAW.DEV' })).toBe(true)
    expect(isAdminPrincipal({ email: 'OWNER@example.com' })).toBe(true)
  })

  it('rejects non-allowlisted emails without is_admin flag', () => {
    expect(isAdminPrincipal({ email: 'attacker@evil.example' })).toBe(false)
  })

  it('rejects principals with no email and no metadata', () => {
    expect(isAdminPrincipal({})).toBe(false)
  })

  it('includes dev-only bootstrap address in non-prod', () => {
    const set = getAdminAllowlistEmails()
    expect(set.has('admin@openclaw.local')).toBe(true)
  })
})
