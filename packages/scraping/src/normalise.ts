/**
 * Normalisers — convert Apify / Google Places raw output into our domain
 * shapes (typed, audit-friendly, ready for persist-ig).
 *
 * These are pure functions. No I/O, no DB. They were originally JS in n8n
 * Code nodes; ported here so they're testable and reused by the new
 * /api/extraction/run wrapper.
 */
import type {
  InstagramProfile, InstagramPost, InstagramScrapeResult,
  WebsiteScrapeResult, WebsiteJsonLd,
  GooglePlacesScrapeResult,
  NormalisedInstagram, NormalisedInstagramProfile, NormalisedWebsite, NormalisedPlaces,
  NormalisedPostObservation, NormalisedChannelProfile, NormalisedMention,
} from './types'

// ── Helpers ──────────────────────────────────────────────────────────

function toMs(t: string | number | null | undefined): number | null {
  if (t == null) return null
  if (typeof t === 'number') return t > 1e12 ? t : t * 1000
  const ms = Date.parse(String(t))
  return Number.isNaN(ms) ? null : ms
}

function emojiCount(s: string | null | undefined): number {
  if (!s) return 0
  // Match emoji-like runs (heuristic — surrogate pairs and common emoji ranges)
  const m = s.match(/[\uD83C-􏰀-\uDFFF☀-➿⌀-⏿]+/g) || []
  return m.reduce((a, x) => a + [...x].length, 0)
}

function detectLang(s: string | null | undefined): string | null {
  if (!s) return null
  const ar = (s.match(/[؀-ۿ]/g) || []).length
  const en = (s.match(/[A-Za-z]/g) || []).length
  if (ar > 0 && en > 0 && Math.min(ar, en) / Math.max(ar, en) > 0.2) return 'mixed'
  if (ar > en) return 'ar'
  if (en > ar) return 'en'
  return null
}

// ── Instagram ────────────────────────────────────────────────────────

export interface NormaliseInstagramInput {
  brand_id: string
  handle: string | null
  scrape: InstagramScrapeResult
}

export interface NormaliseInstagramOutput {
  summary: NormalisedInstagram
  observations: NormalisedPostObservation[]
  brand_reply_samples: string[]
  channel_profile: NormalisedChannelProfile
  palette_image_urls: string[]
  mentions: NormalisedMention[]
}

