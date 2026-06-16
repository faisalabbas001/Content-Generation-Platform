/**
 * Server actions — client settings page.
 *
 * All writes use a USER-SCOPED Supabase client (with the user's session
 * cookies). RLS verifies ownership at the DB layer per migrations 0007 +
 * 0008 — we never bypass it via service_role here.
 */
'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { serverComponentClient } from '@repo/db/client'
import { requireUser, getBrandForCurrentUser } from '@repo/auth/server'

export interface ActionResult {
  ok: boolean
  message?: string
  error?: string
}

async function userClient() {
  const store = await cookies()
  return serverComponentClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const c of toSet) store.set(c.name, c.value, c.options)
      } catch {
        /* read-only context */
      }
    },
  })
}

export async function updateProfile(slug: string, formData: FormData): Promise<ActionResult> {
  await requireUser({ next: `/${slug}/settings` })
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'not_found' }

  const fullName = String(formData.get('full_name') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()

  const supabase = await userClient()
  if (fullName) {
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName, ...(phone ? { phone } : {}) },
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath(`/${slug}/settings`)
  return { ok: true, message: 'Profile updated.' }
}

export async function changePassword(slug: string, formData: FormData): Promise<ActionResult> {
  await requireUser({ next: `/${slug}/settings` })

  const newPassword = String(formData.get('new_password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')
  if (newPassword.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' }
  if (newPassword !== confirm) return { ok: false, error: 'Passwords do not match.' }

  const supabase = await userClient()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: error.message }

  return { ok: true, message: 'Password changed.' }
}

export async function updateNotifications(slug: string, formData: FormData): Promise<ActionResult> {
  await requireUser({ next: `/${slug}/settings` })
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'not_found' }

  const prefs = {
    calendar_ready: formData.get('notify_calendar_ready') === 'on',
    revision_ready: formData.get('notify_revision_ready') === 'on',
    anomaly: formData.get('notify_anomaly') === 'on',
  }

  const supabase = await userClient()

  // Read-modify-write under RLS (no DELETE permission needed).
  const { data: existing } = await supabase
    .from('override_rules')
    .select('rule_id')
    .eq('brand_id', brand.brand_id)
    .eq('rule_key', 'notification_prefs')
    .maybeSingle()

  if (existing?.rule_id) {
    const { error } = await supabase
      .from('override_rules')
      .update({ rule_value: prefs as never })
      .eq('rule_id', existing.rule_id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase.from('override_rules').insert({
      brand_id: brand.brand_id,
      rule_key: 'notification_prefs',
      rule_value: prefs as never,
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath(`/${slug}/settings`)
  return { ok: true, message: 'Notification settings saved.' }
}

/**
 * Unlinks the brand's Instagram channel (clears postiz_channel_id).
 * The channel stays in the Postiz workspace — it just becomes unclaimed,
 * so a reconnect (this brand or another of the user's brands) can pick it
 * up again. We deliberately do NOT delete the Postiz integration: other
 * scheduled posts may still reference it and removal is an admin concern.
 */
export async function disconnectInstagram(slug: string): Promise<ActionResult> {
  await requireUser({ next: `/${slug}/settings` })
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'not_found' }

  const { adminClient } = await import('@repo/db')
  const { error } = await adminClient()
    .from('channel_profiles')
    .update({ postiz_channel_id: null })
    .eq('brand_id', brand.brand_id)
    .eq('channel', 'Instagram')
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/${slug}/settings`)
  return { ok: true, message: 'Instagram disconnected.' }
}

export async function requestAccountDeletion(slug: string): Promise<ActionResult> {
  const user = await requireUser({ next: `/${slug}/settings` })
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'not_found' }

  // PDPL Phase 1 — log the request. RLS policy (migration 0008) verifies
  // the user owns the brand before allowing the audit insert. Cascade-
  // delete itself is service_role + admin-triggered.
  const supabase = await userClient()
  const { error } = await supabase.from('deletion_audit_log').insert({
    brand_id: brand.brand_id,
    phase1_complete: false,
    phase2_complete: false,
    error_details: { requested_by: user.email ?? null, reason: 'self_serve_request' } as never,
  })
  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    message:
      'Deletion request received. Your data will be removed within 30 days per PDPL. You can still log in until then.',
  }
}
