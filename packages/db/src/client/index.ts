/**
 * Supabase client factories.
 *
 *   browserClient()         — RLS-scoped, uses anon key. Safe in the browser.
 *   serverClient()          — RLS-scoped per-request client (server only).
 *   serverComponentClient() — Cookie-aware SSR client for RSCs / server actions.
 *   adminClient()           — service_role key. Server-only. Bypasses RLS.
 *
 * IMPORTANT — Turbopack/Webpack inlining:
 *   `process.env.NEXT_PUBLIC_X` (literal access) is statically replaced at
 *   bundle time and reaches the browser. `process.env[varName]` (dynamic
 *   access) is NOT replaced and returns `undefined` in the browser. So in
 *   any function that may run in the browser (browserClient,
 *   serverComponentClient, isPublicDbConfigured) we MUST use literal access.
 *   Server-only functions (adminClient, serverClient on the server) can
 *   read non-NEXT_PUBLIC vars normally.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr'
import type { Database } from '../schema/database.types'

export type Db = SupabaseClient<Database>

export interface CookieAdapter {
  getAll(): Array<{ name: string; value: string }>
  setAll(cookies: Array<{ name: string; value: string; options?: CookieOptions }>): void
}

export class DbNotConfiguredError extends Error {
  constructor(missingKey: string) {
    super(
      `Supabase env var "${missingKey}" is not set. ` +
        `Copy .env.example → .env.local at the repo root and fill in your Supabase project values, ` +
        `then run \`pnpm db:setup\` and restart the dev server.`,
    )
    this.name = 'DbNotConfiguredError'
  }
}

// ── Static (literal) access for vars that ship to the browser ──────────
// These references are statically replaced by the bundler at build time.
function publicSupabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!v) throw new DbNotConfiguredError('NEXT_PUBLIC_SUPABASE_URL')
  return v
}

function publicSupabaseAnonKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!v) throw new DbNotConfiguredError('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return v
}

// ── Server-only env access (dynamic is fine on the server) ─────────────
function serverSupabaseUrl(): string {
  const v = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!v) throw new DbNotConfiguredError('SUPABASE_URL')
  return v
}

function serverServiceRoleKey(): string {
  const v = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!v) throw new DbNotConfiguredError('SUPABASE_SERVICE_ROLE_KEY')
  return v
}

/** True when the admin (service_role) credentials are present. Server-only. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** True when the browser/anon credentials are present. */
export function isPublicDbConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

/**
 * Browser client — backed by `@supabase/ssr` so the session is stored in
 * cookies (readable by middleware/proxy + RSCs). Use this in client
 * components for sign-in/up, signOut, and reading the user.
 */
export function browserClient(): Db {
  return createBrowserClient<Database>(publicSupabaseUrl(), publicSupabaseAnonKey())
}

/**
 * Server client (no cookies) — for read-only queries that don't depend on
 * user identity (public lookups, sector baselines, etc.). Will NOT see a
 * logged-in user's session.
 */
export function serverClient(): Db {
  return createClient<Database>(publicSupabaseUrl(), publicSupabaseAnonKey(), {
    auth: { persistSession: false },
  })
}

/**
 * Server-component client wired to Next.js cookies — RLS-scoped to the
 * currently signed-in user. Pass `cookies()` from `next/headers`.
 *
 * Usage:
 *   import { cookies } from 'next/headers'
 *   const supabase = serverComponentClient(await cookies())
 *   const { data } = await supabase.auth.getUser()
 */
export function serverComponentClient(cookieStore: CookieAdapter): Db {
  return createServerClient<Database>(publicSupabaseUrl(), publicSupabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => cookieStore.setAll(toSet),
    },
  })
}

/**
 * SERVER-SIDE ONLY. Never import from `'use client'` files.
 * Uses service_role; bypasses RLS. Use for admin panel + seeding.
 */
export function adminClient(): Db {
  return createClient<Database>(serverSupabaseUrl(), serverServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
