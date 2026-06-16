/**
 * POST /api/webhooks/n8n
 *
 * n8n status callback (Doc §11.1, sprint S7.01). Receives:
 *   - Batch completion summaries from N8N-A01 / N8N-A02
 *   - Onboarding completion from N8N-A03
 *   - Anomaly notifications from N8N-S03
 *   - Revision completion from N8N-B03
 *
 * Body shape (n8n-side controlled — kept loose; we only require event_type):
 *   { event_type: 'batch_complete' | 'onboarding_complete' | 'anomaly' | ...,
 *     flow_id: 'N8N-A01', brand_id?: '...', payload: {...} }
 */
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db/client'
import { notify } from '@repo/email'
import { resendClient, resendFrom } from '@repo/email/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'
import { revalidateBrandProfile } from '@/app/actions/brand-correction'
import { syncCalendarDelivery } from '@/lib/calendar-status'
import { triggerN8nA01ForMonths } from '@/lib/n8n-outbound'

// Copilot alert emails — sent directly via Resend (not through notify() which
// requires a brand owner). Pulled from env or defaults to admin allowlist.
function getCopilotEmails(copilot: string): string[] {
  const fallback = process.env.ADMIN_ALLOWLIST_EMAILS ?? ''
  const map: Record<string, string> = {
    tech:       process.env.COPILOT_TECH_EMAIL       ?? fallback,
    management: process.env.COPILOT_MANAGEMENT_EMAIL ?? fallback,
    production: process.env.COPILOT_PRODUCTION_EMAIL ?? fallback,
  }
  return (map[copilot] ?? fallback).split(',').map(s => s.trim()).filter(Boolean)
}

