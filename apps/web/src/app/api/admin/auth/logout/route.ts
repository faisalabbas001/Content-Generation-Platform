import { NextResponse } from 'next/server'
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE } from '@/lib/admin-session'

export const runtime = 'nodejs'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.delete(ADMIN_ACCESS_COOKIE)
  response.cookies.delete(ADMIN_REFRESH_COOKIE)
  return response
}
