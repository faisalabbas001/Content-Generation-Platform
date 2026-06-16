/**
 * Inbox queries — for reading notifications in the UI.
 *
 * These accept a Supabase client so callers control the auth scope:
 *   - serverComponentClient(cookies)  → RLS-scoped to the signed-in user
 *   - adminClient()                   → admin panel, read any brand's inbox
 *
 * Usage:
 *   import { getUnreadNotifications, markAllRead } from '@repo/email/inbox'
 */

import type { Db } from '@repo/db/client'
import type { Notification, NotificationTemplate } from './types'

// ── Inbox reads ───────────────────────────────────────────────────────────────

export async function getUnreadNotifications(
  db: Db,
  authUserId: string,
  limit = 20,
): Promise<Notification[]> {
  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('auth_user_id', authUserId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as unknown as Notification[]
}

export async function getAllNotifications(
  db: Db,
  authUserId: string,
  limit = 50,
): Promise<Notification[]> {
  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('auth_user_id', authUserId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as unknown as Notification[]
}

export async function getUnreadCount(db: Db, authUserId: string): Promise<number> {
  const { count, error } = await db
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('auth_user_id', authUserId)
    .is('read_at', null)

  if (error) throw error
  return count ?? 0
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markNotificationRead(
  db: Db,
  notificationId: string,
): Promise<void> {
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('notification_id', notificationId)
    .is('read_at', null) // idempotent: no-op if already read

  if (error) throw error
}

export async function markAllNotificationsRead(
  db: Db,
  authUserId: string,
): Promise<void> {
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('auth_user_id', authUserId)
    .is('read_at', null)

  if (error) throw error
}

// ── Admin: template management ────────────────────────────────────────────────

export async function getAllTemplates(db: Db): Promise<NotificationTemplate[]> {
  const { data, error } = await db
    .from('notification_templates')
    .select('*')
    .order('template_key')
    .order('lang')

  if (error) throw error
  return (data ?? []) as unknown as NotificationTemplate[]
}

export async function getTemplate(
  db: Db,
  templateKey: string,
  lang: string,
): Promise<NotificationTemplate | null> {
  const { data, error } = await db
    .from('notification_templates')
    .select('*')
    .eq('template_key', templateKey)
    .eq('lang', lang)
    .maybeSingle()

  if (error) throw error
  return data as unknown as NotificationTemplate | null
}

export async function updateTemplate(
  db: Db,
  templateKey: string,
  lang: string,
  patch: {
    subject?: string
    title?: string
    body_html?: string
    body_text?: string
    is_active?: boolean
  },
  updatedBy: string,
): Promise<void> {
  const { error } = await db
    .from('notification_templates')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    })
    .eq('template_key', templateKey)
    .eq('lang', lang)

  if (error) throw error
}