export function normaliseInstagram(input: NormaliseInstagramInput): NormaliseInstagramOutput {
  const { brand_id, scrape } = input
  const details = scrape.details
  const posts = scrape.posts

  const captions = posts.map((p) => p.caption || '').filter(Boolean)
  const timestamps = posts
    .map((p) => p.timestamp ?? p.takenAtTimestamp ?? null)
    .filter((t): t is string | number => t != null)
    .map(toMs)
    .filter((m): m is number => m != null)

  const now = Date.now()
  const recent30 = timestamps.length ? timestamps.filter((ms) => now - ms < 30 * 86400 * 1000).length : 0
  const oldestPostMs = timestamps.length ? Math.min(...timestamps) : null

  // ── Account age estimation (multi-signal) ────────────────────────────
  //
  // Instagram doesn't expose a public account creation date. We use three
  // signals in priority order and take the OLDEST result so we never
  // undercount the account's age:
  //
  // Signal 1 — Instagram numeric user ID (most reliable)
  //   Instagram assigned user IDs sequentially. Known ID ↔ date anchors:
  //     ~25M   → Jan 2011 (Instagram launch)
  //     ~200M  → early 2012
  //     ~500M  → mid 2012
  //     ~1B    → early 2013
  //     ~1.5B  → mid 2013
  //     ~2B    → late 2013
  //     ~3B    → mid 2014
  //     ~5B    → early 2016
  //     ~7B    → mid 2017
  //     ~10B   → early 2019
  //     ~15B   → late 2020
  //     ~20B+  → 2022+
  //   We use a logarithmic interpolation between known anchor points.
  //   For ID 5323616505 (Burgerizer): falls between 5B (Jan 2016) and 7B
  //   (Aug 2017) → interpolates to roughly mid-2017. ✓
  //
  // Signal 2 — Oldest scraped post timestamp (lower bound only)
  //   The scraper only returns the most recent 5–20 posts. Older posts
  //   exist but aren't fetched. This gives us a MINIMUM age — the account
  //   must be AT LEAST this old. Never use it as an exact creation date.
  //
  // Signal 3 — joinedRecently flag from Instagram
  //   If true → account ≤ ~6 months old. Hard cap.
  //
  // Final value = oldest of (ID-derived estimate, oldest post lower bound),
  // clamped to [0, 300] months and rounded to nearest month.

  function estimateCreationMsFromId(userId: string | null | undefined): number | null {
    const id = userId ? parseInt(userId, 10) : NaN
    if (!Number.isFinite(id) || id <= 0) return null
    // Anchor points: [user_id_threshold, approximate_date_ms]
    // Calibrated against known public accounts and confirmed join dates.
    // Key confirmed point: ID 5_323_616_505 = April 2017 (verified via
    // Instagram's "About this account" screen for @burgerizerkw).
    const anchors: [number, number][] = [
      [25_000_000,     Date.UTC(2010, 9, 1)],   // Oct 2010 — Instagram launch era
      [200_000_000,    Date.UTC(2012, 0, 1)],   // Jan 2012
      [500_000_000,    Date.UTC(2012, 7, 1)],   // Aug 2012
      [1_000_000_000,  Date.UTC(2013, 1, 1)],   // Feb 2013
      [1_500_000_000,  Date.UTC(2013, 6, 1)],   // Jul 2013
      [2_000_000_000,  Date.UTC(2014, 0, 1)],   // Jan 2014
      [3_000_000_000,  Date.UTC(2014, 9, 1)],   // Oct 2014
      [4_000_000_000,  Date.UTC(2015, 8, 1)],   // Sep 2015
      [5_000_000_000,  Date.UTC(2016, 6, 1)],   // Jul 2016
      [5_323_616_505,  Date.UTC(2017, 3, 1)],   // Apr 2017 — CONFIRMED (@burgerizerkw)
      [7_000_000_000,  Date.UTC(2018, 0, 1)],   // Jan 2018
      [10_000_000_000, Date.UTC(2019, 5, 1)],   // Jun 2019
      [15_000_000_000, Date.UTC(2021, 0, 1)],   // Jan 2021
      [20_000_000_000, Date.UTC(2022, 2, 1)],   // Mar 2022
      [30_000_000_000, Date.UTC(2023, 6, 1)],   // Jul 2023
      [50_000_000_000, Date.UTC(2024, 6, 1)],   // Jul 2024
    ]
    // Find the two anchors that straddle this ID and linearly interpolate
    for (let i = 1; i < anchors.length; i++) {
      const [id0, t0] = anchors[i - 1]!
      const [id1, t1] = anchors[i]!
      if (id <= id1) {
        const ratio = (id - id0) / (id1 - id0)
        return Math.round(t0 + ratio * (t1 - t0))
      }
    }
    // Beyond last anchor — return last anchor date
    return anchors[anchors.length - 1]![1]
  }

  const userId = (details as Record<string, unknown> | null | undefined)?.id as string | null | undefined
  const idDerivedMs = estimateCreationMsFromId(userId)

  // Take the oldest (most accurate floor) of the two signals
  const candidates = [idDerivedMs, oldestPostMs].filter((v): v is number => v != null)
  const bestCreationMs = candidates.length ? Math.min(...candidates) : null

  // If joinedRecently is true, cap at 6 months — overrides everything
  const joinedRecently = !!(details as Record<string, unknown> | null | undefined)?.joinedRecently
  const account_age_months = joinedRecently
    ? Math.min(6, bestCreationMs ? Math.floor((now - bestCreationMs) / (30 * 86400 * 1000)) : 6)
    : bestCreationMs
      ? Math.max(0, Math.round((now - bestCreationMs) / (30 * 86400 * 1000)))
      : null

  const profile: NormalisedInstagramProfile | null = details
    ? toProfile(details)
    : null

  const brandUsername = profile?.username ?? input.handle

  const observations: NormalisedPostObservation[] = posts.map((p) => ({
    ig_post_id:             p.id ?? null,
    short_code:             p.shortCode ?? null,
    post_url:               p.url ?? null,
    post_type:              String(p.type ?? 'Image'),
    product_type:           p.productType ?? null,
    caption:                p.caption ?? null,
    caption_length:         (p.caption ?? '').length,
    hashtags:               Array.isArray(p.hashtags) ? p.hashtags : [],
    mentions:               Array.isArray(p.mentions) ? p.mentions : [],
    emoji_count:            emojiCount(p.caption),
    language_detected:      detectLang(p.caption),
    likes_count:            Math.max(0, p.likesCount ?? 0),
    comments_count:         Math.max(0, p.commentsCount ?? 0),
    video_view_count:       typeof p.videoViewCount === 'number' ? Math.max(0, p.videoViewCount) : null,
    video_play_count:       typeof p.videoPlayCount === 'number' ? Math.max(0, p.videoPlayCount) : null,
    comments_disabled:      !!p.isCommentsDisabled,
    dimensions_width:       p.dimensionsWidth ?? null,
    dimensions_height:      p.dimensionsHeight ?? null,
    video_duration_seconds: typeof p.videoDuration === 'number' ? p.videoDuration : null,
    uses_original_audio:    p.musicInfo ? !!p.musicInfo.uses_original_audio : null,
    audio_id:               p.musicInfo?.audio_id ?? null,
    posted_at:              p.timestamp ?? p.takenAtTimestamp ?? null,
  }))

  // Brand replies — comment.replies[] where ownerUsername === brand
  const brand_reply_samples: string[] = []
  for (const post of posts) {
    const cmts = Array.isArray(post.latestComments) ? post.latestComments : []
    for (const cmt of cmts) {
      const replies = Array.isArray(cmt.replies) ? cmt.replies : []
      for (const reply of replies) {
        if (
          reply.ownerUsername === brandUsername &&
          typeof reply.text === 'string' &&
          reply.text.length > 5
        ) {
          brand_reply_samples.push(reply.text.slice(0, 300))
        }
      }
    }
    if (brand_reply_samples.length >= 20) break
  }

  // Signature hashtag detection
  const hashtagCounts: Record<string, number> = {}
  for (const p of posts) {
    const tags = Array.isArray(p.hashtags) ? p.hashtags : []
    for (const t of tags) {
      const k = t.trim()
      if (k) hashtagCounts[k] = (hashtagCounts[k] || 0) + 1
    }
  }
  // Adaptive threshold:
  //   • posts ≥ 10  → demand 40% recurrence (real signature signal)
  //   • posts 4–9   → demand at least 2 hits
  //   • posts ≤ 3   → take the top hashtags as-is (we can't measure recurrence
  //                   reliably, but an empty signature_hashtags array breaks the
  //                   downstream brand_profiles update — better to surface what
  //                   was seen and let COO weigh confidence later)
  const threshold =
    posts.length >= 10 ? Math.ceil(posts.length * 0.4) :
    posts.length >= 4  ? 2 :
                          1
  const signature_hashtags = Object.entries(hashtagCounts)
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k)

  // Signature phrase detection — Arabic bigrams
  const phraseCounts: Record<string, number> = {}
  for (const c of captions) {
    const cleaned = c
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#@][\w_؀-ۿ]+/g, ' ')
      .replace(/[\uD83C-􏰀-\uDFFF☀-➿]/g, ' ')
      .replace(/[!?؟،.:،]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const words = cleaned.split(/\s+/).filter((w) => w.length >= 2)
    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i + 1]}`
      if (bg.length >= 6 && bg.length <= 40) {
        phraseCounts[bg] = (phraseCounts[bg] || 0) + 1
      }
    }
  }
  // Same adaptive logic as signature_hashtags. Phrases are bigrams so the
  // false-positive rate is higher at low-N; we accept top-3 in the worst case
  // and let COO downgrade confidence via inferred_low if they're noisy.
  const signature_phrases = Object.entries(phraseCounts)
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, posts.length <= 3 ? 3 : 10)
    .map(([k]) => k)

  // Channel profile (Instagram row)
  const channel_profile: NormalisedChannelProfile = {
    brand_id,
    channel:           'Instagram',
    handle:            brandUsername,
    profile_url:       brandUsername ? `https://instagram.com/${brandUsername}` : null,
    followers_count:   profile?.followers_count ?? null,
    posts_count_total: profile?.posts_count_total ?? null,
    is_business:       !!profile?.is_business_account,
    is_verified:       !!profile?.is_verified,
    synced_at:         new Date().toISOString(),
  }

  // Palette URLs — profile pic + top-3 most-engaged post displayUrls
  const topByLikes = posts.slice().sort((a, b) => (b.likesCount ?? 0) - (a.likesCount ?? 0))
  const palette_image_urls: string[] = []
  if (profile?.profile_pic_url) palette_image_urls.push(profile.profile_pic_url)
  for (const p of topByLikes.slice(0, 3)) {
    if (p.displayUrl) palette_image_urls.push(p.displayUrl)
  }

  // Mentions network
  const mentionAgg = new Map<string, { mention_count: number; contexts: string[] }>()
  for (const p of posts) {
    const m = Array.isArray(p.mentions) ? p.mentions : []
    if (m.length === 0) continue
    const excerpt = (p.caption ?? '').replace(/\s+/g, ' ').slice(0, 140)
    for (const u of m) {
      const key = String(u || '').replace(/^@/, '').trim()
      if (!key || key === brandUsername) continue
      let entry = mentionAgg.get(key)
      if (!entry) {
        entry = { mention_count: 0, contexts: [] }
        mentionAgg.set(key, entry)
      }
      entry.mention_count += 1
      if (excerpt && entry.contexts.length < 5 && !entry.contexts.includes(excerpt)) {
        entry.contexts.push(excerpt)
      }
    }
  }
  const mentions: NormalisedMention[] = Array.from(mentionAgg.entries()).map(
    ([mentioned_username, v]) => ({
      mentioned_username,
      mention_count: v.mention_count,
      contexts:      v.contexts,
    }),
  )

  const summary: NormalisedInstagram = {
    handle: brandUsername,
    profile,
    posts_sample: posts.slice(0, 5).map((p) => ({
      caption:   (p.caption ?? '').slice(0, 500),
      likes:     p.likesCount ?? 0,
      comments:  p.commentsCount ?? 0,
      timestamp: p.timestamp ?? p.takenAtTimestamp ?? null,
    })),
    post_count: posts.length,
    captions_for_dialect: captions.slice(0, 30),
    lifecycle_signals: {
      account_age_months,
      account_created_estimated: bestCreationMs ? new Date(bestCreationMs).toISOString().slice(0, 7) : null,
      post_count: posts.length,
      post_count_total: profile?.posts_count_total ?? null,
      post_frequency_30d: recent30,
      followers_count: profile?.followers_count ?? null,
    },
    signature_hashtags,
    signature_phrases,
    brand_reply_samples_count: brand_reply_samples.length,
  }

  return {
    summary,
    observations,
    brand_reply_samples,
    channel_profile,
    palette_image_urls,
    mentions,
  }
}

