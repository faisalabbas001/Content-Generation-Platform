/**
 * OAuth + email-confirm callback.
 *
 * Supabase redirects here after Google sign-in or after a user clicks
 * the email-confirmation link. We swap the `code` for a session via
 * `exchangeCodeForSession` (which sets the session cookies), then send
 * the user to either their brand dashboard or the onboarding entry point.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/onboarding-start'

  if (!code) {
    const fail = new URL(url.toString())
    fail.pathname = '/login'
    fail.search = ''
    fail.searchParams.set('error', 'oauth_no_code')
    return NextResponse.redirect(fail)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })
  }

  // Build a response we can mutate cookies on.
  const target = new URL(url.toString())
  target.pathname = next.startsWith('/') ? next : `/${next}`
  target.search = ''
  let response = NextResponse.redirect(target)

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const c of toSet) response.cookies.set(c.name, c.value, c.options)
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    const fail = new URL(url.toString())
    fail.pathname = '/login'
    fail.search = ''
    fail.searchParams.set('error', 'oauth_exchange_failed')
    return NextResponse.redirect(fail)
  }

  return response
}
