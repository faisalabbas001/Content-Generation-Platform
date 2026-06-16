/**
 * POST /api/extraction/persist-ig
 *
 * Receives the rich Instagram extraction payload from N8N-A06's IG normaliser
 * node and persists it across multiple Layer-1 tables in a single
 * transactional-ish operation. Called once per onboarding, AFTER the IG
 * source_records row has been inserted.
 *
 * Why a dedicated endpoint instead of n8n Supabase nodes:
 *   - n8n's Supabase node can't bulk-insert 50 rows efficiently
 *   - We need to call the `refresh_brand_engagement_baseline(uuid)` RPC
 *     after the inserts — easier from Node than from n8n
 *   - Keeps the n8n flow simple (one HTTP call vs many Loop+Insert nodes)
 *   - Server-side joins the migration 0026 schema with the v2 onboarding
 *     audit chain
 *
 * Persists:
 *   1. brand_post_observations  — bulk INSERT of all 50 posts
 *   2. brand_profiles updates   — signature_phrases, signature_hashtags,
 *                                  brand_reply_samples + posts_observed_count
 *   3. channel_profiles UPSERT  — IG channel row with handle/followers/etc.
 *   4. RPC compute baselines    — median likes/comments/views written back to
 *                                  brand_profiles
 *
 * Body shape:
 *   {
 *     brand_id: uuid,
 *     source_record_id?: uuid (the IG source_records row id, for FK linkage),
 *     ig_post_observations: ObservationRow[],
 *     brand_reply_samples: string[],
 *     signature_hashtags: string[],
 *     signature_phrases: string[],
 *     channel_profile: ChannelProfileRow
 *   }
 *
 * HMAC-verified per Doc §SEC-10. n8n signs the body; we re-compute and reject
 * mismatches. Idempotent on `x-n8n-idempotency-key`.
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'
import { extractPalette } from '@repo/image'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Per-post inserts can be 50 rows × ~1KB = 50KB — still well under any
// platform limit. Allow up to 60 seconds for the RPC + bulk insert.
export const maxDuration = 60

const ObservationSchema = z.object({
  ig_post_id:             z.string().min(1).nullable(),
  short_code:             z.string().nullable().optional(),
  post_url:               z.string().nullable().optional(),
  post_type:              z.string().min(1),
  product_type:           z.string().nullable().optional(),
  caption:                z.string().nullable().optional(),
  caption_length:         z.number().int().nonnegative().nullable().optional(),
  hashtags:               z.array(z.string()).default([]),
  mentions:               z.array(z.string()).default([]),
  emoji_count:            z.number().int().nonnegative().default(0),
  language_detected:      z.string().nullable().optional(),
  likes_count:            z.number().int().transform((v) => Math.max(0, v)).default(0),
  comments_count:         z.number().int().transform((v) => Math.max(0, v)).default(0),
  video_view_count:       z.number().int().transform((v) => Math.max(0, v)).nullable().optional(),
  video_play_count:       z.number().int().transform((v) => Math.max(0, v)).nullable().optional(),
  comments_disabled:      z.boolean().default(false),
  dimensions_width:       z.number().int().positive().nullable().optional(),
  dimensions_height:      z.number().int().positive().nullable().optional(),
  video_duration_seconds: z.number().nonnegative().nullable().optional(),
  uses_original_audio:    z.boolean().nullable().optional(),
  audio_id:               z.string().nullable().optional(),
  posted_at:              z.string().nullable().optional(),
})

const ChannelProfileSchema = z.object({
  brand_id:           z.string().uuid(),
  channel:            z.string().min(1),
  handle:             z.string().nullable(),
  profile_url:        z.string().nullable().optional(),
  followers_count:    z.number().int().nonnegative().nullable().optional(),
  posts_count_total:  z.number().int().nonnegative().nullable().optional(),
  is_business:        z.boolean().default(false),
  is_verified:        z.boolean().default(false),
  synced_at:          z.string().nullable().optional(),
  // Migration 0028 — richer IG profile fields. All optional so older n8n
  // payloads still pass validation; persist-ig writes whatever it gets.
  full_name:          z.string().nullable().optional(),
  biography:          z.string().nullable().optional(),
  profile_pic_url:    z.string().nullable().optional(),
  external_url:       z.string().nullable().optional(),
  business_category:  z.string().nullable().optional(),
  follows_count:      z.number().int().nonnegative().nullable().optional(),
  is_private:         z.boolean().optional(),
  joined_recently:    z.boolean().optional(),
  has_channel:        z.boolean().optional(),
  raw_profile:        z.unknown().optional(),
  normalised_profile: z.unknown().optional(),
  posts_sample:       z.unknown().optional(),
})

const BodySchema = z.object({
  brand_id:              z.string().uuid(),
  source_record_id:      z.string().uuid().nullable().optional(),
  ig_post_observations:  z.array(ObservationSchema).max(100),
  brand_reply_samples:   z.array(z.string()).max(50).default([]),
  signature_hashtags:    z.array(z.string()).max(20).default([]),
  signature_phrases:     z.array(z.string()).max(20).default([]),
  channel_profile:       ChannelProfileSchema,
  /** Image URLs the palette extractor should sample. The IG normaliser
   *  picks profile_pic_url + the displayUrl of the top-3 most-engaged posts. */
  palette_image_urls:    z.array(z.string().url()).max(8).default([]),
  /** Mentions extracted across all observed posts — collaboration network signal. */
  mentions: z.array(z.object({
    mentioned_username: z.string().min(1).max(64),
    mention_count:      z.number().int().positive(),
    contexts:           z.array(z.string()).max(5).default([]),
  })).max(100).default([]),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`)
    console.error('[persist-ig] validation failed:', JSON.stringify(issues))
    return errorResponse(400, 'invalid_input', 'body did not match schema', { issues })
  }

  const {
    brand_id, ig_post_observations,
    brand_reply_samples, signature_hashtags, signature_phrases, channel_profile,
    palette_image_urls, mentions,
  } = parsed.data
  let { source_record_id } = parsed.data

  const db = adminClient()

  // ── Recover source_record_id when n8n omits it ──
  // The legacy A06 flow's `Sign · persist-ig` node hardcodes source_record_id=null
  // because it doesn't pipe the response from the prior `POST · source_record (IG)`
  // node. Look up the latest `instagram` source_records row for this brand and
  // use it as the FK. Auto-recovery avoids forcing a flow re-import.
  if (!source_record_id) {
    const { data: srcRow } = await db
      .from('source_records')
      .select('source_id')
      .eq('brand_id', brand_id)
      .eq('source_type', 'instagram')
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (srcRow) {
      source_record_id = (srcRow as { source_id: string }).source_id
    }
  }

  // ── 1. Bulk INSERT brand_post_observations (idempotent via unique constraint) ──
  //    Conflict on (brand_id, ig_post_id) → DO NOTHING so re-runs are safe.
  const validObservations = ig_post_observations.filter((p) => !!p.ig_post_id)
  if (validObservations.length > 0) {
    const rows = validObservations.map((p) => ({
      brand_id,
      source_record_id: source_record_id ?? null,
      ig_post_id:             p.ig_post_id,
      short_code:             p.short_code ?? null,
      post_url:               p.post_url ?? null,
      post_type:              p.post_type,
      product_type:           p.product_type ?? null,
      caption:                p.caption ?? null,
      caption_length:         p.caption_length ?? (p.caption?.length ?? 0),
      hashtags:               p.hashtags,
      mentions:               p.mentions,
      emoji_count:            p.emoji_count,
      language_detected:      p.language_detected ?? null,
      likes_count:            p.likes_count,
      comments_count:         p.comments_count,
      video_view_count:       p.video_view_count ?? null,
      video_play_count:       p.video_play_count ?? null,
      comments_disabled:      p.comments_disabled,
      dimensions_width:       p.dimensions_width ?? null,
      dimensions_height:      p.dimensions_height ?? null,
      video_duration_seconds: p.video_duration_seconds ?? null,
      uses_original_audio:    p.uses_original_audio ?? null,
      audio_id:               p.audio_id ?? null,
      posted_at:              p.posted_at ?? null,
    }))
    const { error: insertErr } = await db
      .from('brand_post_observations')
      // upsert with ignoreDuplicates so Apify reruns don't error
      .upsert(rows as never, { onConflict: 'brand_id,ig_post_id', ignoreDuplicates: true })
    if (insertErr) {
      console.error('[persist-ig] bulk observation insert failed:', insertErr.message)
      return errorResponse(500, 'observations_insert_failed', insertErr.message)
    }
  }

  // ── 2. Update brand_profiles signatures + reply samples ──
  const { error: profileErr } = await db
    .from('brand_profiles')
    .update({
      signature_phrases:    signature_phrases,
      signature_hashtags:   signature_hashtags,
      brand_reply_samples:  brand_reply_samples,
    } as never)
    .eq('brand_id', brand_id)
  if (profileErr) {
    console.error('[persist-ig] brand_profiles update failed:', profileErr.message)
    // Non-fatal — continue
  }

  // ── 3. Upsert channel_profiles (Instagram row) ──
  // ux_channel_profiles_brand_channel guarantees one row per (brand_id, channel).
  const { error: channelErr } = await db
    .from('channel_profiles')
    .upsert({
      brand_id,
      channel:            channel_profile.channel,
      handle:             channel_profile.handle,
      profile_url:        channel_profile.profile_url ?? null,
      followers_count:    channel_profile.followers_count ?? null,
      posts_count_total:  channel_profile.posts_count_total ?? null,
      is_business:        channel_profile.is_business,
      // Cross-check raw_profile for verification status — normaliser may have lost it
      is_verified:        channel_profile.is_verified ||
        !!(channel_profile.raw_profile as Record<string,unknown> | null)?.verified ||
        !!(channel_profile.normalised_profile as Record<string,unknown> | null)?.is_verified,
      // synced_at: always overwrite with the current timestamp at the moment
      // persist-ig runs. Inbound payload may have a stale value or `null`
      // (n8n stringification corner case); we ALWAYS want the column to
      // reflect when the latest sync actually happened.
      synced_at:          new Date().toISOString(),
      // Migration 0028 — rich profile capture
      full_name:          channel_profile.full_name ?? null,
      biography:          channel_profile.biography ?? null,
      profile_pic_url:    channel_profile.profile_pic_url ?? null,
      external_url:       channel_profile.external_url ?? null,
      business_category:  channel_profile.business_category ?? null,
      follows_count:      channel_profile.follows_count ?? null,
      is_private:         channel_profile.is_private ?? false,
      joined_recently:    channel_profile.joined_recently ?? false,
      has_channel:        channel_profile.has_channel ?? false,
      raw_profile:        (channel_profile.raw_profile ?? null) as never,
      normalised_profile: (channel_profile.normalised_profile ?? null) as never,
      posts_sample:       (channel_profile.posts_sample ?? null) as never,
    } as never, { onConflict: 'brand_id,channel' })
  if (channelErr) {
    console.error('[persist-ig] channel_profiles upsert failed:', channelErr.message)
    // Non-fatal — continue
  }

  // ── 3b. Promote channel-level analytics → brand_profiles top-level columns ──
  // followers_count and ig_post_count live authoritatively in channel_profiles.
  // Promote them to brand_profiles so COO / CEO / UI can read without a join.
  if (!channelErr && channel_profile.followers_count != null) {
    await db.from('brand_profiles').update({
      followers_count: channel_profile.followers_count,
      ig_post_count:   channel_profile.posts_count_total ?? null,
    } as never).eq('brand_id', brand_id)
  }

  // ── 4. Recompute engagement baselines via RPC ──
  // Reads brand_post_observations medians, writes back to brand_profiles.
  const { error: rpcErr } = await db.rpc('refresh_brand_engagement_baseline', {
    p_brand_id: brand_id,
  } as never)
  if (rpcErr) {
    console.warn('[persist-ig] refresh_brand_engagement_baseline failed:', rpcErr.message)
    // Non-fatal — baselines are optional
  }

  // ── 5. Color palette extraction → visual_style_profiles ──
  // IG CDN URLs expire and block cross-origin server fetches, so route them
  // through our own /api/img-proxy which handles the IG CDN headers.
  // Fallback: use brand_assets_bundle (Supabase Storage) if no palette URLs.
  let extractedPalette: string[] = []
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'http://localhost:3000'
  ).replace(/\/+$/, '')

  // Build proxied URLs so Sharp can fetch them without CDN auth errors
  const proxiedUrls = palette_image_urls
    .filter((u) => u && /^https?:\/\//i.test(u))
    .map((u) => `${appUrl}/api/img-proxy?u=${encodeURIComponent(u)}`)

  // Also try Supabase Storage URLs from brand_assets_bundle (always accessible)
  const { data: bpAssets } = await db
    .from('brand_profiles')
    .select('brand_assets_bundle, primary_color_hex')
    .eq('brand_id', brand_id)
    .maybeSingle()
  const assetBundle = (bpAssets as { brand_assets_bundle?: unknown; primary_color_hex?: string } | null)
  const storagePics: string[] = []
  if (Array.isArray(assetBundle?.brand_assets_bundle)) {
    for (const asset of assetBundle!.brand_assets_bundle as Array<{ url?: string }>) {
      if (typeof asset?.url === 'string' && asset.url.includes('supabase')) storagePics.push(asset.url)
    }
  }

  const urlsToTry = [...proxiedUrls.slice(0, 4), ...storagePics.slice(0, 2)]

  if (urlsToTry.length > 0) {
    try {
      extractedPalette = await extractPalette(urlsToTry, {
        maxColors: 6,
        fetchTimeoutMs: 8000,
      })
      console.info(`[persist-ig] palette extracted ${extractedPalette.length} colors for brand=${brand_id}`)
    } catch (e) {
      console.warn('[persist-ig] palette extraction failed:', e instanceof Error ? e.message : String(e))
    }
  }

  // If palette still empty but brand has a primary_color_hex, seed from that
  if (extractedPalette.length === 0 && assetBundle?.primary_color_hex) {
    extractedPalette = [assetBundle.primary_color_hex]
    console.info(`[persist-ig] seeded palette from primary_color_hex: ${assetBundle.primary_color_hex}`)
  }
  if (extractedPalette.length > 0) {
    // Read existing visual_style_profiles so we don't clobber the user's
    // primary_color_hex seed (added at submitFinal). Strategy: keep their
    // primary as colors[0]; append the extracted palette to fill colors[1..N].
    const { data: existingVsp } = await db
      .from('visual_style_profiles')
      .select('color_palette')
      .eq('brand_id', brand_id)
      .maybeSingle()
    const existing = (existingVsp as { color_palette?: string[] } | null)?.color_palette ?? []
    const merged = Array.from(new Set([...existing, ...extractedPalette])).slice(0, 8)
    const { error: vspErr } = await db
      .from('visual_style_profiles')
      .upsert({
        brand_id,
        color_palette: merged,
      } as never, { onConflict: 'brand_id' })
    if (vspErr) {
      console.warn('[persist-ig] visual_style_profiles palette upsert failed:', vspErr.message)
    }
  }

  // ── 6. Brand mentions network ──
  // Bulk upsert collaboration network — who this brand @-mentions across posts.
  // ON CONFLICT: increment mention_count, append new contexts, update last_seen_at.
  if (mentions.length > 0) {
    const now = new Date().toISOString()
    const rows = mentions.map((m) => ({
      brand_id,
      mentioned_username: m.mentioned_username,
      mention_count:      m.mention_count,
      contexts:           m.contexts,
      first_seen_at:      now,
      last_seen_at:       now,
    }))
    // Best effort — table created in migration 0027. UPSERT increments on conflict.
    const { error: mentionsErr } = await db
      .from('brand_mentions')
      .upsert(rows as never, { onConflict: 'brand_id,mentioned_username' })
    if (mentionsErr) {
      console.warn('[persist-ig] brand_mentions upsert failed:', mentionsErr.message)
    }
  }

  const response = {
    ok: true,
    request_id: verified.req.requestId,
    brand_id,
    observations_inserted: validObservations.length,
    palette_colors_extracted: extractedPalette.length,
    mentions_recorded: mentions.length,
    signatures: {
      hashtags: signature_hashtags.length,
      phrases:  signature_phrases.length,
      replies:  brand_reply_samples.length,
    },
  }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
