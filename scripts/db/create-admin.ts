/**
 * OGz Studios — create or update an admin auth user.
 *
 * Usage:
 *   pnpm db:create-admin -- admin@example.com "StrongPassword123!"
 */

import { loadEnv, requireEnv } from './lib/env.js'

interface AdminUser {
  id: string
  email: string
  user_metadata?: Record<string, unknown>
}

interface AdminListResponse {
  users: AdminUser[]
}

function args() {
  const [, , maybeFlag, maybeEmail, maybePassword] = process.argv
  if (maybeFlag === '--') {
    return { email: maybeEmail, password: maybePassword }
  }
  return { email: maybeFlag, password: maybeEmail }
}

function adminHeaders(serviceRole: string) {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    'Content-Type': 'application/json',
  }
}

async function listUsers(baseUrl: string, serviceRole: string): Promise<AdminUser[]> {
  let page = 1
  const users: AdminUser[] = []

  while (true) {
    const url = `${baseUrl}/auth/v1/admin/users?page=${page}&per_page=200`
    const res = await fetch(url, { headers: adminHeaders(serviceRole) })
    if (!res.ok) {
      throw new Error(`Failed to list users (page ${page}): ${res.status} ${await res.text()}`)
    }

    const data = (await res.json()) as AdminListResponse
    if (!Array.isArray(data.users) || data.users.length === 0) break

    users.push(...data.users)
    if (data.users.length < 200) break
    page += 1
  }

  return users
}

async function createUser(baseUrl: string, serviceRole: string, email: string, password: string) {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(serviceRole),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { is_admin: true },
    }),
  })

  if (!res.ok) {
    return { ok: false as const, status: res.status, body: await res.text() }
  }

  const data = (await res.json()) as AdminUser
  return { ok: true as const, user: data }
}

async function updateUser(baseUrl: string, serviceRole: string, userId: string, password: string) {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: adminHeaders(serviceRole),
    body: JSON.stringify({
      password,
      email_confirm: true,
      user_metadata: { is_admin: true },
    }),
  })

  if (!res.ok) {
    throw new Error(`Failed to update admin user: ${res.status} ${await res.text()}`)
  }
}

async function signupWithAnon(baseUrl: string, anonKey: string, email: string, password: string) {
  const res = await fetch(`${baseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  if (res.ok) {
    return { ok: true as const, body: await res.text() }
  }

  const body = await res.text()
  if (res.status === 422 && body.toLowerCase().includes('already')) {
    return { ok: true as const, body }
  }

  return { ok: false as const, status: res.status, body }
}

async function main() {
  loadEnv()
  const { email, password } = args()

  if (!email || !password) {
    console.error('Usage: pnpm db:create-admin -- admin@example.com "StrongPassword123!"')
    process.exit(1)
  }

  const baseUrl = requireEnv('SUPABASE_URL')
  const serviceRole = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

  console.log(`→ Ensuring admin auth user exists: ${email}`)
  const created = await createUser(baseUrl, serviceRole, email, password)
  if (created.ok) {
    console.log(`✓ created admin user ${created.user.email} (${created.user.id})`)
    return
  }

  const bodyLower = created.body.toLowerCase()
  const canUseFallback =
    created.status === 401 ||
    (created.status === 403 && (bodyLower.includes('not_admin') || bodyLower.includes('user not allowed')))

  if (canUseFallback) {
    if (!anonKey) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is invalid and no anon key is available for fallback signup.',
      )
    }

    console.warn('! service-role key lacks admin privileges; falling back to anon signup mode')
    const fallback = await signupWithAnon(baseUrl, anonKey, email, password)
    if (!fallback.ok) {
      throw new Error(`Fallback signup failed: ${fallback.status} ${fallback.body}`)
    }
    console.log('✓ created/confirmed auth user via anon signup fallback')

    // Force-confirm the email + set is_admin via direct SQL (dev only — needs db url).
    try {
      const { Client } = await import('pg')
      const { getPgConnectionString } = await import('./lib/env.js')
      const pgClient = new Client({
        connectionString: getPgConnectionString(),
        ssl: { rejectUnauthorized: false },
      })
      await pgClient.connect()
      await pgClient.query(
        `update auth.users
            set email_confirmed_at = coalesce(email_confirmed_at, now()),
                raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"is_admin":true}'::jsonb
          where email = $1`,
        [email],
      )
      await pgClient.end()
      console.log('✓ email_confirmed_at + is_admin=true set via direct DB update (dev fallback)')
    } catch (sqlErr) {
      console.warn(
        '! could not auto-confirm email via DB. Add the email to ADMIN_ALLOWLIST_EMAILS and confirm manually in Supabase dashboard.',
      )
      console.warn('  reason:', (sqlErr as Error).message)
    }

    console.log(
      'ℹ Admin access also honors ADMIN_ALLOWLIST_EMAILS (in addition to user_metadata.is_admin).',
    )
    return
  }

  if (created.status !== 422 && !bodyLower.includes('already')) {
    throw new Error(`Failed to create admin user: ${created.status} ${created.body}`)
  }

  const users = await listUsers(baseUrl, serviceRole)
  const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!existing) {
    throw new Error('User already exists but could not be found in admin list API.')
  }

  await updateUser(baseUrl, serviceRole, existing.id, password)
  console.log(`✓ updated existing admin user ${email} (${existing.id}) and enforced is_admin=true`)
}

main().catch((error) => {
  console.error('✗ db:create-admin failed')
  console.error(error)
  process.exit(1)
})
