import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  ADMIN_ACCESS_COOKIE,
  ADMIN_REFRESH_COOKIE,
  getAdminCookieOptions,
} from '@/lib/admin-session'
import { isAdminPrincipal } from '@/lib/admin-access'

export const runtime = 'nodejs'

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 })
}

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ message: 'Supabase public credentials are missing.' }, { status: 500 })
  }

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    return badRequest('Invalid JSON payload.')
  }

  const email = typeof body === 'object' && body && 'email' in body ? String((body as { email: unknown }).email).trim() : ''
  const password = typeof body === 'object' && body && 'password' in body ? String((body as { password: unknown }).password) : ''

  if (!email || !password) {
    return badRequest('Email and password are required.')
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session || !data.user) {
    return NextResponse.json({ message: 'Invalid admin credentials.' }, { status: 401 })
  }

  if (!isAdminPrincipal(data.user)) {
    return NextResponse.json({ message: 'Your account is not allowed to access admin.' }, { status: 403 })
  }

  const response = NextResponse.json({ ok: true })
  const options = getAdminCookieOptions()
  response.cookies.set(ADMIN_ACCESS_COOKIE, data.session.access_token, options)
  response.cookies.set(ADMIN_REFRESH_COOKIE, data.session.refresh_token, options)
  return response
}