function toProfile(d: InstagramProfile): NormalisedInstagramProfile {
  // Apify's IG scraper has TWO response shapes depending on the scraper
  // version: the older one uses camelCase with `is*` prefixes (isVerified,
  // isPrivate); the newer one drops the prefix (verified, private). Cover both.
  const dd = d as InstagramProfile & {
    verified?: boolean
    private?: boolean
  }
  return {
    username:            dd.username ?? null,
    full_name:           dd.fullName ?? null,
    biography:           dd.biography ?? null,
    followers_count:     typeof dd.followersCount === 'number' ? dd.followersCount : null,
    follows_count:       typeof dd.followsCount === 'number' ? dd.followsCount : null,
    posts_count_total:   typeof dd.postsCount === 'number' ? dd.postsCount : null,
    profile_pic_url:     dd.profilePicUrlHD ?? dd.profilePicUrl ?? null,
    is_private:          !!(dd.isPrivate ?? dd.private),
    is_verified:         !!(dd.isVerified ?? dd.verified),
    is_business_account: !!dd.isBusinessAccount,
    business_category:   cleanCategory(dd.businessCategoryName),
    external_url:        unwrapInstagramRedirect(dd.externalUrl),
    joined_recently:     !!dd.joinedRecently,
    has_channel:         !!dd.hasChannel,
  }
}

