'use server'

import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db/client'
import { requireUser } from '@repo/auth/server'

/**
 * Mark all the CURRENT user's notifications as read.
 * Authorization is enforced server-side via `requireUser()` — the caller
 * cannot pass an arbitrary auth_user_id.
 */
export async function markAllRead(slug: string) {
  const user = await requireUser()
  await adminClient()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('auth_user_id', user.id)
    .is('read_at', null)
  revalidatePath(`/${slug}/notifications`)
}

/**
 * Mark a single notification as read. The `.eq('auth_user_id', user.id)`
 * filter is the safety rail — even though we use adminClient, the row only
 * updates if the caller owns it.
 */
export async function markOneRead(notificationId: string, slug: string) {
  const user = await requireUser()
  await adminClient()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('notification_id', notificationId)
    .eq('auth_user_id', user.id)
    .is('read_at', null)
  revalidatePath(`/${slug}/notifications`)
}
