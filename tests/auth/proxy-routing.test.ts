/**
 * Tests the proxy.ts routing decision logic — independent of the actual
 * Supabase session check (which happens in `refreshSession`).
 */
import { describe, expect, it } from 'vitest'
import { isPublicPath, isAdminPath, isClientAppPath } from '@repo/auth/proxy'

describe('@repo/auth/proxy routing', () => {
  describe('isPublicPath', () => {
    it.each([
      '/',
      '/login',
      '/login/',
      '/signup',
      '/admin-access',
      '/about',
      '/pricing',
      '/contact',
      '/legal/privacy',
      '/api/auth/callback',
      '/api/admin/auth/login',
      '/api/webhooks/stripe',
      '/api/agents/ceo/classify',
      '/api/agents/coo/build-branddna',
      '/_next/static/chunks/abc.js',
      '/favicon.ico',
    ])('treats %s as public', (path) => {
      expect(isPublicPath(path)).toBe(true)
    })

    it.each(['/admin', '/admin/clients', '/some-brand-slug', '/some-brand-slug/dashboard'])(
      'treats %s as NOT public',
      (path) => {
        expect(isPublicPath(path)).toBe(false)
      },
    )
  })

  describe('isAdminPath', () => {
    it.each(['/admin', '/admin/clients', '/admin/qa'])('matches admin path %s', (p) => {
      expect(isAdminPath(p)).toBe(true)
    })
    it('does NOT match /admin-access', () => {
      expect(isAdminPath('/admin-access')).toBe(false)
    })
  })

  describe('isClientAppPath', () => {
    it.each(['/najd-restaurant', '/najd-restaurant/dashboard', '/some-slug/calendar'])(
      'identifies %s as client app path',
      (p) => {
        expect(isClientAppPath(p)).toBe(true)
      },
    )
    it.each(['/', '/login', '/admin', '/api/x', '/about', '/onboarding-start'])(
      'rejects reserved %s',
      (p) => {
        expect(isClientAppPath(p)).toBe(false)
      },
    )
  })
})
