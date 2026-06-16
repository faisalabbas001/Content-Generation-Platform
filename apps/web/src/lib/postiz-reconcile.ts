import { adminClient } from '@repo/db'
import { postizListPosts } from '@/lib/postiz'

/**
 * Lazy batch reconcile, called from the calendar month page (server component)
 * on every render: any post still marked 'scheduled' whose posting_time has
 * passed is checked against Postiz reality in ONE list call. Posts Postiz
 * reports PUBLISHED flip to published (+ Instagram permalink in
 * external_post_id); ERROR flips to failed. So statuses are correct the
 * moment the user opens the calendar — no open drawer or countdown needed.
 *
 * Never throws — a Postiz hiccup must not break the page render.
 */
export async function reconcileOverdueScheduledPosts(brandId: string): Promise<void> {
  try {
    const apiKey = process.env.POSTIZ_API_KEY
    if (!apiKey) return

    const db = adminClient()
    const { data: posts } = await db
      .from('calendar_posts')
      .select('post_id, postiz_post_id, posting_time')
      .eq('brand_id', brandId)
      .eq('publish_status', 'scheduled')
      .not('postiz_post_id', 'is', null)
      .lt('posting_time', new Date().toISOString())
    if (!posts || posts.length === 0) return

    const times = posts
      .map((p) => (p.posting_time ? new Date(p.posting_time).getTime() : Date.now()))
      .filter((t) => !isNaN(t))
    const start = new Date(Math.min(...times) - 24 * 3600_000).toISOString()
    const end = new Date(Date.now() + 24 * 3600_000).toISOString()
    const remote = await postizListPosts(apiKey, start, end)
    const byId = new Map(remote.map((r) => [r.id, r]))

    for (const p of posts) {
      const r = byId.get(p.postiz_post_id as string)
      if (r?.state === 'PUBLISHED') {
        await db
          .from('calendar_posts')
          .update({
            publish_status: 'published',
            published_at: r.publishDate ?? new Date().toISOString(),
            external_post_id: r.releaseURL ?? null,
          })
          .eq('post_id', p.post_id)
      } else if (r?.state === 'ERROR') {
        await db
          .from('calendar_posts')
          .update({ publish_status: 'failed' })
          .eq('post_id', p.post_id)
      }
      // Still QUEUE / not found in window → leave as scheduled.
    }
  } catch (err) {
    console.error('[postiz-reconcile] batch reconcile failed:', err)
  }
}
