/**
 * Integration tests — hit the real Supabase project from .env.local.
 *
 * Skip with SKIP_INTEGRATION=1 when offline. Each test creates a unique
 * test user (random email prefix) and tears it down via direct SQL when
 * possible (we can if the service-role key is set; otherwise we leave
 * orphans — they're harmless, just count toward your auth.users limit).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const SKIP = process.env.SKIP_INTEGRATION === '1'

beforeAll(() => {
  // dotenv is auto-loaded via vitest.setup.ts.
})

function uniqueEmail(prefix = 'qa'): string {
  return `${prefix}+${Date.now()}+${Math.random().toString(36).slice(2, 7)}@openclaw.dev`
}

async function dropUser(email: string) {
  const url = process.env.SUPABASE_DB_URL ?? ''
  if (!url) return
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect().catch(() => {})
  try {
    await c.query('delete from auth.users where email = $1', [email])
  } catch {
    /* ignore */
  } finally {
    await c.end().catch(() => {})
  }
}

describe.skipIf(SKIP)('Supabase auth integration', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  it('rejects login for non-existent user', async () => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'definitely-does-not-exist@nowhere.example',
        password: 'wrong-password-123',
      })
      expect(data.user).toBeNull()
      expect(error).not.toBeNull()
    } catch (e) {
      const msg = (e as Error).message?.toLowerCase() ?? ''
      if (msg.includes('fetch') || msg.includes('etimedout') || msg.includes('enotfound')) {
        console.warn('Skipping: network error.')
        return
      }
      throw e
    }
  }, 15_000)

  it(
    'signs up + signs in a fresh user',
    async () => {
      const email = uniqueEmail('signup')
      const password = 'TestPassword123!'

      try {
        let signUpResult
        try {
          signUpResult = await supabase.auth.signUp({ email, password })
        } catch (e) {
          const msg = (e as Error).message?.toLowerCase() ?? ''
          if (msg.includes('fetch') || msg.includes('etimedout') || msg.includes('enotfound')) {
            console.warn('Skipping: network error.')
            return
          }
          throw e
        }
        const { data, error } = signUpResult
        const errMsg = error?.message?.toLowerCase() ?? ''
        if (errMsg.includes('rate limit')) {
          console.warn('Skipping: signup email rate-limited.')
          return
        }
        if (errMsg.includes('fetch') || errMsg.includes('retry')) {
          console.warn('Skipping: network error during signup.')
          return
        }
        expect(error).toBeNull()
        expect(data.user).not.toBeNull()

        // Force-confirm the email via direct SQL so we can sign in.
        const c = new pg.Client({
          connectionString: process.env.SUPABASE_DB_URL!,
          ssl: { rejectUnauthorized: false },
        })
        await c.connect()
        await c.query(
          'update auth.users set email_confirmed_at = now() where email = $1',
          [email],
        )
        await c.end()

        const { data: signin, error: signinErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        expect(signinErr).toBeNull()
        expect(signin.user?.email?.toLowerCase()).toBe(email.toLowerCase())
        expect(signin.session?.access_token).toBeTruthy()
      } finally {
        await dropUser(email)
      }
    },
    30_000,
  )

  it('admin user exists with is_admin=true', async () => {
    let c: pg.Client | null = null
    try {
      c = new pg.Client({
        connectionString: process.env.SUPABASE_DB_URL!,
        ssl: { rejectUnauthorized: false },
      })
      await c.connect()
      const { rows } = await c.query<{ is_admin: boolean | null; email: string }>(
        `select email, (raw_user_meta_data->>'is_admin')::bool as is_admin
           from auth.users where email = 'admin@openclaw.dev'`,
      )
      expect(rows.length).toBe(1)
      expect(rows[0]?.is_admin).toBe(true)
    } catch (e) {
      const msg = (e as Error).message?.toLowerCase() ?? ''
      if (msg.includes('etimedout') || msg.includes('enotfound') || msg.includes('econnreset')) {
        console.warn('Skipping: network error connecting to Postgres.')
        return
      }
      throw e
    } finally {
      await c?.end().catch(() => {})
    }
  }, 15_000)
})
