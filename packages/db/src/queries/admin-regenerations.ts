/**
 * Admin draft-regeneration queries (migration 0099, admin_regenerations).
 *
 * Service-role only — the table's RLS denies all non-service-role access, so
 * these run exclusively through {@link adminClient}. Admin regenerations are a
 * separate "draft lane" that never touches the live calendar_posts row until an
 * admin approves a version.
 */
import { adminClient, isDbConfigured } from '../client'
import type { AdminRegeneration, AdminRegenerationSummary, AdminRegenPromptOverride } from '../types'

const SUMMARY_COLUMNS =
  'regen_id, post_id, version, media_type, storage_url, clean_storage_url, caption_ar, hashtags, confidence_score, watermark, prompt_override, image_model, status, created_by, created_at, visual_score, visual_issues'

/**
 * B03 stores prompt_override as a JSON string (its INSERT does
 * `JSON.stringify(prompt_override)`); a jsonb column can also hand it back as an
 * object. Normalise both to {@link AdminRegenPromptOverride} | null.
 */
function parsePromptOverride(v: unknown): AdminRegenPromptOverride | null {
  if (!v) return null
  if (typeof v === 'object') return v as AdminRegenPromptOverride
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' ? (parsed as AdminRegenPromptOverride) : null
    } catch {
      return null
    }
  }
  return null
}

function toSummary(r: Record<string, unknown>): AdminRegenerationSummary {
  return {
    regen_id:          r.regen_id as string,
    post_id:           r.post_id as string,
    version:           (r.version as number) ?? 0,
    media_type:        ((r.media_type as string) === 'video' ? 'video' : 'image'),
    storage_url:       r.storage_url as string,
    clean_storage_url: (r.clean_storage_url as string | null) ?? null,
    caption_ar:        (r.caption_ar as string | null) ?? null,
    hashtags:          (r.hashtags as string[] | null) ?? [],
    // confidence_score is a numeric column — PostgREST/pg can return it as a
    // string ("85"), which breaks `.toFixed()` downstream. Coerce to number.
    confidence_score:  r.confidence_score != null ? Number(r.confidence_score) : null,
    watermark:         Boolean(r.watermark),
    prompt_override:   parsePromptOverride(r.prompt_override),
    image_model:       (r.image_model as string | null) ?? null,
    status:            (r.status as AdminRegenerationSummary['status']) ?? 'draft',
    created_by:        (r.created_by as string | null) ?? null,
    created_at:        r.created_at as string,
    visual_score:      (r.visual_score as number | null) ?? null,
    visual_issues:     Array.isArray(r.visual_issues)
                         ? (r.visual_issues as AdminRegenerationSummary['visual_issues'])
                         : null,
  }
}

/**
 * Bulk-fetch admin draft regenerations for a set of posts, newest version first.
 * Returns a `post_id → summaries[]` map for cheap attachment during QA enrichment.
 */
export async function listAdminRegenerationsForPosts(
  postIds: string[],
): Promise<Map<string, AdminRegenerationSummary[]>> {
  const byPost = new Map<string, AdminRegenerationSummary[]>()
  if (!isDbConfigured() || postIds.length === 0) return byPost

  // admin_regenerations is added by migration 0099; the generated database.types
  // only know it after `pnpm db:types`. Cast until the types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient() as any)
    .from('admin_regenerations')
    .select(SUMMARY_COLUMNS)
    .in('post_id', postIds)
    .order('version', { ascending: false })

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const pid = row.post_id as string
    const list = byPost.get(pid) ?? []
    list.push(toSummary(row))
    byPost.set(pid, list)
  }
  return byPost
}

/** Fetch a single admin regeneration row (full record) by id. */
export async function getAdminRegenerationById(
  regenId: string,
): Promise<AdminRegeneration | null> {
  if (!isDbConfigured()) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient() as any)
    .from('admin_regenerations')
    .select('*')
    .eq('regen_id', regenId)
    .maybeSingle()
  return (data as AdminRegeneration | null) ?? null
}
