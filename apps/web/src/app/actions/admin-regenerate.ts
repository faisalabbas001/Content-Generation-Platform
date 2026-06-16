/**
 * Admin server actions — on-demand Regenerate (Generate-Then-Review, admin side).
 *
 * Mirrors the user-side regenerate flow (`[slug]/on-demand/actions.ts` →
 * requestRegenerate → N8N-B03), but with `target:'admin'` so B03 writes the
 * result into the `admin_regenerations` draft lane instead of overwriting the
 * live calendar_posts row. Admin drafts stay invisible to the client until an
 * admin approves a version, which promotes it into calendar_posts.
 *
 * All actions require admin auth (validated server-side, not just by proxy) and
 * use the service-role adminClient (admin_regenerations RLS is service-role-only).
 */
'use server'

import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db/client'
import { adminRegenQ, adminQ } from '@repo/db'
import { requireAdmin } from '@repo/auth/admin'
import { notify } from '@repo/email'

export interface AdminRegenResult {
  ok: boolean
  /** Discriminates failure modes for the UI banner. Absent on success. */
  status?: 'held' | 'rejected' | 'failed'
  message?: string
  error?: string
}

export interface AdminRegeneratePromptOverride {
  special_instructions?: string
  style_descriptor?: string
  hero_concept?: string
  negative_prompt?: string
  cultural_guidance?: string
}

export interface RequestAdminRegenerateInput {
  postId: string
  requestId: string | null
  brandId: string
  promptOverride?: AdminRegeneratePromptOverride
  imageModel?: string
}

/**
 * Triggers N8N-B03 with target:'admin'. B03 runs the full pipeline and inserts a
 * new draft row into admin_regenerations — it does NOT touch calendar_posts,
 * on_demand_requests.status, or qa_review_queue. The webhook is synchronous
 * (respondToWebhook), so this awaits the full run and the UI just refreshes.
 */
export async function requestAdminRegenerate(
  input: RequestAdminRegenerateInput,
): Promise<AdminRegenResult> {
  const admin = await requireAdmin()
  const { postId, requestId, brandId, promptOverride, imageModel } = input

  const b03Url =
    process.env.N8N_B03_WEBHOOK_URL ??
    'https://ogzstudios.app.n8n.cloud/webhook/revision-request'

  try {
    const res = await fetch(b03Url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_id:             brandId,
        post_id:              postId,
        target:               'admin',
        created_by:           admin.email ?? null,
        image_model:          imageModel ?? 'auto',
        revision_reason:      promptOverride?.special_instructions
          ? `Admin correction: ${promptOverride.special_instructions.slice(0, 120)}`
          : 'Admin requested regeneration from QA queue.',
        revision_type:        'full',
        special_instructions: promptOverride?.special_instructions ?? '',
        ...(requestId ? { request_id: requestId } : {}),
        ...(promptOverride ? { prompt_override: promptOverride } : {}),
      }),
    })

    // B03 always replies with JSON. Same three outcomes as the user path:
    //   { success: true,  target: 'admin', regen_id, version }  → draft created
    //   { success: false, status: 'held',     message }         → QC gate held
    //   { success: false, status: 'rejected', message }         → brand-safety block
    let body: { success?: boolean; status?: string; message?: string } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      // Non-JSON body — leave empty.
    }

    if (!res.ok) {
      console.error('[admin-regenerate] B03 HTTP error:', res.status, body)
      return { ok: false, status: 'failed', error: body.message ?? `Request failed (${res.status}).` }
    }

    if (body.success === false) {
      const status = body.status ?? 'unknown'
      if (status === 'held') {
        return { ok: false, status: 'held', message: body.message ? `Regeneration was held by the quality gate: ${body.message}` : 'Regeneration was held by the quality gate.' }
      }
      if (status === 'rejected') {
        return { ok: false, status: 'rejected', message: body.message ? `Regeneration was blocked by the brand-safety gate: ${body.message}` : 'Regeneration was blocked by the brand-safety gate.' }
      }
      return { ok: false, status: 'failed', message: body.message ?? 'Regeneration could not be completed.' }
    }

    revalidatePath('/admin/qa')
    return { ok: true, message: 'New draft is ready.' }
  } catch (err) {
    console.error('[admin-regenerate] webhook fetch failed:', err)
    return { ok: false, status: 'failed', error: 'Could not reach the generation service. Please try again.' }
  }
}

