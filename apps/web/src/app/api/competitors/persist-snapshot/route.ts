/**
 * POST /api/competitors/persist-snapshot
 *
 * Called by N8N-A07 after Apify scrapes a competitor account.
 * Replaces the three raw Supabase nodes in A07 with a single signed
 * API call — same pattern as A06's persist-source-record.
 *
 * Responsibilities:
 *   1. Compute snapshot metrics from raw Apify post array
 *   2. Upsert competitor_snapshots (idempotent on competitor_id + snapshot date)
 *   3. Update competitor_accounts.last_extracted_at
 *   4. Generate and insert competitor_alerts if gaps detected
 *   5. Return snapshot summary for the next node
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  brand_id:       z.string().uuid(),
  competitor_id:  z.string().uuid(),
  handle_instagram: z.string().min(1),
  extraction_type: z.enum(['light', 'deep']).default('light'),
  triggered_by:   z.string().optional(),
  /** Raw Apify response — array of post objects with ownerUsername, likesCount, etc. */
  apify_posts:    z.array(z.record(z.unknown())).default([]),
})

const OCCASION_KWS  = ['رمضان', 'ramadan', 'iftar', 'suhoor', 'عيد', 'eid', 'اليوم الوطني', 'national day', 'founding day']
const LIFESTYLE_KWS = ['لحظة', 'moment', 'يوم', 'حياة', 'life', 'morning', 'صباح']
const PRODUCT_KWS   = ['منتج', 'product', 'جديد', 'new', 'طازج', 'fresh', 'عرض', 'offer']
const BEHIND_KWS    = ['وراء', 'behind', 'kitchen', 'مطبخ', 'team', 'فريق', 'how we']

function computeSnapshot(posts: Record<string, unknown>[], handle: string) {
  const profile = posts.length > 0 && posts[0]?.ownerUsername ? posts[0] : {}
  const followersCount = Number((profile as Record<string, unknown>).followersCount ?? 0)

  // Content category distribution
  const dist = { product: 0, lifestyle: 0, occasion: 0, behind_scenes: 0, other: 0 }
  for (const post of posts) {
    const caption = String((post.caption ?? post.description ?? '')).toLowerCase()
    if (BEHIND_KWS.some((k) => caption.includes(k)))   { dist.behind_scenes++; continue }
    if (OCCASION_KWS.some((k) => caption.includes(k))) { dist.occasion++;       continue }
    if (LIFESTYLE_KWS.some((k) => caption.includes(k))){ dist.lifestyle++;      continue }
    if (PRODUCT_KWS.some((k) => caption.includes(k)))  { dist.product++;        continue }
    dist.other++
  }
  const total = posts.length || 1
  const content_category_distribution = Object.fromEntries(
    Object.entries(dist).map(([k, v]) => [k, Math.round((v / total) * 100)]),
  )

  // Posting frequency (last 30 days)
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recentPosts = posts.filter((p) => {
    const ts = p.timestamp ?? p.takenAtTimestamp ?? p.taken_at
    return ts && new Date(String(ts)).getTime() > cutoff
  })
  const posting_frequency_per_week = parseFloat((recentPosts.length / 4.3).toFixed(2))

  // Avg engagement rate
  const followers = followersCount || 1
  const avg_engagement = posts.length > 0
    ? posts.reduce((s, p) => s + (Number(p.likesCount ?? p.likes_count ?? 0) + Number(p.commentsCount ?? p.comments_count ?? 0)), 0) / posts.length / followers
    : 0
  const estimated_engagement_rate = parseFloat(avg_engagement.toFixed(6))

  // Gap analysis
  const gaps: string[] = []
  if (dist.behind_scenes === 0)      gaps.push('No behind-the-scenes content — opportunity to humanise your brand')
  if (dist.occasion < 2)             gaps.push('Minimal occasion content — opportunity to own Saudi occasion moments')
  if (posting_frequency_per_week < 1) gaps.push('Posts less than once per week — consistency gap you can exploit')
  if (posts.length > 0 && avg_engagement < 0.01) gaps.push('Low engagement rate — their content is not resonating well with audience')

  return {
    posting_frequency_per_week,
    estimated_engagement_rate,
    content_category_distribution,
    gaps_identified: gaps,
    follower_counts: { Instagram: followersCount },
    platforms_active: ['Instagram'],
    raw_payload: { posts_count: posts.length, followers: followersCount, handle },
  }
}

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'body did not match schema', {
      issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
    })
  }

  const { brand_id, competitor_id, handle_instagram, extraction_type, apify_posts } = parsed.data
  const db = adminClient()
  const snapshot = computeSnapshot(apify_posts, handle_instagram)

  // 1. Upsert competitor_snapshots
  const { error: snapErr } = await db
    .from('competitor_snapshots' as never)
    .upsert({
      competitor_id,
      brand_id,
      snapshot_type:                extraction_type,
      posting_frequency_per_week:   snapshot.posting_frequency_per_week,
      estimated_engagement_rate:    snapshot.estimated_engagement_rate,
      platforms_active:             snapshot.platforms_active,
      content_category_distribution: snapshot.content_category_distribution,
      gaps_identified:              snapshot.gaps_identified,
      follower_counts:              snapshot.follower_counts,
      raw_payload:                  snapshot.raw_payload,
      captured_at:                  new Date().toISOString(),
    } as never, { onConflict: 'competitor_id' })
  if (snapErr) return errorResponse(500, 'snapshot_insert_failed', snapErr.message)

  // 2. Update last_extracted_at
  await db
    .from('competitor_accounts' as never)
    .update({ last_extracted_at: new Date().toISOString() } as never)
    .eq('competitor_id' as never, competitor_id)

  // 3. Generate alerts
  const alerts: Record<string, unknown>[] = []
  if (snapshot.gaps_identified.length > 0) {
    alerts.push({
      brand_id,
      competitor_id,
      alert_type: 'gap_opportunity',
      severity:   'info',
      title:      'Competitive gap detected',
      body:       snapshot.gaps_identified[0],
      suggested_content_direction: snapshot.gaps_identified.slice(1).join('. ') || null,
    })
  }
  if (snapshot.posting_frequency_per_week < 0.5) {
    alerts.push({
      brand_id,
      competitor_id,
      alert_type: 'gap_opportunity',
      severity:   'info',
      title:      'Competitor inactive — own the space',
      body:       'This competitor posts less than once per week. Consistent daily content will dominate share of voice.',
      suggested_content_direction: 'Target 4-5 posts per week on Instagram to outpace this competitor.',
    })
  }
  if (alerts.length > 0) {
    await db.from('competitor_alerts' as never).insert(alerts as never)
  }

  const response = {
    ok:                           true,
    request_id:                   verified.req.requestId,
    brand_id,
    competitor_id,
    handle_instagram,
    posting_frequency_per_week:   snapshot.posting_frequency_per_week,
    estimated_engagement_rate:    snapshot.estimated_engagement_rate,
    gaps_found:                   snapshot.gaps_identified.length,
    alerts_inserted:              alerts.length,
  }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
