/**
 * POST /api/calendar/notify
 *
 * Called by N8N-A01 immediately after the calendar row is upserted.
 * Sends the "pending review" email for type='generated' — exactly once per
 * calendar (guarded by the generated_email_sent flag on the calendars table).
 *
 * Security: same HMAC-SHA256 + timestamp + replay-protection scheme used by
 * every other n8n → Next.js route in this codebase (see lib/n8n-auth.ts).
 *
 * Body: { calendar_id: string, type: 'generated' }
 */

import { z } from 'zod'
import { adminClient } from '@repo/db/client'
import { adminQ } from '@repo/db'
import { notify } from '@repo/email'
import { resendClient, resendFrom } from '@repo/email/client'
import { verifyN8nRequest, jsonResponse, errorResponse, rememberIdempotent } from '@/lib/n8n-auth'

const BodySchema = z.object({
  calendar_id: z.string().uuid(),
  type: z.literal('generated'),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  const { req } = verified

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(JSON.parse(req.rawBody))
  } catch {
    return errorResponse(400, 'invalid_body', 'calendar_id (uuid) and type="generated" are required')
  }

  const { calendar_id } = body
  const db = adminClient()

  // Fetch calendar — include the flag so we can short-circuit cheaply.
  const { data: calendar, error: calErr } = await db
    .from('calendars')
    .select('calendar_id, brand_id, month, generated_email_sent')
    .eq('calendar_id', calendar_id)
    .maybeSingle()

  if (calErr) return errorResponse(500, 'db_error', calErr.message)
  if (!calendar) return errorResponse(404, 'not_found', 'Calendar not found')

  const cal = calendar as {
    calendar_id: string
    brand_id: string
    month: string
    generated_email_sent: boolean
  }

  if (cal.generated_email_sent) {
    // Echo calendar_id so downstream n8n nodes (Merge Posts Data) still get it.
    const result = { ok: true, skipped: true, reason: 'already_sent', calendar_id }
    rememberIdempotent(req.idempotencyKey, 200, result)
    return jsonResponse(200, result)
  }

  // Atomic compare-and-set: only update the row that still has the flag false.
  // If another concurrent call wins the race this UPDATE matches 0 rows → we skip.
  const { error: flagErr, count } = await db
    .from('calendars')
    .update({ generated_email_sent: true })
    .eq('calendar_id', calendar_id)
    .eq('generated_email_sent', false)
    .select('calendar_id')

  if (flagErr) return errorResponse(500, 'db_error', flagErr.message)
  if ((count ?? 0) === 0) {
    const result = { ok: true, skipped: true, reason: 'race_lost', calendar_id }
    rememberIdempotent(req.idempotencyKey, 200, result)
    return jsonResponse(200, result)
  }

  // Resolve brand contact details via the same helper used by approveQaItem.
  const brandInfo = await adminQ.getBrandForQa(cal.brand_id)
  if (!brandInfo?.user_email || !brandInfo.auth_user_id) {
    // No email on file — not an error, just nothing to send.
    const result = { ok: true, skipped: true, reason: 'no_user_email', calendar_id }
    rememberIdempotent(req.idempotencyKey, 200, result)
    return jsonResponse(200, result)
  }

  // Brand slug for the calendar link — fetch from brand_profiles.
  const { data: brandRow } = await db
    .from('brand_profiles')
    .select('client_slug')
    .eq('brand_id', cal.brand_id)
    .maybeSingle()

  const slug = (brandRow as { client_slug?: string | null } | null)?.client_slug ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const calendarUrl = slug ? `${appUrl}/${slug}/calendar` : `${appUrl}/dashboard`

  await notify({
    templateKey: 'calendar_pending_review',
    variables: {
      brand_name:   brandInfo.brand_name_ar,
      month:        cal.month,
      calendar_url: calendarUrl,
    },
    brandId:    cal.brand_id,
    authUserId: brandInfo.auth_user_id,
    userEmail:  brandInfo.user_email,
    calendarId: calendar_id,
  })

  // Alert the admin team that a new calendar is ready for QA review.
  fireAdminCalendarReadyAlert(brandInfo.brand_name_ar, cal.month, cal.brand_id).catch((e) =>
    console.error('[calendar/notify] admin alert error:', e),
  )

  // Echo calendar_id so downstream n8n nodes (Merge Posts Data) still get it.
  const result = { ok: true, sent: true, calendar_id }
  rememberIdempotent(req.idempotencyKey, 200, result)
  return jsonResponse(200, result)
}

async function fireAdminCalendarReadyAlert(brandNameAr: string, month: string, brandId: string) {
  const adminEmails = (process.env.COPILOT_MANAGEMENT_EMAIL ?? process.env.ADMIN_ALLOWLIST_EMAILS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (adminEmails.length === 0) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const qaUrl = `${appUrl}/admin/qa/${brandId}`

  await resendClient().emails.send({
    from:    resendFrom(),
    to:      adminEmails,
    subject: `📋 تقويم جديد للمراجعة — ${brandNameAr} (${month})`,
    html: `<div dir="rtl" style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="margin:0 0 8px">تقويم جاهز للمراجعة</h2>
      <p style="color:#555;margin:0 0 16px">
        العلامة التجارية: <strong>${brandNameAr}</strong><br/>
        الشهر: <strong>${month}</strong>
      </p>
      <a href="${qaUrl}" style="display:inline-block;background:#10b981;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">
        فتح صفحة المراجعة
      </a>
    </div>`,
  })
}