/**
 * Approve (release) an admin draft regeneration. Promotes the chosen version into
 * the live calendar_posts row and RELEASES it to the client (status='pending'), so
 * the client sees it on /[slug]/calendar and can Approve / Request-Revision it
 * themselves — admin approval is release, not client approval. Also reveals the
 * on-demand request, resolves the open QA queue row, marks sibling drafts
 * superseded, and audits the decision.
 *
 * SCORING: Before promoting, we run visual-qc on the draft image so the promoted
 * post has the same visual_score + composite quality signal as A01/V01-generated
 * posts. This fulfils the "regen must pass through the same scoring phase" requirement.
 * visual-qc is best-effort: if it fails, the promotion still completes (non-blocking).
 */
export async function approveAdminRegeneration(regenId: string): Promise<AdminRegenResult> {
  const admin = await requireAdmin()
  const supabase = adminClient()

  const draft = await adminRegenQ.getAdminRegenerationById(regenId)
  if (!draft) return { ok: false, error: 'regen_not_found' }
  if (draft.status !== 'draft') return { ok: false, error: `Already ${draft.status}` }

  // ── Run visual-qc on the draft image (same scoring phase as A01/V01) ─────────
  // Fetch the calendar_post to get chain context + brand context for the scorer.
  let visualScore: number | null = draft.visual_score ?? null
  let visualIssues: Array<{ code: string; label: string; severity: 'high' | 'med' | 'low'; detail?: string }> = draft.visual_issues ?? []

  // Only run visual-qc if the draft hasn't been scored yet AND has a live image
  if (visualScore === null && draft.storage_url) {
    try {
      const { data: post } = await supabase
        .from('calendar_posts')
        .select('image_prompt_en, content_type, chain_id')
        .eq('post_id', draft.post_id)
        .maybeSingle()

      // style_register may not be in generated types yet — cast to access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: brand } = await (supabase as any)
        .from('brand_profiles')
        .select('style_register, primary_color_hex, religious_sensitivity')
        .eq('brand_id', draft.brand_id)
        .maybeSingle() as { data: { style_register?: string | null; primary_color_hex?: string | null; religious_sensitivity?: string | null } | null }

      // Determine the app base URL for internal API calls
      const appUrl = process.env.NEXT_PUBLIC_APP_URL
        ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

      const vqcRes = await fetch(`${appUrl}/api/agents/cco/visual-qc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow_id:  'admin_regen_approve',
          brand_id: draft.brand_id,
          payload: {
            image_url:       draft.storage_url,
            post_id:         draft.post_id,
            visual_brief_en: (post as { image_prompt_en?: string | null } | null)?.image_prompt_en ?? undefined,
            content_type:    (post as { content_type?: string | null } | null)?.content_type ?? undefined,
            chain_id:        (post as { chain_id?: string | null } | null)?.chain_id ?? undefined,
            style_register:  brand?.style_register ?? undefined,
            color_palette:   brand?.primary_color_hex ? [brand.primary_color_hex] : undefined,
            religious_sensitivity: brand?.religious_sensitivity as 'Low' | 'Medium' | 'High' | undefined,
          },
        }),
      })

      if (vqcRes.ok) {
        const vqcData = await vqcRes.json() as {
          visual_score?: number
          visual_issues?: Array<{ code: string; label: string; severity: 'high' | 'med' | 'low'; detail?: string }>
        }
        if (typeof vqcData.visual_score === 'number') {
          visualScore  = vqcData.visual_score
          visualIssues = Array.isArray(vqcData.visual_issues) ? vqcData.visual_issues : []
          // Write scores back to the draft row so it persists regardless of promotion
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from('admin_regenerations')
              .update({ visual_score: visualScore, visual_issues: visualIssues })
              .eq('regen_id', regenId)
          } catch { /* non-fatal — draft update failed but promotion continues */ }
        }
      }
    } catch (e) {
      // Non-fatal: visual-qc failure must never block admin from approving a regen
      console.warn('[approveAdminRegeneration] visual-qc failed (non-fatal):', (e as Error).message)
    }
  }

  const now = new Date().toISOString()

  // 1. Promote draft → live calendar_posts (the reveal). Mirrors the on-demand
  //    approve semantics in actions/qa.ts, but the media comes from the draft.
  //    visual_score + visual_issues are now included so the promoted post has the
  //    same quality signal as A01/V01-generated posts.
  await supabase
    .from('calendar_posts')
    .update({
      storage_url:       draft.storage_url,
      clean_storage_url: draft.clean_storage_url,
      caption_ar:        draft.caption_ar,
      hashtags:          draft.hashtags,
      confidence_score:  draft.confidence_score,
      watermark:         draft.watermark,
      media_type:        draft.media_type,
      visual_score:      visualScore,
      visual_issues:     visualIssues,
      // Release to client — the CLIENT approves it from /[slug]/calendar.
      status:            'pending',
    } as never)
    .eq('post_id', draft.post_id)

  // 2. Reveal the on-demand request to the client.
  if (draft.request_id) {
    await supabase
      .from('on_demand_requests')
      .update({ status: 'delivered', delivered_at: now } as never)
      .eq('request_id', draft.request_id)
  }

  // 3. Mark this draft approved; supersede any other open drafts for the post.
  //    admin_regenerations is added by migration 0099 — cast until db:types is
  //    regenerated so the table is known to the generated Database typings.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regenTable = (supabase as any)
  await regenTable
    .from('admin_regenerations')
    .update({ status: 'approved', reviewed_at: now, reviewed_by: admin.email ?? null })
    .eq('regen_id', regenId)
  await regenTable
    .from('admin_regenerations')
    .update({ status: 'superseded', reviewed_at: now, reviewed_by: admin.email ?? null })
    .eq('post_id', draft.post_id)
    .eq('status', 'draft')

  // 4. Resolve the open QA queue row for this post so the card leaves the queue.
  await supabase
    .from('qa_review_queue')
    .update({ status: 'approved', resolved_at: now, reviewed_at: now } as never)
    .eq('post_id', draft.post_id)
    .eq('status', 'pending')

  // 5. Audit.
  await supabase.from('usage_logs').insert({
    flow_id: 'admin_qa',
    node_name: 'regen_approved',
    brand_id: draft.brand_id,
    cost_usd: 0,
    duration_ms: 0,
    status: 'success',
    payload: { regen_id: regenId, post_id: draft.post_id, version: draft.version, decided_by: admin.email ?? null } as never,
  } as never)

  await fireNotifyApproved(supabase, draft.brand_id, draft.post_id, draft.request_id).catch((e) =>
    console.error('[approveAdminRegeneration] notify error:', e),
  )

  revalidatePath('/admin/qa')
  revalidatePath('/[slug]/on-demand', 'layout')
  return { ok: true }
}

/**
 * Reject an admin draft regeneration. The draft is marked rejected and stays in
 * admin history; NO user-facing table is touched — the client keeps seeing the
 * last approved asset.
 */
export async function rejectAdminRegeneration(regenId: string): Promise<AdminRegenResult> {
  const admin = await requireAdmin()
  const supabase = adminClient()

  const draft = await adminRegenQ.getAdminRegenerationById(regenId)
  if (!draft) return { ok: false, error: 'regen_not_found' }
  if (draft.status !== 'draft') return { ok: false, error: `Already ${draft.status}` }

  const now = new Date().toISOString()
  // admin_regenerations cast — see note in approveAdminRegeneration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('admin_regenerations')
    .update({ status: 'rejected', reviewed_at: now, reviewed_by: admin.email ?? null })
    .eq('regen_id', regenId)

  await supabase.from('usage_logs').insert({
    flow_id: 'admin_qa',
    node_name: 'regen_rejected',
    brand_id: draft.brand_id,
    cost_usd: 0,
    duration_ms: 0,
    status: 'success',
    payload: { regen_id: regenId, post_id: draft.post_id, version: draft.version, decided_by: admin.email ?? null } as never,
  } as never)

  revalidatePath('/admin/qa')
  return { ok: true }
}

/** Fire the "post approved" email (mirrors fireNotifyQaApproved's calendar-post branch). */
async function fireNotifyApproved(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  postId: string,
  requestId: string | null,
) {
  const brandInfo = await adminQ.getBrandForQa(brandId)
  if (!brandInfo?.user_email || !brandInfo.auth_user_id) return

  let position = 0
  let month = ''
  const { data: post } = await db
    .from('calendar_posts')
    .select('position, calendar_id')
    .eq('post_id', postId)
    .maybeSingle()
  if (post) {
    position = (post as { position: number }).position
    const calId = (post as { calendar_id?: string | null }).calendar_id
    if (calId) {
      const { data: cal } = await db.from('calendars').select('month').eq('calendar_id', calId).maybeSingle()
      month = (cal as { month?: string } | null)?.month ?? ''
    }
  }
  if (!month && requestId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: req } = await (db as any)
      .from('on_demand_requests')
      .select('posting_time')
      .eq('request_id', requestId)
      .maybeSingle()
    const pt = (req as { posting_time?: string | null } | null)?.posting_time
    month = pt ? pt.slice(0, 7) : new Date().toISOString().slice(0, 7)
  }

  await notify({
    templateKey: 'post_approved',
    variables: { brand_name: brandInfo.brand_name_ar, position, month },
    brandId,
    authUserId: brandInfo.auth_user_id,
    userEmail: brandInfo.user_email,
    postId,
  })
}

/** Fetch all admin draft regenerations for a single post (service-role). */
export async function getAdminRegensForPost(postId: string) {
  await requireAdmin()
  const map = await adminRegenQ.listAdminRegenerationsForPosts([postId])
  return map.get(postId) ?? []
}
