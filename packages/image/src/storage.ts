/**
 * Supabase Storage helper — upload a post image and return its public URL.
 *
 * Hard Rule #4: only the Supabase Storage URL is persisted. The fal CDN URL
 * is never passed here — the caller passes a raw Buffer.
 *
 * Storage path: clients/{brand_id}/calendars/{YYYY-MM}/{post_id}.jpg
 * (per PDF §3.3 Node 9)
 */
import { adminClient } from '@repo/db/client'

const BUCKET = 'post-images'

/**
 * @param revisionCount  0 = original (no suffix); N > 0 = `{postId}-rN.jpg`.
 *   Versioned paths preserve old images in storage when a post is regenerated,
 *   enabling the image history gallery in the on-demand detail page.
 */
export async function uploadPostImage(
  buf: Buffer,
  brandId: string,
  postId: string,
  month: string, // 'YYYY-MM'
  revisionCount = 0,
  opts: { contentType?: string; extension?: string } = {},
): Promise<string> {
  const db = adminClient()
  const ext = opts.extension ?? 'jpg'
  const contentType = opts.contentType ?? 'image/jpeg'
  const filename = revisionCount > 0 ? `${postId}-r${revisionCount}.${ext}` : `${postId}.${ext}`
  const storagePath = `clients/${brandId}/calendars/${month}/${filename}`

  const { error } = await db.storage.from(BUCKET).upload(storagePath, buf, {
    contentType,
    upsert: true,
  })

  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)

  const { data } = db.storage.from(BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}

/**
 * Uploads the pre-overlay (no Arabic typography) variant alongside the public
 * image. Stored at the same folder with a `-clean` suffix, e.g.
 *   {postId}-clean.jpg          for the original generation
 *   {postId}-r{N}-clean.jpg     for the Nth revision
 *
 * Surfaced via `calendar_posts.clean_storage_url` so users can download a
 * text-free version for editorial reuse. The buffer comes from the same
 * generation pipeline immediately before Sharp's overlay step.
 *
 * Failure mode is non-fatal at the caller's discretion: the public image
 * upload is what the post needs; the clean variant is value-add. Callers
 * may wrap this in a try/catch and continue if it fails.
 */
export async function uploadCleanPostImage(
  buf: Buffer,
  brandId: string,
  postId: string,
  month: string,
  revisionCount = 0,
): Promise<string> {
  const db = adminClient()
  const filename = revisionCount > 0
    ? `${postId}-r${revisionCount}-clean.jpg`
    : `${postId}-clean.jpg`
  const storagePath = `clients/${brandId}/calendars/${month}/${filename}`

  const { error } = await db.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: 'image/jpeg',
    upsert: true,
  })

  if (error) throw new Error(`Supabase Storage upload (clean) failed: ${error.message}`)

  const { data } = db.storage.from(BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}
