'use server'

import { adminClient } from '@repo/db/client'
import { getAnthropicClient } from '@repo/ai'
import { requireAdmin } from '@/lib/admin-session'
import { renderAll } from '@repo/email/render'
import { resendClient, resendFrom } from '@repo/email/client'

// ── Template management ───────────────────────────────────────────────────────

export async function saveTemplate(
  templateKey: string,
  lang: string,
  patch: {
    subject: string
    title: string
    body_html: string
    body_text: string
    is_active: boolean
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const admin = await requireAdmin()
    const db = adminClient()

    const { error } = await db
      .from('notification_templates')
      .update({
        subject:    patch.subject,
        title:      patch.title,
        body_html:  patch.body_html,
        body_text:  patch.body_text || null,
        is_active:  patch.is_active,
        updated_at: new Date().toISOString(),
        updated_by: admin.id,           // ← was always null before
      })
      .eq('template_key', templateKey)
      .eq('lang', lang)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function createTemplate(
  key: string,
  variables: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin()

    if (!/^[a-z][a-z0-9_]{0,49}$/.test(key)) {
      return { ok: false, error: 'Key must be lowercase letters, numbers, and underscores only.' }
    }

    const db = adminClient()
    const { error } = await db.from('notification_templates').insert({
      template_key: key,
      lang:         'ar',
      subject:      '',
      title:        '',
      body_html:    '',
      body_text:    null,
      variables:    variables,
      is_active:    false,
      updated_by:   null,
    })

    if (error) {
      if (error.code === '23505') return { ok: false, error: 'A template with this key already exists.' }
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function generateWithAI(
  templateKey: string,
  variables: string[],
  instructions: string,
): Promise<{ ok: true; subject: string; title: string; body_html: string } | { ok: false; error: string }> {
  try {
    await requireAdmin()

    const client = getAnthropicClient()

    const systemPrompt = `You are an expert Arabic email copywriter for OGz Studios — a Saudi social media content production platform. You write professional, warm Arabic notification emails for brand clients.

Rules:
- All text must be in Arabic (Modern Standard Arabic, clear and professional)
- body_html must be a complete, self-contained HTML snippet with inline styles
- Use dir="rtl" lang="ar" on the root div, font-family: Tahoma, 'Segoe UI', sans-serif
- Keep emails concise (3–5 lines of body text)
- Include all template variables using {{variable_name}} syntax
- Follow the admin's design instructions precisely (colors, logo, tone, layout)
- Return ONLY valid JSON — no markdown, no explanation`

    const userPrompt = `Generate a notification email template for: "${templateKey.replace(/_/g, ' ')}"

Available variables: ${variables.length > 0 ? variables.map((v) => `{{${v}}}`).join(', ') : '(none)'}

Design instructions from admin:
${instructions.trim() || 'Use a header with OGz Studios logo text in color #f0a500, clean professional layout.'}

Return this exact JSON shape:
{
  "subject": "Arabic email subject line using variables if relevant",
  "title": "Short Arabic in-app notification title (max 80 chars) using variables",
  "body_html": "Full HTML email body with inline styles, RTL, following the design instructions"
}`

    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })

    const raw = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: { subject?: string; title?: string; body_html?: string }
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return { ok: false, error: 'AI returned invalid JSON — try again.' }
    }

    const subject   = String(parsed.subject ?? '').trim()
    const title     = String(parsed.title ?? '').trim()
    const body_html = String(parsed.body_html ?? '').trim()

    if (!subject || !title || !body_html) {
      return { ok: false, error: 'AI response was incomplete — try again.' }
    }

    return { ok: true, subject, title, body_html }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
const SAMPLE_VARS: Record<string, Record<string, string | number>> = {
  post_approved:                { brand_name: 'KFC', position: 3, month: 'مايو 2026' },
  post_rejected:                { brand_name: 'KFC', position: 3, reason: 'الصورة لا تتوافق مع هوية العلامة التجارية' },
  revision_ready:               { brand_name: 'KFC', position: 3, revision_number: 2 },
  calendar_delivered:           { brand_name: 'KFC', month: 'مايو 2026', post_count: 20 },
  calendar_pending_review:      { brand_name: 'KFC', month: 'يونيو 2026', calendar_url: 'https://app.ogzstudios.com/kfc/calendar' },
  calendar_approved:            { brand_name: 'KFC', month: 'يونيو 2026', calendar_url: 'https://app.ogzstudios.com/kfc/calendar/2026-06' },
  calendar_rejected:            { brand_name: 'KFC', month: 'يونيو 2026', reason: 'الصور لا تعكس هوية العلامة التجارية بشكل صحيح، يرجى مراجعة الألوان والنبرة العامة' },
  publish_success:              { position: 3, platform: 'Instagram', published_at: '12 مايو 2026، 9:00 ص' },
  publish_failed:               { position: 3, error: 'خطأ في الاتصال بـ Instagram API — انتهت مهلة الطلب' },
  branddna_correction_applied:  { brand_name: 'KFC', field_name: 'نبرة العلامة', new_value: 'رسمي ودافئ' },
  branddna_correction_rejected: { brand_name: 'KFC', field_name: 'موقع السعر', rejection_reason: 'القيمة غير ضمن الخيارات المسموح بها' },
  branddna_onboarding_complete: { brand_name: 'KFC', completeness_score: 78 },
  cost_ceiling_approaching:     { brand_name: 'KFC', spend_usd: '72.50', ceiling_usd: '100.00', spend_pct: '72', alert_at_pct: '70', cost_page_url: 'https://app.ogzstudios.com/admin/cost/kfc' },
  cost_ceiling_breached:        { brand_name: 'KFC', spend_usd: '105.20', ceiling_usd: '100.00', spend_pct: '105', action: 'تم إيقاف التوليد مؤقتاً', cost_page_url: 'https://app.ogzstudios.com/admin/cost/kfc' },
}

// ── Test send ─────────────────────────────────────────────────────────────────

/**
 * Sends a live test email to the requesting admin's own address.
 * Renders the current saved template (not draft) with sample variable values.
 */
export async function sendTestEmail(
  templateKey: string,
  lang: string,
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  try {
    const admin = await requireAdmin()
    const db = adminClient()

    // Fetch the saved (not draft) template
    const { data: tpl, error: tplErr } = await db
      .from('notification_templates')
      .select('subject, title, body_html, variables')
      .eq('template_key', templateKey)
      .eq('lang', lang)
      .maybeSingle()

    if (tplErr || !tpl) {
      return { ok: false, error: tplErr?.message ?? 'Template not found — save it first.' }
    }

    // Build sample values for all declared variables
    const declared: string[] = Array.isArray(tpl.variables) ? (tpl.variables as string[]) : []
    const sampleValues: Record<string, string | number> = {}
    for (const v of declared) {
      // Simple type inference from variable name patterns
      if (v.includes('count') || v.includes('score') || v === 'position' || v === 'revision_number') {
        sampleValues[v] = 42
      } else {
        sampleValues[v] = `[${v}]`
      }
    }

    // Render with sample values
    const rendered = renderAll(tpl, sampleValues)

    // Resolve admin email via auth admin API
    const { data: authData } = await db.auth.admin.getUserById(admin.id)
    const adminEmail = authData.user?.email
    if (!adminEmail) return { ok: false, error: 'Could not resolve your admin email address.' }

    // Send via Resend (no inbox row — this is a live test, not a real notification)
    const { data: email, error: sendErr } = await resendClient().emails.send({
      from:    resendFrom(),
      to:      adminEmail,
      subject: `[TEST] ${rendered.subject}`,
      html:    rendered.body_html,
    })

    if (sendErr) {
      // Resend errors are objects — extract a readable message
      const msg = (sendErr as { message?: string; name?: string }).message
        ?? (sendErr as { name?: string }).name
        ?? JSON.stringify(sendErr)
      return { ok: false, error: msg }
    }
    return { ok: true, messageId: email?.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Manual send ──────────────────────────────────────────────────────────────

/**
 * Sends a template email manually from the admin notifications UI.
 * Fetches the saved template, renders it with the provided variables,
 * and delivers to the given recipient email without inserting an inbox row
 * (this is a one-off admin-triggered send, not a system notification).
 */
export async function sendCustomEmail(params: {
  templateKey: string
  lang: string
  recipientEmail: string
  variables: Record<string, string>
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  try {
    await requireAdmin()
    const db = adminClient()

    const { templateKey, lang, recipientEmail, variables } = params

    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return { ok: false, error: 'Invalid recipient email address.' }
    }

    const { data: tpl, error: tplErr } = await db
      .from('notification_templates')
      .select('subject, title, body_html, variables, is_active')
      .eq('template_key', templateKey)
      .eq('lang', lang)
      .maybeSingle()

    if (tplErr || !tpl) {
      return { ok: false, error: tplErr?.message ?? 'Template not found — create and save it first.' }
    }

    if (!tpl.is_active) {
      return { ok: false, error: 'Template is disabled — enable it before sending.' }
    }

    const rendered = renderAll(tpl, variables)

    const { data: email, error: sendErr } = await resendClient().emails.send({
      from:    resendFrom(),
      to:      recipientEmail,
      subject: rendered.subject,
      html:    rendered.body_html,
    })

    if (sendErr) {
      const msg = (sendErr as { message?: string; name?: string }).message
        ?? (sendErr as { name?: string }).name
        ?? JSON.stringify(sendErr)
      return { ok: false, error: msg }
    }
    return { ok: true, messageId: email?.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Returns all brand profiles with their client email for the send-email picker.
 */
export async function getBrandsForEmailPicker(): Promise<{
  ok: true
  brands: { brand_id: string; brand_name_ar: string; client_slug: string; email: string | null }[]
} | { ok: false; error: string }> {
  try {
    await requireAdmin()
    const db = adminClient()

    const { data, error } = await db
      .from('brand_profiles')
      .select('brand_id, brand_name_ar, client_slug, auth_user_id')
      .order('brand_name_ar')

    if (error) return { ok: false, error: error.message }

    const brands: { brand_id: string; brand_name_ar: string; client_slug: string; email: string | null }[] = []
    for (const row of data ?? []) {
      let email: string | null = null
      try {
        if (row.auth_user_id) {
          const { data: u } = await db.auth.admin.getUserById(row.auth_user_id as string)
          email = u.user?.email ?? null
        }
      } catch { /* skip */ }
      brands.push({ brand_id: row.brand_id, brand_name_ar: row.brand_name_ar, client_slug: row.client_slug, email })
    }
    return { ok: true, brands }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Delivery log ──────────────────────────────────────────────────────────────

export interface DeliveryLogRow {
  notification_id: string
  template_key: string
  lang: string
  auth_user_id: string
  user_email: string | null
  rendered_subject: string
  resend_status: string
  resend_error: string | null
  resend_message_id: string | null
  retry_count: number
  sent_at: string | null
  created_at: string
}

export interface DeliveryLogFilters {
  templateKey?: string
  status?: string
  limit?: number
  offset?: number
}

/**
 * Returns paginated notification delivery log rows for the admin dashboard.
 * Joins with auth.users to show the recipient email.
 */
export async function getDeliveryLogs(
  filters: DeliveryLogFilters = {},
): Promise<{ ok: true; rows: DeliveryLogRow[]; total: number } | { ok: false; error: string }> {
  try {
    await requireAdmin()
    const db = adminClient()
    const { templateKey, status, limit = 50, offset = 0 } = filters

    let query = db
      .from('notifications')
      .select('notification_id, template_key, lang, auth_user_id, rendered_subject, resend_status, resend_error, resend_message_id, retry_count, sent_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (templateKey) query = query.eq('template_key', templateKey)
    if (status)      query = query.eq('resend_status', status)

    const { data, error, count } = await query
    if (error) return { ok: false, error: error.message }

    // Resolve user emails in a single batch
    const userIds = [...new Set((data ?? []).map((r) => r.auth_user_id))]
    const emailMap: Record<string, string> = {}
    for (const uid of userIds) {
      try {
        const { data: u } = await db.auth.admin.getUserById(uid)
        if (u.user?.email) emailMap[uid] = u.user.email
      } catch { /* skip */ }
    }

    const rows: DeliveryLogRow[] = (data ?? []).map((r) => ({
      notification_id:  r.notification_id,
      template_key:     r.template_key,
      lang:             r.lang,
      auth_user_id:     r.auth_user_id,
      user_email:       emailMap[r.auth_user_id] ?? null,
      rendered_subject: r.rendered_subject,
      resend_status:    r.resend_status,
      resend_error:     r.resend_error ?? null,
      resend_message_id: r.resend_message_id ?? null,
      retry_count:      r.retry_count ?? 0,
      sent_at:          r.sent_at ?? null,
      created_at:       r.created_at,
    }))

    return { ok: true, rows, total: count ?? 0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Re-attempts delivery for a single failed notification.
 * Looks up the original recipient email from auth.users and re-sends
 * the already-rendered content (does not re-render from template).
 */
export async function retryFailedNotification(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin()
    const db = adminClient()

    const { data: notif, error: fetchErr } = await db
      .from('notifications')
      .select('notification_id, auth_user_id, rendered_subject, rendered_body_html, resend_status, retry_count')
      .eq('notification_id', notificationId)
      .single()

    if (fetchErr || !notif) return { ok: false, error: fetchErr?.message ?? 'Notification not found.' }
    if (notif.resend_status === 'sent') return { ok: false, error: 'Already sent — no retry needed.' }

    const { data: authData } = await db.auth.admin.getUserById(notif.auth_user_id)
    const userEmail = authData.user?.email
    if (!userEmail) return { ok: false, error: 'Could not resolve recipient email address.' }

    const { data: email, error: sendErr } = await resendClient().emails.send({
      from:    resendFrom(),
      to:      userEmail,
      subject: notif.rendered_subject,
      html:    notif.rendered_body_html,
    })

    const errMsg = sendErr
      ? ((sendErr as { message?: string }).message ?? JSON.stringify(sendErr))
      : null

    await db
      .from('notifications')
      .update({
        resend_status:     sendErr ? 'failed' : 'sent',
        resend_message_id: email?.id ?? null,
        resend_error:      errMsg,
        sent_at:           sendErr ? null : new Date().toISOString(),
        retry_count:       (notif.retry_count ?? 0) + 1,
      })
      .eq('notification_id', notificationId)

    if (sendErr) return { ok: false, error: errMsg! }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
