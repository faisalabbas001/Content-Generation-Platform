/**
 * RLS verification — proves migration 0007's `client_own_insert` policy:
 *   - allows a user to insert a brand_profiles row for themselves
 *   - blocks a user from inserting a row owned by a different user
 *
 * Uses two real Supabase auth users via signInWithPassword. Each created
 * row is cleaned up via direct SQL.
 */
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const SKIP = process.env.SKIP_INTEGRATION === '1'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const dbUrl = process.env.SUPABASE_DB_URL!

function uniqueEmail(tag: string): string {
  return `rls-${tag}+${Date.now()}+${Math.random().toString(36).slice(2, 6)}@openclaw.dev`
}

async function dropUserAndBrand(email: string) {
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await c.connect().catch(() => {})
  try {
    await c.query(
      `delete from public.brand_profiles where auth_user_id = (
         select id from auth.users where email = $1
       )`,
      [email],
    )
    await c.query('delete from auth.users where email = $1', [email])
  } catch { /* best effort */ }
  finally {
    await c.end().catch(() => {})
  }
}

async function makeConfirmedUser(email: string, password: string) {
  // Signup
  const anon1 = createClient(url, anon, { auth: { persistSession: false } })
  const { error: e1 } = await anon1.auth.signUp({ email, password })
  if (e1?.message?.toLowerCase().includes('rate limit')) {
    return null  // signal: skip
  }
  if (e1) throw e1

  // Force-confirm via direct SQL (dev workaround for missing service-role key)
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query(
    `update auth.users set email_confirmed_at = now() where email = $1`,
    [email],
  )
  await c.end()

  // Sign in to get a session
  const session = createClient(url, anon, { auth: { persistSession: false } })
  const { data: signin, error: e2 } = await session.auth.signInWithPassword({ email, password })
  if (e2 || !signin.session) throw e2 ?? new Error('no session')

  // Return a client wired to this user's JWT for subsequent queries.
  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signin.session.access_token}` } },
  })
  return { userId: signin.user!.id, supabase: userClient }
}

describe.skipIf(SKIP)('RLS — brand_profiles INSERT (migration 0007)', () => {
  it('allows a user to insert their OWN brand_profiles row', async () => {
    const email = uniqueEmail('own')
    const password = 'TestPass123!'
    let setup: Awaited<ReturnType<typeof makeConfirmedUser>> = null
    try {
      try {
        setup = await makeConfirmedUser(email, password)
      } catch (e) {
        const msg = (e as Error).message?.toLowerCase() ?? ''
        if (msg.includes('fetch') || msg.includes('etimedout') || msg.includes('enotfound')) {
          console.warn('Skipping: network error during user setup.')
          return
        }
        throw e
      }
      if (!setup) {
        console.warn('Skipping: signup rate-limited.')
        return
      }
      const { userId, supabase } = setup

      const { data, error } = await supabase
        .from('brand_profiles')
        .insert({
          brand_name_ar: 'اختبار',
          brand_name_en: 'Test Brand',
          sector: 'F&B',
          arabic_dialect: 'Najdi',
          primary_channel: 'Instagram',
          client_slug: `rls-test-${Date.now()}`,
          auth_user_id: userId,
        })
        .select('brand_id')
        .single()

      expect(error).toBeNull()
      expect(data?.brand_id).toBeTruthy()
    } finally {
      await dropUserAndBrand(email)
    }
  }, 30_000)

  it('BLOCKS a user from inserting a row with someone ELSE\'S auth_user_id', async () => {
    const emailA = uniqueEmail('a')
    const emailB = uniqueEmail('b')
    const password = 'TestPass123!'
    try {
      let a, b
      try {
        a = await makeConfirmedUser(emailA, password)
        b = await makeConfirmedUser(emailB, password)
      } catch (e) {
        const msg = (e as Error).message?.toLowerCase() ?? ''
        if (msg.includes('fetch') || msg.includes('etimedout') || msg.includes('enotfound')) {
          console.warn('Skipping: network error during user setup.')
          return
        }
        throw e
      }
      if (!a || !b) {
        console.warn('Skipping: signup rate-limited.')
        return
      }

      // User A tries to insert a brand owned by user B.
      const { data, error } = await a.supabase
        .from('brand_profiles')
        .insert({
          brand_name_ar: 'محاولة اختراق',
          sector: 'Other',
          arabic_dialect: 'Najdi',
          primary_channel: 'Instagram',
          client_slug: `rls-attack-${Date.now()}`,
          auth_user_id: b.userId,   // not A's id — RLS WITH CHECK should block
        })
        .select('brand_id')
        .single()

      expect(data).toBeNull()
      expect(error).not.toBeNull()
      expect(error?.message?.toLowerCase()).toMatch(/row-level security|policy/)
    } finally {
      await dropUserAndBrand(emailA)
      await dropUserAndBrand(emailB)
    }
  }, 60_000)
})
