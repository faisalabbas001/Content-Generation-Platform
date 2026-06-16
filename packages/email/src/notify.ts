/**
 * notify() — single entry-point for the entire notification system.
 *
 * What it does in one call:
 *   1. Fetches the active template for (templateKey, lang) from the DB
 *   2. Falls back to 'ar' if the requested lang has no template yet
 *   3. Validates that all declared template variables are present in the caller's
 *      values — warns on missing ones so bugs surface immediately in logs
 *   4. Renders {{variable}} placeholders with the caller's values
 *   5. Inserts the notification row (inbox record, resend_status='queued')
 *   6. Sends the email via Resend
 *   7. Updates resend_status to 'sent' or 'failed' + stores the Resend message ID
 *
 * Never throws to the caller — all errors are caught, logged, and stored
 * in resend_error so the delivery log is always complete.
 *
 * Usage from any module:
 *   import { notify } from '@repo/email'
 *
 *   await notify({
 *     templateKey: 'post_approved',
 *     variables:   { brand_name: 'KFC', position: 3, month: 'مايو 2026' },
 *     brandId:     brand.brand_id,
 *     authUserId:  user.id,
 *     userEmail:   user.email,
 *     postId:      post.post_id,   // optional
 *   })
 */

import { adminClient } from '@repo/db/client'
import { renderAll } from './render'
import { resendClient, resendFrom } from './client'
import type { NotificationTemplateKey, NotificationVariables, NotifyParams } from './types'

// Maximum attempts for a single notify() call (initial + 2 retries).
const MAX_ATTEMPTS = 3

// Delay between retries: [1 s, 3 s] — small, because notify() is already
// called fire-and-forget from server actions and webhook handlers.
const RETRY_DELAYS_MS = [1_000, 3_000]

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Resend returns errors as objects ({ name, message, statusCode }), so String(err)
// yields "[object Object]". Pull out the useful fields for a readable resend_error.
function stringifyError(err: unknown): string {
  if (err == null) return 'unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as { name?: string; message?: string; statusCode?: number }
    const parts = [e.name, e.message].filter(Boolean)
    if (parts.length) return `${parts.join(': ')}${e.statusCode ? ` (HTTP ${e.statusCode})` : ''}`
    try { return JSON.stringify(err) } catch { return String(err) }
  }
  return String(err)
}

export async function notify<K extends NotificationTemplateKey>(
  params: NotifyParams<K>,
): Promise<void> {
  const {
    templateKey,
    variables,
    brandId,
    authUserId,
    userEmail,
    postId,
    calendarId,
    lang = 'ar',
  } = params

  const db = adminClient()

  // ── Step 1: fetch template ─────────────────────────────────────────────────
  const { data: tpl, error: tplError } = await db
    .from('notification_templates')
    .select('subject, title, body_html, variables')
    .eq('template_key', templateKey)
    .eq('lang', lang)
    .eq('is_active', true)
    .maybeSingle()

  if (tplError || !tpl) {
    // Fallback: try Arabic if the requested lang doesn't exist yet
    if (lang !== 'ar') {
      return notify({ ...params, lang: 'ar' })
    }
    console.error(`[notify] template not found: ${templateKey}/${lang}`, tplError)
    return
  }

  // ── Step 2: validate variables ─────────────────────────────────────────────
  // Warn when the template declares a variable that the caller didn't supply.
  // The email still sends — missing vars stay as {{variable}} in the output —
  // but the warning makes the bug visible in logs immediately.
  const vars = variables as Record<string, unknown>
  const declaredVars = Array.isArray(tpl.variables) ? (tpl.variables as string[]) : []
  const missingVars = declaredVars.filter((v) => vars[v] === undefined || vars[v] === null)
  if (missingVars.length > 0) {
    console.warn(
      `[notify] template "${templateKey}/${lang}" has unreplaced variables: ${missingVars.map((v) => `{{${v}}}`).join(', ')}`,
    )
  }

  // ── Step 3: render ─────────────────────────────────────────────────────────
  const rendered = renderAll(tpl, vars)

  // ── Step 4: insert inbox row ───────────────────────────────────────────────
  const { data: notif, error: insertError } = await db
    .from('notifications')
    .insert({
      brand_id:           brandId,
      auth_user_id:       authUserId,
      template_key:       templateKey,
      lang,
      rendered_subject:   rendered.subject,
      rendered_title:     rendered.title,
      rendered_body_html: rendered.body_html,
      variables_used:     vars as never,
      post_id:            postId ?? null,
      calendar_id:        calendarId ?? null,
      resend_status:      'queued',
    } as never)
    .select('notification_id')
    .single()

  if (insertError || !notif) {
    console.error('[notify] DB insert failed', insertError)
    return
  }

  // ── Step 5: send via Resend — with exponential-backoff retry ──────────────
  // EMAIL_TO_OVERRIDE redirects all mail to a fixed address (dev / testing).
  const toAddress = process.env.EMAIL_TO_OVERRIDE?.trim() || userEmail

  let lastError: unknown = null
  let messageId: string | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 3_000)
    }

    const { data: email, error: sendError } = await resendClient().emails.send({
      from:    resendFrom(),
      to:      toAddress,
      subject: rendered.subject,
      html:    rendered.body_html,
    })

    if (!sendError) {
      messageId = email?.id ?? null
      lastError = null
      break
    }

    lastError = sendError
    console.warn(`[notify] Resend attempt ${attempt + 1}/${MAX_ATTEMPTS} failed for ${templateKey}:`, sendError)
  }

  // ── Step 6: update delivery status + retry_count ──────────────────────────
  const succeeded = lastError === null
  // Resend errors are objects ({ name, message, statusCode }); String(err) gives
  // a useless "[object Object]". Serialise the real fields so failures are debuggable.
  const errText = succeeded ? null : stringifyError(lastError)
  await db
    .from('notifications')
    .update({
      resend_message_id: messageId,
      resend_status:     succeeded ? 'sent' : 'failed',
      resend_error:      errText,
      sent_at:           succeeded ? new Date().toISOString() : null,
      retry_count:       succeeded ? 0 : MAX_ATTEMPTS - 1,
    })
    .eq('notification_id', notif.notification_id)

  if (!succeeded) {
    console.error(`[notify] All ${MAX_ATTEMPTS} attempts failed for ${templateKey} → ${userEmail}`)
  }
}
