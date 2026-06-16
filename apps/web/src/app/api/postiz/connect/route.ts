import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { postizFetch } from '@/lib/postiz'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function settingsRedirect(slug: string, error?: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const path = error ? `/${slug}/settings?postiz_error=${error}` : `/${slug}/settings`
  return NextResponse.redirect(new URL(path, base))
}

// GET /api/postiz/connect?slug=<brand-slug>&type=<instagram|instagram-standalone>
//
// Step 1 of the Postiz Instagram connection flow:
//   1. Asks Postiz for an OAuth URL via GET /social/{type}
//   2. Snapshots existing workspace channel IDs + brand slug into cookies
//   3. Redirects the user to the returned OAuth URL
//
// After the user grants permissions, Postiz saves the integration in the
// workspace. The settings page polls /api/postiz/sync-channels in the
// background and flips to "Connected" automatically — no manual verify step.
//
// This route is opened by browser navigation — every failure must redirect
// back to the settings page with a readable postiz_error code, never return
// raw JSON to the user's tab.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const apiKey = process.env.POSTIZ_API_KEY
  if (!apiKey) {
    console.error('[postiz/connect] POSTIZ_API_KEY not configured')
    return settingsRedirect(slug, 'postiz_not_configured')
  }

  // instagram-standalone = direct Instagram login (Professional accounts, no
  // Facebook Page required). instagram = Facebook-page-linked flow.
  const type = (req.nextUrl.searchParams.get('type') ?? 'instagram') as
    | 'instagram'
    | 'instagram-standalone'

  let postizRes: Response
  try {
    postizRes = await postizFetch(`/social/${type}`, apiKey)
  } catch (err) {
    console.error('[postiz/connect] Postiz unreachable:', err)
    return settingsRedirect(slug, 'postiz_unreachable')
  }

  if (!postizRes.ok) {
    const body = await postizRes.text()
    console.error('[postiz/connect] Postiz API error:', postizRes.status, body)
    let reason = 'postiz_api_error'
    if (postizRes.status === 401) {
      // Postiz Cloud returns 401 {"msg":"No subscription found"} when the
      // workspace has no plan with Public API access — distinct from a bad key.
      reason = body.includes('subscription')
        ? 'postiz_no_subscription'
        : 'postiz_invalid_api_key'
    }
    return settingsRedirect(slug, reason)
  }

  const data = (await postizRes.json()) as { url?: string }
  if (!data.url) {
    console.error('[postiz/connect] Postiz did not return an OAuth URL:', JSON.stringify(data))
    return settingsRedirect(slug, 'postiz_no_oauth_url')
  }

  // Snapshot the channel IDs that exist BEFORE this brand's OAuth, so the
  // sync/detect step can identify the NEWLY added channel by diffing. Without
  // this, a multi-brand workspace would map every brand to the first
  // Instagram channel found.
  let existingIds: string[] = []
  try {
    const intRes = await postizFetch('/integrations', apiKey)
    if (intRes.ok) {
      const list = (await intRes.json()) as Array<{ id: string }>
      existingIds = list.map((i) => i.id)
    }
  } catch {
    // Non-fatal — sync/detect falls back to first-unclaimed if missing.
  }

  // Store slug + snapshot so the sync/detect step knows which brand to
  // associate and which channels are pre-existing.
  const cookieStore = await cookies()
  cookieStore.set('postiz_connect_slug', slug, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  })
  cookieStore.set('postiz_known_channels', JSON.stringify(existingIds), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  })
  // Which OAuth flavour the user clicked — lets sync/detect disambiguate
  // when the authorized account maps to an existing (same-user) channel.
  cookieStore.set('postiz_connect_type', type, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  })

  return NextResponse.redirect(data.url)
}
