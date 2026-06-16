/**
 * Public type contract for @repo/scraping.
 *
 * These mirror the shape of Apify / Google Places responses we actually use.
 * Optional fields are explicitly typed because Apify changes its actor output
 * over time and we want to fail at compile-time when an upstream rename
 * breaks our normaliser, not silently at runtime.
 */

// ─── Instagram ────────────────────────────────────────────────────────

export interface InstagramProfile {
  username?: string | null
  fullName?: string | null
  biography?: string | null
  followersCount?: number | null
  followsCount?: number | null
  postsCount?: number | null
  profilePicUrl?: string | null
  profilePicUrlHD?: string | null
  isPrivate?: boolean
  isVerified?: boolean
  isBusinessAccount?: boolean
  businessCategoryName?: string | null
  externalUrl?: string | null
  joinedRecently?: boolean
  hasChannel?: boolean
}

export interface InstagramPostComment {
  id?: string
  text?: string
  ownerUsername?: string
  timestamp?: string | number
  replies?: InstagramPostComment[]
}

export interface InstagramPost {
  id?: string
  shortCode?: string
  url?: string
  type?: 'Image' | 'Video' | 'Sidecar' | string
  productType?: 'clips' | 'igtv' | string | null
  caption?: string
  hashtags?: string[]
  mentions?: string[]
  likesCount?: number
  commentsCount?: number
  videoViewCount?: number
  videoPlayCount?: number
  isCommentsDisabled?: boolean
  dimensionsHeight?: number
  dimensionsWidth?: number
  videoDuration?: number
  displayUrl?: string
  timestamp?: string | number
  takenAtTimestamp?: string | number
  latestComments?: InstagramPostComment[]
  musicInfo?: {
    uses_original_audio?: boolean
    audio_id?: string
    artist_name?: string
    song_name?: string
  }
}

export interface InstagramScrapeResult {
  ok: boolean
  details: InstagramProfile | null
  posts: InstagramPost[]
  error: string | null
}

// ─── Website ──────────────────────────────────────────────────────────

export interface WebsiteJsonLd {
  '@context'?: string
  '@type'?: string | string[]
  name?: string
  legalName?: string
  description?: string
  [k: string]: unknown
}

export interface WebsitePageResult {
  loadedUrl?: string
  url?: string
  title?: string
  description?: string
  markdown?: string
  text?: string
  pageType?: string
  metadata?: {
    title?: string
    description?: string
    ogTitle?: string
    ogDescription?: string
    ogImage?: string
    canonicalUrl?: string
    twitterTitle?: string
    lang?: string
  }
  structuredData?: WebsiteJsonLd[]
}

export interface WebsiteScrapeResult {
  ok: boolean
  pages: WebsitePageResult[]
  error: string | null
}

// ─── Google Places ────────────────────────────────────────────────────

export interface GooglePlacesCandidate {
  place_id?: string
  name?: string
  rating?: number
  user_ratings_total?: number
  formatted_address?: string
  types?: string[]
}

export interface GooglePlacesScrapeResult {
  ok: boolean
  candidate: GooglePlacesCandidate | null
  error: string | null
}

// ─── Combined extraction result (the response of /api/extraction/run) ─

export interface CombinedExtractionResult {
  brand_id: string
  /** ISO timestamp of when the wrapper finished. */
  completed_at: string
  /** Per-lane status — 'done' / 'unavailable' / 'skipped'. */
  status: {
    instagram: 'done' | 'unavailable' | 'skipped'
    website:   'done' | 'unavailable' | 'skipped'
    places:    'done' | 'unavailable' | 'skipped'
  }
  instagram: InstagramScrapeResult | null
  website:   WebsiteScrapeResult | null
  places:    GooglePlacesScrapeResult | null
  /** Full normalised payloads ready for persistence. */
  normalised: {
    instagram: NormalisedInstagram | null
    website:   NormalisedWebsite | null
    places:    NormalisedPlaces | null
  }
  /** Companion data for /api/extraction/persist-ig. */
  enrichment: {
    ig_post_observations: NormalisedPostObservation[]
    brand_reply_samples: string[]
    signature_hashtags: string[]
    signature_phrases: string[]
    channel_profile: NormalisedChannelProfile | null
    palette_image_urls: string[]
    mentions: NormalisedMention[]
  }
}

// ─── Normalised shapes (fed to source_records.raw_payload + persist-ig) ─

export interface NormalisedInstagramProfile {
  username: string | null
  full_name: string | null
  biography: string | null
  followers_count: number | null
  follows_count: number | null
  posts_count_total: number | null
  profile_pic_url: string | null
  is_private: boolean
  is_verified: boolean
  is_business_account: boolean
  business_category: string | null
  external_url: string | null
  joined_recently: boolean
  has_channel: boolean
}

export interface NormalisedInstagram {
  handle: string | null
  profile: NormalisedInstagramProfile | null
  posts_sample: Array<{
    caption: string
    likes: number
    comments: number
    timestamp: string | number | null
  }>
  post_count: number
  captions_for_dialect: string[]
  lifecycle_signals: {
    account_age_months: number | null
    /** ISO date string of estimated account creation (from numeric user ID interpolation) */
    account_created_estimated: string | null
    post_count: number
    post_count_total: number | null
    post_frequency_30d: number
    followers_count: number | null
  }
  signature_hashtags: string[]
  signature_phrases: string[]
  brand_reply_samples_count: number
}

export interface NormalisedWebsite {
  url: string | null
  title: string | null
  meta_description: string | null
  og_description: string | null
  og_image: string | null
  canonical_url: string | null
  language: string | null
  has_website: boolean
  content_extracted: boolean
  reason: string | null
  page_count: number
  pages_summary: Array<{
    url: string | null
    title: string | null
    snippet: string
    pageType: string | null
  }>
  homepage_markdown: string
  structured_data_org: WebsiteJsonLd | null
  structured_data_count: number
}

export interface NormalisedPlaces {
  candidate: GooglePlacesCandidate | null
  online_native: boolean
}

export interface NormalisedPostObservation {
  ig_post_id:             string | null
  short_code:             string | null
  post_url:               string | null
  post_type:              string
  product_type:           string | null
  caption:                string | null
  caption_length:         number
  hashtags:               string[]
  mentions:               string[]
  emoji_count:            number
  language_detected:      string | null
  likes_count:            number
  comments_count:         number
  video_view_count:       number | null
  video_play_count:       number | null
  comments_disabled:      boolean
  dimensions_width:       number | null
  dimensions_height:      number | null
  video_duration_seconds: number | null
  uses_original_audio:    boolean | null
  audio_id:               string | null
  posted_at:              string | number | null
}

export interface NormalisedChannelProfile {
  brand_id:           string
  channel:            string
  handle:             string | null
  profile_url:        string | null
  followers_count:    number | null
  posts_count_total:  number | null
  is_business:        boolean
  is_verified:        boolean
  synced_at:          string
}

export interface NormalisedMention {
  mentioned_username: string
  mention_count:      number
  contexts:           string[]
}
