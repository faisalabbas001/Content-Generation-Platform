'use server'

import { createHmac, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db/client'
import { adminQ } from '@repo/db'
import { notify } from '@repo/email'
import { requireAdmin } from '@/lib/admin-session'
import { triggerN8nA01BatchCalendarAdmin } from '@/lib/n8n-outbound'

interface ActionOk { ok: true; request_id: string }
interface ActionFail { ok: false; error: string }
type ActionResult = ActionOk | ActionFail

const TriggerA01Schema = z.object({
  brand_id: z.string().uuid(),
})

/**
 * Admin-only: kick off N8N-A01 batch calendar for a single brand.
 * Sends brand_id so the flow's "Prepare Batch Config" node forces MONTHLY
 * mode and skips all other shards.
 */
export async function triggerA01ForBrand(input: z.infer<typeof TriggerA01Schema>): Promise<ActionResult> {
  await requireAdmin()
  const parsed = TriggerA01Schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const result = await triggerN8nA01BatchCalendarAdmin({ brand_id: parsed.data.brand_id })
  if (!result.ok) return { ok: false, error: result.error ?? `HTTP ${result.status}` }
  return { ok: true, request_id: result.request_id }
}

const ApproveAllSchema = z.object({
  calendar_id: z.string().uuid(),
})

interface ApproveAllResult {
  ok: boolean
  approved?: number
  skipped?: number
  error?: string
}

/**
 * Admin-only: "Approve All" — RELEASE every ready post in a calendar to the client.
 *
 * Admin approval = release, NOT client approval. Releasing flips each ready post to
 * status='pending' (client-visible), so the client sees them on /[slug]/calendar
 * with the AI-Draft watermark + Approve / Request-Revision. The CLIENT's own Approve
 * advances a post to 'approved'. Covers auto-passed (clean/watermark/generated) posts
 * AND any in the QA queue. Hard-blocked and image-less posts are skipped (can't be
 * client-visible). Also resolves the matching pending qa_review_queue rows.
 */
export async function approveAllCalendarPosts(
  input: z.infer<typeof ApproveAllSchema>,
): Promise<ApproveAllResult> {
  const admin = await requireAdmin()
  const parsed = ApproveAllSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const { calendar_id } = parsed.data
  const supabase = adminClient()

  // Posts eligible for release: have an image, not already released ('pending'),
  // client-approved ('approved'), rejected, or hard-blocked. clean/watermark/generated qualify.
  const { data: posts, error } = await supabase
    .from('calendar_posts')
    .select('post_id, brand_id, status, storage_url')
    .eq('calendar_id', calendar_id)
  if (error) return { ok: false, error: error.message }

  const rows = (posts ?? []) as Array<{ post_id: string; brand_id: string; status: string; storage_url: string | null }>
  const approvable = rows.filter(
    (p) => p.storage_url && !['pending', 'approved', 'rejected', 'hard_blocked'].includes(p.status),
  )
  const skipped = rows.length - approvable.length
  if (approvable.length === 0) return { ok: true, approved: 0, skipped }

  const now = new Date().toISOString()
  const ids = approvable.map((p) => p.post_id)
  const brandId = approvable[0]!.brand_id

  // 1) Release all eligible posts → 'pending' (client-visible, awaiting client approval).
  const { error: upErr } = await supabase
    .from('calendar_posts')
    .update({ status: 'pending' } as never)
    .in('post_id', ids)
  if (upErr) return { ok: false, error: upErr.message }

  // 2) Resolve matching pending QA queue rows so the queue reflects the release.
  await supabase
    .from('qa_review_queue')
    .update({ status: 'approved', resolved_at: now, reviewed_at: now } as never)
    .eq('status', 'pending')
    .in('post_id', ids)

  // 3) Audit log (one row for the batch action).
  await supabase.from('usage_logs').insert({
    flow_id: 'admin_qa', node_name: 'release_all', brand_id: brandId,
    cost_usd: 0, duration_ms: 0, status: 'success',
    payload: { calendar_id, released: ids.length, decided_by: admin.email ?? null } as never,
  } as never)

  // 4) Count this calendar toward brand_profiles.total_calendars_generated — a
  //    true per-calendar count (doc.md:418). Idempotent: increment_calendar_count
  //    flips calendars.counted_in_total exactly once (migration 0107), so this and
  //    bulkApproveCalendar (the other release surface) can never double-count.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: incErr } = await (supabase as any).rpc('increment_calendar_count', {
    p_calendar_id: calendar_id,
  })
  if (incErr) console.warn('[approveAllCalendarPosts] calendar count increment failed:', incErr.message)

  // 5) Email the client that their calendar is released — AWAITED so the Resend
  //    send completes before the action returns (fire-and-forget dies in serverless).
  //    Idempotent: atomic compare-and-set on calendars.approved_email_sent so the
  //    email fires exactly once even if "Approve All" is clicked twice.
  await sendCalendarApprovedEmail(supabase, calendar_id, brandId).catch((e) =>
    console.error('[approveAllCalendarPosts] notify error:', e),
  )

  revalidatePath('/admin/qa')
  revalidatePath(`/admin/qa/${brandId}`)
  return { ok: true, approved: ids.length, skipped }
}