async function sendCopilotAlert(opts: {
  target_copilot: string
  anomaly_type: string
  severity: string
  source_flow: string
  message: string
  anomaly_id: string
  brand_id: string | null
}) {
  const recipients = getCopilotEmails(opts.target_copilot)
  if (recipients.length === 0) return
  const sevLabel = opts.severity.toUpperCase()
  const subject = `[OGz Studios ${sevLabel}] ${opts.anomaly_type} · ${opts.source_flow}`
  const html = `
<h2 style="color:${opts.severity==='critical'?'#e53e3e':'#dd6b20'}">⚠️ Anomaly Alert — ${opts.target_copilot} copilot</h2>
<table style="border-collapse:collapse;font-family:monospace;font-size:13px">
  <tr><td style="padding:4px 12px 4px 0;color:#718096">type</td><td>${opts.anomaly_type}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">severity</td><td><strong>${sevLabel}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">source_flow</td><td>${opts.source_flow}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">brand_id</td><td>${opts.brand_id ?? '—'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">anomaly_id</td><td>${opts.anomaly_id}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">message</td><td>${opts.message}</td></tr>
</table>
<p style="margin-top:16px;font-size:12px;color:#718096">Review in <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/admin/anomalies">Admin → Anomalies</a></p>
`.trim()
  try {
    const from = resendFrom()
    console.log(`[webhooks/n8n] resend sending from=${from} to=${JSON.stringify(recipients)}`)
    const result = await resendClient().emails.send({ from, to: recipients, subject, html })
    console.log(`[webhooks/n8n] resend result:`, JSON.stringify(result))
  } catch (e) {
    console.error('[webhooks/n8n] copilot alert email failed:', e)
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const StatusBody = z.object({
  event_type: z.string().min(1),
  flow_id: z.string().min(1),
  brand_id: z.string().uuid().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try {
    body = JSON.parse(verified.req.rawBody)
  } catch {
    return errorResponse(400, 'invalid_json', 'body is not valid JSON')
  }
  const parsed = StatusBody.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'body did not match schema', {
      issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
    })
  }

  // Audit row — every status callback is recorded.
  try {
    const db = adminClient()
    await db.from('usage_logs').insert({
      flow_id: parsed.data.flow_id,
      brand_id: parsed.data.brand_id ?? null,
      node_name: 'n8n_callback',
      duration_ms: 0,
      cost_usd: 0,
      payload: { event_type: parsed.data.event_type, ...parsed.data.payload, request_id: verified.req.requestId },
    } as never)
  } catch (e) {
    console.error('[webhooks/n8n] usage_logs insert failed:', e)
  }

  // Branch on event_type to keep audit + calendar state in sync.
  // ── A03 onboarding completion ─────────────────────────────────────
  // Closes the routing_decisions audit chain (outcome stays 'pending'
  // otherwise) and resolves stale ceo/coo_call_failed anomalies that
  // were retried successfully (Gap #4 + Gap #5).
  if (parsed.data.event_type === 'onboarding_complete' && parsed.data.brand_id) {
    try {
      const db = adminClient()
      const brand_id = parsed.data.brand_id

      // Flip the most recent pending routing_decisions row to completed.
      // Append-only design — we don't insert a new row, we just update the
      // open one. Using order+limit because the table doesn't expose a
      // proper "active" flag (constraints_applied carries the state).
      const { data: pending } = await db
        .from('routing_decisions')
        .select('decision_id')
        .eq('brand_id', brand_id)
        .eq('outcome', 'pending')
      if (pending && pending.length > 0) {
        const ids = pending.map((r) => (r as { decision_id: string }).decision_id)
        const { error: updErr } = await db
          .from('routing_decisions')
          .update({ outcome: 'completed' } as never)
          .in('decision_id', ids)
        if (updErr) console.warn('[webhooks/n8n] routing_decisions outcome update failed:', updErr.message)
      }

      // Mark stale AI-call anomalies as resolved. The brand reached
      // completion despite earlier retry failures — those rows are now
      // historic noise, not active incidents.
      const { error: anomErr } = await db
        .from('anomaly_records')
        .update({ resolved: true } as never)
        .eq('brand_id', brand_id)
        .in('anomaly_type', ['ceo_call_failed', 'coo_call_failed'])
        .eq('resolved', false)
      if (anomErr) console.warn('[webhooks/n8n] anomaly auto-resolve failed:', anomErr.message)

      // Fire onboarding-complete notification (fire-and-forget)
      fireNotifyOnboardingComplete(db, brand_id).catch((e) =>
        console.error('[webhooks/n8n] onboarding notify error:', e),
      )

      // ── 3-Month Rolling Calendar — Offset Orchestrator ──────────────────────
      // On onboarding completion, kick off the brand's first calendar runway by
      // firing N8N-A01 three times: month_offset 0 (current), 1 (next), 2 (3rd).
      // Each is a small, bounded single-month run (no monolithic 3-month job).
      // AWAITED — a serverless function tears down before fire-and-forget async
      // finishes (same trap we hit with emails); the calls are sequential inside
      // the helper so the DeepSeek bursts don't overlap. Wrapped so a trigger
      // failure never breaks the 200 ack — A01 is idempotent and the 1st-of-month
      // rolling cron will backfill any month that didn't fire.
      const a01Results = await triggerN8nA01ForMonths(brand_id, [0, 1, 2], 'onboarding-complete')
      const okCount = a01Results.filter((r) => r.ok).length
      console.log(`[webhooks/n8n] onboarding A01 offset-orchestrator brand=${brand_id} fired ${okCount}/3 months`)
    } catch (e) {
      console.error('[webhooks/n8n] onboarding_complete update failed:', e)
    }
  }

  // ── Anomaly notification — mark the in-flight routing decision as failed.
  if (parsed.data.event_type === 'anomaly' && parsed.data.brand_id) {
    try {
      const db = adminClient()
      await db
        .from('routing_decisions')
        .update({ outcome: 'failed' } as never)
        .eq('brand_id', parsed.data.brand_id)
        .eq('outcome', 'pending')
    } catch (e) {
      console.error('[webhooks/n8n] anomaly outcome update failed:', e)
    }
  }

  // ── anomaly_routed — N8N-S03 has classified and routed an anomaly.
  // Write anomaly_records row + emit branddna_event_log so admin UI surfaces it.
  if (parsed.data.event_type === 'anomaly_routed') {
    try {
      const db = adminClient()
      const p = parsed.data.payload as {
        anomaly_id?: string
        anomaly_type?: string
        severity?: string
        source_flow?: string
        message?: string
        details?: Record<string, unknown>
        target_copilot?: string
        human_gate?: boolean
        is_blocked?: boolean
        reasoning?: string
        human_gate_reasons?: string[]
        timestamp?: string
      }

      const anomalyId = p.anomaly_id ?? randomUUID()
      const isEnriched = p.reasoning && p.reasoning !== 'initial_record'

      // 1. Upsert anomaly_records.
      //    - First callback (reasoning='initial_record') inserts the row.
      //    - Second callback (CEO enriched) UPDATES it with target_copilot + reasoning.
      //    ignoreDuplicates:false so the enriched upsert overwrites the initial row.
      const { error: anomErr } = await db.from('anomaly_records').upsert({
        anomaly_id:   anomalyId,
        brand_id:     parsed.data.brand_id ?? null,
        anomaly_type: p.anomaly_type ?? 'UNKNOWN',
        severity:     p.severity ?? 'warning',
        source_flow:  p.source_flow ?? null,
        message:      p.message ?? null,
        details: {
          target_copilot:     p.target_copilot,
          human_gate:         p.human_gate,
          is_blocked:         p.is_blocked,
          reasoning:          p.reasoning,
          human_gate_reasons: p.human_gate_reasons,
          raw_details:        p.details,
          routed_at:          p.timestamp,
        },
        resolved: false,
      } as never, { onConflict: 'anomaly_id', ignoreDuplicates: false })
      if (anomErr) console.warn('[webhooks/n8n] anomaly_routed anomaly_records write failed:', anomErr.message)

      // 2. Send Resend alert email to the correct copilot (only on enriched callback,
      //    so we have target_copilot + reasoning from CEO).
      console.log(`[webhooks/n8n] anomaly_routed isEnriched=${isEnriched} target_copilot=${p.target_copilot} reasoning_len=${p.reasoning?.length ?? 0}`)
      if (isEnriched && p.target_copilot) {
        console.log(`[webhooks/n8n] sending copilot alert email to ${p.target_copilot}`)
        sendCopilotAlert({
          target_copilot: p.target_copilot,
          anomaly_type:   p.anomaly_type   ?? 'UNKNOWN',
          severity:       p.severity       ?? 'warning',
          source_flow:    p.source_flow    ?? 'unknown',
          message:        p.message        ?? '',
          anomaly_id:     anomalyId,
          brand_id:       parsed.data.brand_id ?? null,
        }).then(() => console.log('[webhooks/n8n] copilot alert email sent OK'))
          .catch(e => console.error('[webhooks/n8n] sendCopilotAlert failed:', e))
      }

      // 3. If human_gate=true, write qa_review_queue so Production Copilot sees it.
      //    Doc §6.4: any CEO human_gate trigger → qa_review_queue INSERT.
      if (isEnriched && p.human_gate === true && parsed.data.brand_id) {
        const reasons = Array.isArray(p.human_gate_reasons) && p.human_gate_reasons.length > 0
          ? p.human_gate_reasons.join(', ')
          : p.anomaly_type ?? 'anomaly_routed'
        const { error: qaErr } = await db.from('qa_review_queue').insert({
          brand_id:       parsed.data.brand_id,
          post_id:        null,
          status:         'pending',
          trigger_reason: `anomaly_routed:${reasons}`,
          cco_score:      null,
          flags:          { anomaly_id: anomalyId, source_flow: p.source_flow, is_blocked: p.is_blocked },
        } as never)
        if (qaErr) console.warn('[webhooks/n8n] anomaly_routed qa_review_queue write failed:', qaErr.message)
      }

      // 4. If brand-scoped, mark any open routing_decisions for this brand as failed.
      //    (branddna_event_log skipped — 'anomaly_routed' is not in event_type_enum)
      if (parsed.data.brand_id) {
        await db
          .from('routing_decisions')
          .update({ outcome: 'failed' } as never)
          .eq('brand_id', parsed.data.brand_id)
          .eq('outcome', 'pending')
          .neq('flow_id', 'N8N-S03')
      }
    } catch (e) {
      console.error('[webhooks/n8n] anomaly_routed handler failed:', e)
    }
  }

  // ── A01/A02 generation started — mark the calendar 'generating' so the client
  //    /calendar page shows a progress state while posts are produced. Optional
  //    n8n wiring; the UI also infers 'generating' for a fresh draft calendar with
  //    no client-visible posts, so this is purely an accuracy upgrade.
  if (parsed.data.event_type === 'generation_started' || parsed.data.event_type === 'batch_start') {
    try {
      const db = adminClient()
      const { calendar_id, n8n_execution_id, workflow_trigger } = parsed.data.payload as {
        calendar_id?: string
        n8n_execution_id?: string
        workflow_trigger?: string
      }
      if (calendar_id) {
        const upd: Record<string, unknown> = { status: 'generating' }
        if (n8n_execution_id) upd.n8n_execution_id = n8n_execution_id
        if (workflow_trigger)  upd.workflow_trigger  = workflow_trigger
        await db
          .from('calendars')
          .update(upd as never)
          .eq('calendar_id', calendar_id)
          .in('status', ['draft', 'generating'])
      }
    } catch (e) {
      console.error('[webhooks/n8n] generation_started update failed:', e)
    }
  }

  if (parsed.data.event_type === 'brand_complete') {
    try {
      const db = adminClient()
      const { calendar_id, brand_id, n8n_execution_id, workflow_trigger } = parsed.data.payload as {
        calendar_id?: string
        brand_id?: string
        n8n_execution_id?: string
        workflow_trigger?: string
      }
      // Generation finished. Posts are produced as 'generated' (awaiting OGZ
      // release), so the calendar moves to pending_review — NOT delivered.
      // syncCalendarDelivery resolves the correct status and, once the posts are
      // actually released (/admin/qa or /admin/content-release), fires the
      // "calendar ready" email exactly once at that authoritative moment.
      if (calendar_id) {
        await syncCalendarDelivery(calendar_id, {}, db)
        const upd: Record<string, unknown> = { generated_at: new Date().toISOString() }
        if (n8n_execution_id) upd.n8n_execution_id = n8n_execution_id
        if (workflow_trigger)  upd.workflow_trigger  = workflow_trigger
        await db
          .from('calendars')
          .update(upd as never)
          .eq('calendar_id', calendar_id)
      }
      // NOTE: total_calendars_generated is NO LONGER incremented here. Decision
      // (June 2026): a calendar counts when the ADMIN RELEASES it to the client,
      // not when A01 finishes generating it (avoids counting drafts that get
      // rejected). The increment now happens via increment_calendar_count() in the
      // admin release surfaces (bulkApproveCalendar / approveAllCalendarPosts),
      // idempotent on calendars.counted_in_total (migration 0107). Removing the old
      // blind +1 here prevents double-counting.
    } catch (e) {
      console.error('[webhooks/n8n] brand_complete update failed:', e)
    }
  }

  // ── A04 intermediate stage events — emit to branddna_event_log so the correction
  // form's Realtime subscription shows live progress (correction_received →
  // ceo_classifying → ceo_approved → memory_writing).
  const INTERMEDIATE_STAGES = ['correction_received', 'ceo_classifying', 'ceo_approved', 'memory_writing']
  if (INTERMEDIATE_STAGES.includes(parsed.data.event_type) && parsed.data.brand_id) {
    try {
      const db = adminClient()
      const payload = parsed.data.payload as Record<string, unknown>
      const fields = Array.isArray(payload.fields) ? payload.fields : null
      await db.from('branddna_event_log').insert({
        brand_id: parsed.data.brand_id,
        event_type: `correction_progress_${parsed.data.event_type}`,
        event_data: {
          stage: parsed.data.event_type,
          fields,
          field_name: payload.field_name ?? null,
          stage_at: new Date().toISOString(),
          ...payload,
        },
      } as never)
    } catch (e) {
      console.error(`[webhooks/n8n] stage emit failed (${parsed.data.event_type}):`, e)
    }
  }

  // ── A04 correction_applied — emit Realtime stage event + close routing_decisions + revalidate.
  if (parsed.data.event_type === 'correction_applied' && parsed.data.brand_id) {
    try {
      const db = adminClient()
      const payload = parsed.data.payload as Record<string, unknown>
      // Support both batch (fields[]) and legacy (field_name) payload shapes
      const fields = Array.isArray(payload.fields) ? payload.fields : null
      const fieldName = payload.field_name ? String(payload.field_name) : null
      const memoryWritten = Number(payload.memory_written ?? 0)
      const memoryRejected = Number(payload.memory_rejected ?? 0)
      // When nothing was written and nothing was rejected, the CEO produced only
      // duplicate/dropped nominations — the value is already current. Show warning.
      const isNoOp = memoryWritten === 0 && memoryRejected === 0
      await db.from('branddna_event_log').insert({
        brand_id: parsed.data.brand_id,
        event_type: isNoOp ? 'correction_progress_correction_rejected' : 'correction_progress_correction_applied',
        event_data: {
          stage: isNoOp ? 'correction_rejected' : 'correction_applied',
          fields,
          field_name: fieldName,
          memory_written: memoryWritten,
          rejection_reason: isNoOp
            ? 'No changes written — the value may already be current or no actionable nominations were produced'
            : null,
        },
      } as never)
      await db
        .from('routing_decisions')
        .update({ outcome: isNoOp ? 'failed' : 'completed' } as never)
        .eq('brand_id', parsed.data.brand_id)
        .eq('flow_id', 'N8N-A04')
        .eq('outcome', 'pending')
      // Bust Next.js page cache so the profile shows the new value on next load.
      const { data: brand } = await db
        .from('brand_profiles')
        .select('client_slug')
        .eq('brand_id', parsed.data.brand_id)
        .maybeSingle()
      if (brand?.client_slug) await revalidateBrandProfile(brand.client_slug)

      // Fire correction email only when something was actually written
      if (!isNoOp) {
        const displayField = fieldName
          ?? (Array.isArray(fields) && fields.length > 0 ? String((fields[0] as Record<string,unknown>).field_name ?? fields[0]) : null)
          ?? 'BrandDNA field'
        const displayValue = payload.new_value
          ? String(payload.new_value)
          : (Array.isArray(fields) && fields.length > 0 ? String((fields[0] as Record<string,unknown>).corrected_value ?? '—') : '—')
        fireNotifyCorrectionApplied(db, parsed.data.brand_id, displayField, displayValue).catch((e) =>
          console.error('[webhooks/n8n] correction_applied notify error:', e),
        )
      }
    } catch (e) {
      console.error('[webhooks/n8n] correction_applied post-processing failed:', e)
    }
  }

  // ── A04 correction_rejected — emit Realtime stage event + close routing_decisions.
  if (parsed.data.event_type === 'correction_rejected' && parsed.data.brand_id) {
    try {
      const db = adminClient()
      const payload = parsed.data.payload as Record<string, unknown>
      // Support both batch (fields[]) and legacy (field_name) payload shapes
      const fields = Array.isArray(payload.fields) ? payload.fields : null
      const fieldName = payload.field_name ? String(payload.field_name) : null
      // Emit stage event so the correction form's Realtime channel resolves to "Rejected"
      await db.from('branddna_event_log').insert({
        brand_id: parsed.data.brand_id,
        event_type: 'correction_progress_correction_rejected',
        event_data: {
          stage: 'correction_rejected',
          fields,
          field_name: fieldName,
          rejection_reason: payload.rejection_reason ?? null,
        },
      } as never)
      await db
        .from('routing_decisions')
        .update({ outcome: 'failed' } as never)
        .eq('brand_id', parsed.data.brand_id)
        .eq('flow_id', 'N8N-A04')
        .eq('outcome', 'pending')

      // Fire rejection email
      const displayField = fieldName
        ?? (Array.isArray(fields) && fields.length > 0 ? String((fields[0] as Record<string,unknown>).field_name ?? fields[0]) : null)
        ?? 'BrandDNA field'
      const reason = payload.rejection_reason ? String(payload.rejection_reason) : 'The correction was not accepted by the AI classifier.'
      fireNotifyCorrectionRejected(db, parsed.data.brand_id, displayField, reason).catch((e) =>
        console.error('[webhooks/n8n] correction_rejected notify error:', e),
      )
    } catch (e) {
      console.error('[webhooks/n8n] correction_rejected routing_decisions update failed:', e)
    }
  }

  // ── cost_ceiling_alert — S02 detected a brand at/over threshold ──────
  // S02 calls S03 which calls this webhook with anomaly_type='cost_ceiling_alert'
  // or 'cost_ceiling_approaching'/'cost_ceiling_breached'. We fire structured
  // notify() emails to: (1) admin via Resend direct, (2) brand client via notify().
  if (
    parsed.data.event_type === 'anomaly_routed' &&
    parsed.data.brand_id &&
    /cost_ceiling/.test(
      String((parsed.data.payload as Record<string, unknown>).anomaly_type ?? '')
    )
  ) {
    const p2 = parsed.data.payload as {
      anomaly_type?: string
      details?: {
        cost_status?: string
        current_spend_usd?: number
        ceiling_usd?: number
        spend_pct?: number
        action?: string
      }
    }
    const isBreached = p2.anomaly_type?.includes('breached') || p2.details?.cost_status === 'breached'
    fireCostAlertNotify(
      adminClient(),
      parsed.data.brand_id,
      isBreached,
      p2.details,
    ).catch((e) => console.error('[webhooks/n8n] cost alert notify error:', e))
  }

  // ── A02 on_demand_complete — mark delivered + revalidate listing ────
  // n8n sends this after uploading to Supabase Storage. The payload must
  // include request_id so we can flip the row to 'delivered' here as a
  // safety net (n8n's own Supabase Update node is the primary writer;
  // this handler is the fallback and idempotent — status guard prevents
  // overwriting a legitimate 'held' outcome set by the CEO confidence gate).
  //
  // Expected n8n payload:
  //   { event_type: 'on_demand_complete', flow_id: 'N8N-A02',
  //     brand_id: '<uuid>',
  //     payload: { request_id: '<uuid>' } }
  if (parsed.data.event_type === 'on_demand_complete' && parsed.data.brand_id) {
    try {
      const db = adminClient()
      const payload = parsed.data.payload as { request_id?: string }
      const requestId = typeof payload?.request_id === 'string' ? payload.request_id : null

      // Safety-net status flip: only touches rows that are still 'generating'.
      // Rows already set to 'held', 'delivered', or 'failed' by n8n's own
      // Supabase node are left untouched.
      let isDelivered = false
      if (requestId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updErr } = await (db as any)
          .from('on_demand_requests')
          .update({
            status:       'delivered',
            current_step: 'done',
            delivered_at: new Date().toISOString(),
          })
          .eq('request_id', requestId)
          .eq('status', 'generating') // guard — do NOT overwrite 'held'
        if (updErr) {
          console.warn('[webhooks/n8n] on_demand_complete row update failed:', updErr.message)
        }

        // Read back the authoritative status to decide whether to email the
        // client. We notify ONLY on a genuine 'delivered' outcome — a 'held'
        // row (CEO confidence gate routed it to admin QA) must NOT trigger an
        // approval email at this stage (the admin's Approve does that instead).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: statusRow } = await (db as any)
          .from('on_demand_requests')
          .select('status')
          .eq('request_id', requestId)
          .maybeSingle()
        isDelivered = (statusRow as { status?: string } | null)?.status === 'delivered'
      }

      // Cache revalidation — always run regardless of DB result.
      const { data: brand } = await db
        .from('brand_profiles')
        .select('client_slug')
        .eq('brand_id', parsed.data.brand_id)
        .maybeSingle()
      if (brand?.client_slug) {
        revalidatePath(`/${brand.client_slug}/on-demand`)
        if (requestId) {
          revalidatePath(`/${brand.client_slug}/on-demand/${requestId}`)
        }
      }

      // Notify the client that their on-demand image is ready (delivered). AWAITED
      // — fire-and-forget dies before Resend completes in serverless, leaving the
      // notification row stuck at 'queued'. notify() never throws. Skipped for
      // 'held' rows above (no approval email while a post is on hold).
      if (isDelivered && requestId) {
        await fireNotifyOnDemandDelivered(db, parsed.data.brand_id, requestId).catch((e) =>
          console.error('[webhooks/n8n] on_demand_complete notify error:', e),
        )
      }
    } catch (e) {
      console.error('[webhooks/n8n] on_demand_complete handling failed:', e)
    }
  }

  // ── P01: post published successfully ────────────────────────────────────
  //   { event_type: 'post_published', brand_id: '<uuid>',
  //     payload: { post_id: '<uuid>', platform: 'Instagram', published_at: 'ISO' } }
  if (parsed.data.event_type === 'post_published' && parsed.data.brand_id) {
    try {
      const db = adminClient()
      const payload = parsed.data.payload as { post_id?: string; platform?: string; published_at?: string }
      const postId = typeof payload?.post_id === 'string' ? payload.post_id : null
      if (postId) {
        await fireNotifyPublishSuccess(db, parsed.data.brand_id, postId, payload.platform ?? 'Instagram', payload.published_at ?? new Date().toISOString())
      }
    } catch (e) {
      console.error('[webhooks/n8n] post_published notify failed:', e)
    }
  }

  // ── P01: post publish failed ─────────────────────────────────────────────
  //   { event_type: 'post_publish_failed', brand_id: '<uuid>',
  //     payload: { post_id: '<uuid>', error: 'message' } }
  if (parsed.data.event_type === 'post_publish_failed' && parsed.data.brand_id) {
    try {
      const db = adminClient()
      const payload = parsed.data.payload as { post_id?: string; error?: string }
      const postId = typeof payload?.post_id === 'string' ? payload.post_id : null
      if (postId) {
        await fireNotifyPublishFailed(db, parsed.data.brand_id, postId, payload.error ?? 'Unknown error')
      }
    } catch (e) {
      console.error('[webhooks/n8n] post_publish_failed notify failed:', e)
    }
  }

  const responseBody = { ok: true, request_id: verified.req.requestId }
  rememberIdempotent(verified.req.idempotencyKey, 200, responseBody)
  return jsonResponse(200, responseBody)
}

