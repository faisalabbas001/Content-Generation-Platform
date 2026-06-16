import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireBrandAccess } from '@repo/auth/server'
import { adminClient } from '@repo/db'
import {
  postizFetch,
  isInstagram,
  igHandle,
  resolveChannelForBrand,
  type PostizIntegration,
  type ChannelClaim,
} from '@/lib/postiz'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function appRedirect(path: string) {
  return NextResponse.redirect(
    new URL(path, process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
  )
}

// GET /api/postiz/detect?slug=<brand-slug>
//
// Manual fallback for the connect flow ("save connection" link) — same
// channel-resolution logic as /api/postiz/sync-channels (shared via
// resolveChannelForBrand, including same-user claim reclaim), but redirect-
// based for plain browser navigation instead of JSON for the poller.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  // Browser navigation with session cookies — redirects to /login if unauthed,
  // and to the user's own dashboard if they don't own this slug.
  const { brand, user } = await requireBrandAccess(slug)
  const brandId = brand.brand_id as string

  const apiKey = process.env.POSTIZ_API_KEY
  if (!apiKey) {
    console.error('[postiz/detect] POSTIZ_API_KEY not configured')
    return appRedirect(`/${slug}/settings?postiz_error=postiz_not_configured`)
  }

  // 1. Fetch all integrations from this Postiz workspace
  let integrations: PostizIntegration[]
  try {
    const intRes = await postizFetch('/integrations', apiKey)
    if (!intRes.ok) {
      const body = await intRes.text()
      console.error('[postiz/detect] integrations fetch failed:', intRes.status, body)
      return appRedirect(`/${slug}/settings?postiz_error=postiz_api_error`)
    }
    integrations = (await intRes.json()) as PostizIntegration[]
  } catch (err) {
    console.error('[postiz/detect] Postiz unreachable:', err)
    return appRedirect(`/${slug}/settings?postiz_error=postiz_unreachable`)
  }

  const igChannels = integrations.filter(isInstagram)
  if (igChannels.length === 0) {
    return appRedirect(`/${slug}/settings?postiz_error=no_instagram_found`)
  }

  // 2. Resolve this brand's channel (shared logic with sync-channels).
  const cookieStore = await cookies()
  let knownIds: string[] = []
  try {
    knownIds = JSON.parse(cookieStore.get('postiz_known_channels')?.value ?? '[]') as string[]
  } catch { /* malformed cookie — fall through */ }
  const connectType = cookieStore.get('postiz_connect_type')?.value ?? null

  const db = adminClient()
  const { data: claimedRows } = await db
    .from('channel_profiles')
    .select('postiz_channel_id, brand_id')
    .eq('channel', 'Instagram')
    .not('postiz_channel_id', 'is', null)

  const claimingBrandIds = [...new Set((claimedRows ?? []).map((r) => r.brand_id as string))]
  let owners: Array<{ brand_id: string; auth_user_id: string | null }> = []
  if (claimingBrandIds.length > 0) {
    const { data } = await db
      .from('brand_profiles')
      .select('brand_id, auth_user_id')
      .in('brand_id', claimingBrandIds)
    owners = (data ?? []) as typeof owners
  }
  const ownerFor = new Map(owners.map((o) => [o.brand_id, o.auth_user_id]))
  const claims: ChannelClaim[] = (claimedRows ?? []).map((r) => ({
    postiz_channel_id: r.postiz_channel_id as string,
    brand_id: r.brand_id as string,
    auth_user_id: ownerFor.get(r.brand_id as string) ?? null,
  }))

  const resolution = resolveChannelForBrand({
    igChannels,
    knownIds,
    connectType,
    claims,
    brandId,
    userId: user.id,
  })

  if (!resolution) {
    return appRedirect(`/${slug}/settings?postiz_error=no_unclaimed_instagram`)
  }
  if ('conflict' in resolution) {
    return appRedirect(`/${slug}/settings?postiz_error=ambiguous_channel`)
  }

  const ig = resolution.channel

  // 3. Move the claim if a same-user brand held this channel.
  if (resolution.reclaimFromBrandIds.length > 0) {
    const { error: releaseErr } = await db
      .from('channel_profiles')
      .update({ postiz_channel_id: null })
      .in('brand_id', resolution.reclaimFromBrandIds)
      .eq('channel', 'Instagram')
    if (releaseErr) {
      console.error('[postiz/detect] claim release failed:', releaseErr)
      return appRedirect(`/${slug}/settings?postiz_error=db_error`)
    }
  }

  // 4. Upsert into channel_profiles
  const handle = igHandle(ig)
  const { error: upsertErr } = await db.from('channel_profiles').upsert(
    {
      brand_id: brandId,
      channel: 'Instagram' as const,
      postiz_channel_id: ig.id,
      handle,
    },
    { onConflict: 'brand_id,channel' }
  )

  if (upsertErr) {
    console.error('[postiz/detect] upsert failed:', upsertErr)
    return appRedirect(`/${slug}/settings?postiz_error=db_error`)
  }

  cookieStore.delete('postiz_known_channels')
  cookieStore.delete('postiz_connect_type')

  return appRedirect(`/${slug}/settings?postiz_connected=true`)
}
