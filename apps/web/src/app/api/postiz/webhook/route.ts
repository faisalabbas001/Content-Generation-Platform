import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { adminClient } from '@repo/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function appRedirect(path: string) {
  return NextResponse.redirect(
    new URL(path, process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
  )
}

async function upsertChannel(brandId: string, channelId: string, channelName: string | null) {
  const db = adminClient()
  return db.from('channel_profiles').upsert(
    {
      brand_id: brandId,
      channel: 'Instagram' as const,
      postiz_channel_id: channelId,
      handle: channelName,
    },
    { onConflict: 'brand_id,channel' }
  )
}

// POST — called when Postiz delivers a webhook after channel connection
export async function POST(req: NextRequest) {
  const secret = process.env.POSTIZ_WEBHOOK_SECRET ?? ''
  const signature = req.headers.get('x-postiz-signature') ?? ''
  const rawBody = await req.text()

  if (secret) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const expectedBuf = Buffer.from(`sha256=${expected}`)
    const receivedBuf = Buffer.from(signature)
    const match =
      expectedBuf.length === receivedBuf.length &&
      timingSafeEqual(expectedBuf, receivedBuf)
    if (!match) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const body = JSON.parse(rawBody) as {
    channelId?: string
    channelName?: string
    slug?: string
  }

  const { channelId, channelName = null, slug } = body
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  // Server-to-server call — no browser cookies here. The slug must come in
  // the payload; without it we cannot map the channel to a brand, so we
  // acknowledge and let the user-driven /api/postiz/detect step do the save.
  if (!slug) return NextResponse.json({ ok: true, note: 'no slug in payload — channel will be linked via /api/postiz/detect' })

  const db = adminClient()
  const { data: brand } = await db
    .from('brand_profiles')
    .select('brand_id')
    .eq('client_slug', slug)
    .single()

  if (!brand) return NextResponse.json({ error: 'brand not found' }, { status: 404 })

  const { error } = await upsertChannel(brand.brand_id as string, channelId, channelName)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

// GET — called when Postiz redirects back to our app (redirect-based flow)
export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId')
  const channelName = req.nextUrl.searchParams.get('channelName')

  if (!channelId) return appRedirect('/settings?postiz_error=missing_channel_id')

  // /api/postiz/connect stores the brand slug in this cookie before sending
  // the user off to the OAuth page.
  const cookieStore = await cookies()
  const slug = cookieStore.get('postiz_connect_slug')?.value
  cookieStore.delete('postiz_connect_slug')

  if (!slug) return appRedirect('/settings?postiz_error=missing_connect_cookie')

  const db = adminClient()
  const { data: brand } = await db
    .from('brand_profiles')
    .select('brand_id')
    .eq('client_slug', slug)
    .single()

  if (!brand) return appRedirect(`/${slug}/settings?postiz_error=brand_not_found`)

  const { error } = await upsertChannel(brand.brand_id as string, channelId, channelName)
  if (error) return appRedirect(`/${slug}/settings?postiz_error=db_error`)

  return appRedirect(`/${slug}/settings?postiz_connected=true`)
}