// ── On-demand delivery notification ───────────────────────────────────────────
// Fired when an on-demand image is successfully generated and delivered to the
// client (status='delivered'). Reuses the existing `post_approved` template — the
// same "your post is ready" email the admin Approve path sends for on-demand items.
async function fireNotifyOnDemandDelivered(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  requestId: string,
) {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('auth_user_id, brand_name_ar')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (!brand?.auth_user_id) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  // Resolve position from the linked calendar_post; month from the request brief's
  // posting_time (on-demand posts aren't tied to a calendar, so position is 0 when
  // no calendar_post is linked — mirrors fireNotifyQaApproved's on-demand branch).
  let position = 0
  let month = ''
  let postId: string | undefined

  const { data: post } = await db
    .from('calendar_posts')
    .select('post_id, position')
    .eq('on_demand_request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(1)
  const postRow = (post as { post_id: string; position: number }[] | null)?.[0]
  if (postRow) {
    position = postRow.position
    postId = postRow.post_id
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: req } = await (db as any)
    .from('on_demand_requests')
    .select('posting_time')
    .eq('request_id', requestId)
    .maybeSingle()
  const pt = (req as { posting_time?: string | null } | null)?.posting_time
  month = pt ? pt.slice(0, 7) : new Date().toISOString().slice(0, 7)

  await notify({
    templateKey: 'post_approved',
    variables: {
      brand_name: brand.brand_name_ar,
      position,
      month,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
    postId,
  })
}

async function fireNotifyRevisionReady(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  postId: string,
  revisionNumber: number,
) {
  const [{ data: brand }, { data: post }] = await Promise.all([
    db.from('brand_profiles').select('auth_user_id, brand_name_ar').eq('brand_id', brandId).maybeSingle(),
    db.from('calendar_posts').select('position').eq('post_id', postId).maybeSingle(),
  ])

  if (!brand?.auth_user_id || !post) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  await notify({
    templateKey: 'revision_ready',
    variables: {
      brand_name: brand.brand_name_ar,
      position: post.position,
      revision_number: revisionNumber,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
    postId,
  })
}

// ── BrandDNA notification helpers ─────────────────────────────────────────────

async function fireNotifyOnboardingComplete(
  db: ReturnType<typeof adminClient>,
  brandId: string,
) {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('auth_user_id, brand_name_ar, completeness_score')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (!brand?.auth_user_id) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  await notify({
    templateKey: 'branddna_onboarding_complete',
    variables: {
      brand_name:        brand.brand_name_ar,
      completeness_score: brand.completeness_score ?? 0,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
  })
}

async function fireNotifyCorrectionApplied(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  fieldName: string,
  newValue: string,
) {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('auth_user_id, brand_name_ar')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (!brand?.auth_user_id) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  await notify({
    templateKey: 'branddna_correction_applied',
    variables: {
      brand_name: brand.brand_name_ar,
      field_name: fieldName,
      new_value:  newValue,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
  })
}

async function fireCostAlertNotify(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  isBreached: boolean,
  details?: {
    current_spend_usd?: number
    ceiling_usd?: number
    spend_pct?: number
    action?: string
    cost_status?: string
  },
) {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('auth_user_id, brand_name_ar')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (!brand?.auth_user_id) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const costPageUrl = `${appUrl}/admin/cost/${brandId}`
  const spendUsd    = (details?.current_spend_usd ?? 0).toFixed(4)
  const ceilingUsd  = (details?.ceiling_usd ?? 0).toFixed(2)
  const spendPct    = (details?.spend_pct ?? 0).toFixed(1)

  // Fetch brand_cost_config to get alert_at_pct for approaching email
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: costConfig } = await (db as any)
    .from('brand_cost_config')
    .select('alert_at_pct')
    .eq('brand_id', brandId)
    .maybeSingle()
  const alertAtPct = String(costConfig?.alert_at_pct ?? 70)

  if (isBreached) {
    await notify({
      templateKey: 'cost_ceiling_breached',
      variables: {
        brand_name:  brand.brand_name_ar,
        spend_usd:   spendUsd,
        ceiling_usd: ceilingUsd,
        spend_pct:   spendPct,
        action:      details?.action ?? 'halt_generation',
        cost_page_url: costPageUrl,
      },
      brandId,
      authUserId: brand.auth_user_id,
      userEmail,
    })
  } else {
    await notify({
      templateKey: 'cost_ceiling_approaching',
      variables: {
        brand_name:    brand.brand_name_ar,
        spend_usd:     spendUsd,
        ceiling_usd:   ceilingUsd,
        spend_pct:     spendPct,
        alert_at_pct:  alertAtPct,
        cost_page_url: costPageUrl,
      },
      brandId,
      authUserId: brand.auth_user_id,
      userEmail,
    })
  }

  // Also send direct admin Resend email (management copilot)
  const adminEmails = (process.env.COPILOT_MANAGEMENT_EMAIL ?? process.env.ADMIN_ALLOWLIST_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (adminEmails.length > 0) {
    const sevLabel = isBreached ? 'BREACHED' : 'WARNING'
    const subject  = `[OGz Cost ${sevLabel}] ${brand.brand_name_ar} — $${spendUsd} / $${ceilingUsd} (${spendPct}%)`
    const html = `
<h2 style="color:${isBreached ? '#e53e3e' : '#dd6b20'}">💰 Cost Ceiling ${isBreached ? 'Breached' : 'Approaching'} — ${brand.brand_name_ar}</h2>
<table style="border-collapse:collapse;font-family:monospace;font-size:13px">
  <tr><td style="padding:4px 12px 4px 0;color:#718096">brand</td><td>${brand.brand_name_ar}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">spend</td><td><strong>$${spendUsd}</strong> / $${ceilingUsd}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">usage</td><td><strong>${spendPct}%</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#718096">status</td><td>${details?.cost_status ?? (isBreached ? 'breached' : 'approaching')}</td></tr>
  ${isBreached ? `<tr><td style="padding:4px 12px 4px 0;color:#718096">action</td><td>${details?.action ?? 'halt_generation'}</td></tr>` : ''}
</table>
<p style="margin-top:16px"><a href="${costPageUrl}">Manage ceiling →</a></p>`.trim()
    try {
      await resendClient().emails.send({ from: resendFrom(), to: adminEmails, subject, html })
    } catch (e) {
      console.error('[webhooks/n8n] cost alert admin email failed:', e)
    }
  }
}

async function fireNotifyCorrectionRejected(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  fieldName: string,
  rejectionReason: string,
) {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('auth_user_id, brand_name_ar')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (!brand?.auth_user_id) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  await notify({
    templateKey: 'branddna_correction_rejected',
    variables: {
      brand_name:       brand.brand_name_ar,
      field_name:       fieldName,
      rejection_reason: rejectionReason,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
  })
}

async function fireNotifyPublishSuccess(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  postId: string,
  platform: string,
  publishedAt: string,
) {
  const [{ data: brand }, { data: post }] = await Promise.all([
    db.from('brand_profiles').select('auth_user_id, brand_name_ar').eq('brand_id', brandId).maybeSingle(),
    db.from('calendar_posts').select('position').eq('post_id', postId).maybeSingle(),
  ])
  if (!brand?.auth_user_id || !post) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  await notify({
    templateKey: 'publish_success',
    variables: {
      position:     post.position,
      platform,
      published_at: publishedAt,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
    postId,
  })
}

async function fireNotifyPublishFailed(
  db: ReturnType<typeof adminClient>,
  brandId: string,
  postId: string,
  errorMsg: string,
) {
  const [{ data: brand }, { data: post }] = await Promise.all([
    db.from('brand_profiles').select('auth_user_id, brand_name_ar').eq('brand_id', brandId).maybeSingle(),
    db.from('calendar_posts').select('position').eq('post_id', postId).maybeSingle(),
  ])
  if (!brand?.auth_user_id || !post) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  await notify({
    templateKey: 'publish_failed',
    variables: {
      position: post.position,
      error:    errorMsg,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
    postId,
  })
}