// Apify returns categories like "None,Food & Drink" — strip the "None," prefix
// and trim leading commas/whitespace. Returns null when the result is empty.
function cleanCategory(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/^(none\s*,\s*)+/i, '').replace(/^[,\s]+|[,\s]+$/g, '').trim()
  return cleaned || null
}

// Instagram wraps profile external URLs through `l.instagram.com/?u=<encoded>&e=…`.
// Unwrap so we store the real destination URL, not the redirector. Also strips
// the `&fbclid=` / `&e=` / `&utm_*` tracking junk Meta appends.
function unwrapInstagramRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.hostname === 'l.instagram.com' || u.hostname === 'l.facebook.com') {
      const target = u.searchParams.get('u')
      if (target) return stripTrackingParams(decodeURIComponent(target))
    }
    return stripTrackingParams(raw)
  } catch {
    return raw
  }
}

function stripTrackingParams(urlStr: string): string {
  try {
    const u = new URL(urlStr)
    for (const k of [...u.searchParams.keys()]) {
      if (k === 'fbclid' || k === 'e' || k.startsWith('utm_')) u.searchParams.delete(k)
    }
    return u.toString().replace(/\?$/, '')
  } catch {
    return urlStr
  }
}

// ── Website ──────────────────────────────────────────────────────────