/**
 * Send the 'calendar_approved' email once per calendar (idempotent). Shared shape
 * with fireNotifyCalendarApproved in app/actions/qa.ts so both "Approve All"
 * surfaces (the QA list and the brand workspace) behave identically.
 */
async function sendCalendarApprovedEmail(
  supabase: ReturnType<typeof adminClient>,
  calendarId: string,
  brandId: string,
) {
  const { data: cal } = await supabase
    .from('calendars')
    .select('month, approved_email_sent')
    .eq('calendar_id', calendarId)
    .maybeSingle()
  if (!cal) return
  const calRow = cal as { month: string; approved_email_sent: boolean }
  if (calRow.approved_email_sent) return

  // Atomic compare-and-set — skip if a concurrent release already won.
  const { count } = await supabase
    .from('calendars')
    .update({ approved_email_sent: true } as never)
    .eq('calendar_id', calendarId)
    .eq('approved_email_sent', false)
    .select('calendar_id')
  if ((count ?? 0) === 0) return

  const brandInfo = await adminQ.getBrandForQa(brandId)
  if (!brandInfo?.user_email || !brandInfo.auth_user_id) return

  // client_slug isn't on BrandQaInfo — fetch it for the deep-link URL.
  const { data: bp } = await supabase
    .from('brand_profiles')
    .select('client_slug')
    .eq('brand_id', brandId)
    .maybeSingle()
  const clientSlug = (bp as { client_slug?: string | null } | null)?.client_slug ?? null

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const calendarUrl = clientSlug
    ? `${appUrl}/${clientSlug}/calendar/${calRow.month}`
    : `${appUrl}/dashboard`

  await notify({
    templateKey: 'calendar_approved',
    variables: {
      brand_name:   brandInfo.brand_name_ar,
      month:        calRow.month,
      calendar_url: calendarUrl,
    },
    brandId,
    authUserId: brandInfo.auth_user_id,
    userEmail:  brandInfo.user_email,
    calendarId,
  })
}

// ── Run Visual QC ─────────────────────────────────────────────────────────────

const RunVisualQcSchema = z.object({
  post_id:   z.string().uuid(),
  brand_id:  z.string().uuid(),
})

interface RunVisualQcResult {
  ok: boolean
  visual_score?: number | null
  visual_issues?: unknown[]
  error?: string
}

/**
 * Admin-only: manually trigger the CCO visual-qc scorer for a single post.
 * Reads image URL + context from calendar_posts, POSTs to the internal route,
 * then the route writes visual_score + visual_issues back to the DB.
 */
export async function runVisualQcForPost(
  input: z.infer<typeof RunVisualQcSchema>,
): Promise<RunVisualQcResult> {
  await requireAdmin()
  const parsed = RunVisualQcSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const { post_id, brand_id } = parsed.data

  const db = adminClient()
  const { data: post } = await db
    .from('calendar_posts')
    .select('storage_url, clean_storage_url, image_prompt_en, chain_id, content_type, occasion_flags')
    .eq('post_id', post_id)
    .maybeSingle()
  if (!post) return { ok: false, error: 'post_not_found' }

  const imageUrl = (post as Record<string, unknown>).storage_url as string | null
  if (!imageUrl) return { ok: false, error: 'no_image_url — post has no storage_url yet' }

  const secret = process.env.N8N_WEBHOOK_SECRET?.trim()
  if (!secret) return { ok: false, error: 'N8N_WEBHOOK_SECRET not configured' }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const body = JSON.stringify({
    flow_id:  'ADMIN-MANUAL',
    brand_id,
    payload: {
      image_url:       imageUrl,
      post_id,
      chain_id:        (post as Record<string, unknown>).chain_id ?? undefined,
      visual_brief_en: (post as Record<string, unknown>).image_prompt_en ?? undefined,
      content_type:    (post as Record<string, unknown>).content_type ?? undefined,
      occasion_flags:  Array.isArray((post as Record<string, unknown>).occasion_flags)
                         ? (post as Record<string, unknown>).occasion_flags
                         : undefined,
    },
  })

  const requestId = randomUUID()
  const timestamp = new Date().toISOString()
  const signature = createHmac('sha256', secret).update(body).digest('hex')

  let res: Response
  try {
    res = await fetch(`${appUrl}/api/agents/cco/visual-qc`, {
      method:  'POST',
      headers: {
        'content-type':     'application/json',
        'x-n8n-signature':  signature,
        'x-n8n-request-id': requestId,
        'x-n8n-timestamp':  timestamp,
      },
      body,
    })
  } catch (e) {
    return { ok: false, error: `fetch_failed: ${(e as Error).message}` }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    return { ok: false, error: `visual_qc_route_${res.status}: ${txt.slice(0, 200)}` }
  }

  const json = await res.json() as Record<string, unknown>
  const result = (json.result ?? {}) as Record<string, unknown>
  const score = (json.visual_score ?? result.visual_score) as number | null | undefined
  const issues = (json.visual_issues ?? result.visual_issues ?? []) as unknown[]

  revalidatePath(`/admin/qa/${brand_id}`)
  return { ok: true, visual_score: score ?? null, visual_issues: issues }
}
