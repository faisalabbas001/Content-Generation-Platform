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

// GET /api/postiz/sync-channels?slug=<brand-slug>
//
// JSON endpoint polled by the settings page after the user starts the
// Postiz OAuth flow in another tab. Returns:
//   { ok: true,  channel: {...} }       — channel found and saved for brand
//   { ok: false, pending: true }        — nothing new yet, keep polling
//   { error: ... }                      — terminal failure
//
// Multi-brand safety: /api/postiz/connect snapshots the workspace's channel
// IDs into the postiz_known_channels cookie before redirecting to OAuth.
// We prefer an Instagram channel NOT in that snapshot (the one THIS brand
// just connected). Channels already claimed by another brand are excluded.
// The snapshot cookie is only cleared once a channel is successfully saved,
// so repeated polls keep working.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) {
    return NextResponse.json({ error: 'slug query param required' }, { status: 400 })
  }

  // Verify the caller owns this brand (throws → 401 if not authenticated).
  let brandId: string
  let userId: string
  try {
    const { brand, user } = await requireBrandAccess(slug)
    brandId = brand.brand_id as string
    userId = user.id
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.POSTIZ_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'POSTIZ_API_KEY not configured' }, { status: 500 })
  }

  // ── 1. Fetch all integrations from Postiz ────────────────────────────────
  let integrations: PostizIntegration[]
  try {
    const res = await postizFetch('/integrations', apiKey)
    if (!res.ok) {
      const body = await res.text()
      console.error('[sync-channels] Postiz error', res.status, body)
      return NextResponse.json(
        { error: 'postiz_api_error', status: res.status, detail: body },
        { status: 502 }
      )
    }
    integrations = (await res.json()) as PostizIntegration[]
  } catch (err) {
    console.error('[sync-channels] fetch failed', err)
    return NextResponse.json({ error: 'postiz_unreachable' }, { status: 502 })
  }

  const igChannels = integrations.filter(isInstagram)
  if (igChannels.length === 0) {
    // Not an error during polling — the user may still be mid-OAuth.
    return NextResponse.json({ ok: false, pending: true })
  }

  // ── 2. Pick this brand's channel ─────────────────────────────────────────
  const cookieStore = await cookies()
  let knownIds: string[] = []
  try {
    knownIds = JSON.parse(cookieStore.get('postiz_known_channels')?.value ?? '[]') as string[]
  } catch { /* malformed cookie — fall through to unclaimed match */ }
  const connectType = cookieStore.get('postiz_connect_type')?.value ?? null

  const db = adminClient()
  const { data: claimedRows } = await db
    .from('channel_profiles')
    .select('postiz_channel_id, brand_id')
    .eq('channel', 'Instagram')
    .not('postiz_channel_id', 'is', null)

  // Resolve which USER owns each claiming brand — same-user claims are
  // reclaimable (the user re-authorized an account they connected to one of
  // their other/older brands); other users' claims are untouchable.
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

  // ── Explicit takeover ─────────────────────────────────────────────────────
  // ?takeover=<channelId>: the user saw the "this Instagram is connected to
  // another brand" prompt and explicitly chose to move it here. Completing the
  // Instagram OAuth is the ownership proof; the move is loud and visible.
  const takeoverId = req.nextUrl.searchParams.get('takeover')
  if (takeoverId) {
    const target = igChannels.find((i) => i.id === takeoverId)
    if (!target) {
      return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })
    }
    console.warn(
      `[sync-channels] TAKEOVER: channel ${takeoverId} (${igHandle(target)}) moved to brand ${brandId} (user ${userId})`,
    )
    const { error: releaseErr } = await db
      .from('channel_profiles')
      .update({ postiz_channel_id: null })
      .eq('postiz_channel_id', takeoverId)
      .eq('channel', 'Instagram')
    if (releaseErr) {
      return NextResponse.json({ error: 'db_error', detail: releaseErr.message }, { status: 500 })
    }
    const { error: claimErr } = await db.from('channel_profiles').upsert(
      {
        brand_id: brandId,
        channel: 'Instagram' as const,
        postiz_channel_id: takeoverId,
        handle: igHandle(target),
      },
      { onConflict: 'brand_id,channel' }
    )
    if (claimErr) {
      return NextResponse.json({ error: 'db_error', detail: claimErr.message }, { status: 500 })
    }
    cookieStore.delete('postiz_known_channels')
    cookieStore.delete('postiz_connect_type')
    return NextResponse.json({
      ok: true,
      channel: { postiz_channel_id: takeoverId, handle: igHandle(target), picture: target.picture },
    })
  }

  const resolution = resolveChannelForBrand({
    igChannels,
    knownIds,
    connectType,
    claims,
    brandId,
    userId,
  })

  if (!resolution || 'conflict' in resolution) {
    // No channel is automatically claimable. If the account the user just
    // authorized maps to a channel held by ANOTHER user's brand, offer an
    // explicit takeover (completing Instagram OAuth proves account ownership;
    // Postiz dedupes channels per IG account, so no new channel appeared).
    const otherUserClaims = new Set(
      claims
        .filter((c) => c.brand_id !== brandId && c.auth_user_id !== userId)
        .map((c) => c.postiz_channel_id),
    )
    let candidates = igChannels.filter((i) => otherUserClaims.has(i.id))
    if (connectType) {
      const typed = candidates.filter((i) => i.identifier === connectType)
      if (typed.length > 0) candidates = typed
    }
    if (candidates.length === 1) {
      return NextResponse.json({
        ok: false,
        takeover: { channel_id: candidates[0].id, handle: igHandle(candidates[0]) },
      })
    }
    if (resolution && 'conflict' in resolution) {
      return NextResponse.json({ ok: false, conflict: true })
    }
    // Nothing eligible yet — keep polling in case the channel is still being
    // added on Postiz's side.
    return NextResponse.json({ ok: false, pending: true })
  }

  const ig = resolution.channel

  // ── 3. Move the claim if a same-user brand held this channel ─────────────
  if (resolution.reclaimFromBrandIds.length > 0) {
    const { error: releaseErr } = await db
      .from('channel_profiles')
      .update({ postiz_channel_id: null })
      .in('brand_id', resolution.reclaimFromBrandIds)
      .eq('channel', 'Instagram')
    if (releaseErr) {
      console.error('[sync-channels] claim release failed', releaseErr)
      return NextResponse.json({ error: 'db_error', detail: releaseErr.message }, { status: 500 })
    }
  }

  // ── 4. Upsert into channel_profiles ──────────────────────────────────────
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
    console.error('[sync-channels] upsert failed', upsertErr)
    return NextResponse.json(
      { error: 'db_error', detail: upsertErr.message },
      { status: 500 }
    )
  }

  // Snapshot served its purpose — clear it now that the claim succeeded.
  cookieStore.delete('postiz_known_channels')
  cookieStore.delete('postiz_connect_type')

  return NextResponse.json({
    ok: true,
    channel: {
      postiz_channel_id: ig.id,
      handle,
      picture: ig.picture,
    },
  })
}