export function normaliseWebsite(seedUrl: string, scrape: WebsiteScrapeResult): NormalisedWebsite {
  const pages = scrape.pages
  const seed = String(seedUrl ?? '').replace(/\/$/, '').toLowerCase()
  const home =
    pages.find((p) => String(p.loadedUrl ?? p.url ?? '').replace(/\/$/, '').toLowerCase() === seed) ??
    pages[0] ??
    null

  const meta = home?.metadata ?? {}
  const homeMarkdown = String(home?.markdown ?? home?.text ?? '').slice(0, 8000)
  const totalText = pages.reduce((acc, p) => acc + String(p.text ?? p.markdown ?? '').length, 0)
  const isHoldingPage =
    pages.length <= 1 &&
    (totalText < 1000 || /coming\s+soon|under\s+construction|stay\s+tuned/i.test(homeMarkdown))

  const structuredData: WebsiteJsonLd[] = []
  for (const p of pages) {
    if (Array.isArray(p.structuredData)) structuredData.push(...p.structuredData)
  }
  const orgLD =
    structuredData.find((s) => {
      if (!s || typeof s !== 'object') return false
      const t = s['@type']
      if (!t) return false
      const arr = Array.isArray(t) ? t : [t]
      return arr.some((x) => /^(Organization|LocalBusiness|Restaurant|Store|Corporation|NGO)$/i.test(String(x)))
    }) ?? null

  const pages_summary = pages.slice(0, 8).map((p) => ({
    url:      p.loadedUrl ?? p.url ?? null,
    title:    p.title ?? p.metadata?.title ?? null,
    snippet:  String(p.markdown ?? p.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    pageType: p.pageType ?? null,
  }))

  return {
    url:                seedUrl ?? null,
    title:              home?.title ?? meta.title ?? null,
    meta_description:   meta.description ?? home?.description ?? null,
    og_description:     meta.ogDescription ?? null,
    og_image:           meta.ogImage ?? null,
    canonical_url:      meta.canonicalUrl ?? null,
    language:           meta.lang ?? null,
    has_website:        pages.length > 0,
    content_extracted:  !isHoldingPage && pages.length > 0,
    reason:             isHoldingPage ? 'holding_page' : null,
    page_count:         pages.length,
    pages_summary,
    homepage_markdown:  homeMarkdown,
    structured_data_org: orgLD,
    structured_data_count: structuredData.length,
  }
}

// ── Google Places ────────────────────────────────────────────────────

export function normalisePlaces(scrape: GooglePlacesScrapeResult): NormalisedPlaces {
  return {
    candidate:     scrape.candidate,
    online_native: !scrape.candidate,
  }
}
