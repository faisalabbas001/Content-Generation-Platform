import Link from 'next/link'
import { Bell } from '@repo/ui/icons'
import { adminClient } from '@repo/db/client'
import { getT, type Locale } from '@repo/i18n'

interface Props {
  slug: string
  authUserId: string
  locale: Locale
}

/**
 * Unread count for the header bell badge.
 *
 * The query is intentionally NOT wrapped in `unstable_cache` — that helper
 * relies on Node's CJS module loader and breaks under Next.js 16 + Turbopack
 * dev. The COUNT itself is covered by `idx_notifications_unread` (partial
 * index on auth_user_id WHERE read_at IS NULL) so it returns in <5ms.
 */
export async function NotificationBell({ slug, authUserId, locale }: Props) {
  const { count } = await adminClient()
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('auth_user_id', authUserId)
    .is('read_at', null)

  const unread = count ?? 0

  const t = getT(locale)
  const label = unread > 0
    ? t('notifications.bellLabelUnread').replace('{{count}}', String(unread))
    : t('notifications.bellLabel')

  return (
    <Link
      href={`/${slug}/notifications`}
      className="relative flex h-8 w-8 items-center justify-center rounded-(--r-md) text-(--fg-muted) hover:bg-(--surface-2) hover:text-(--fg) transition-colors focus-visible:outline-2 focus-visible:outline-(--accent)"
      aria-label={label}
      title={label}
    >
      <Bell size={18} aria-hidden="true" />

      {unread > 0 && (
        <>
          {/* Pulse ring — draws the eye without being loud */}
          <span
            className="absolute -top-0.5 -right-0.5 h-4 min-w-4 animate-ping rounded-full bg-red-500 opacity-40"
            aria-hidden="true"
          />
          {/* Solid badge on top */}
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-bold text-white leading-none ring-2 ring-(--bg)"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        </>
      )}
    </Link>
  )
}

export function NotificationBellFallback({ slug, locale }: { slug: string; locale: Locale }) {
  const t = getT(locale)
  return (
    <Link
      href={`/${slug}/notifications`}
      className="relative flex h-8 w-8 items-center justify-center rounded-(--r-md) text-(--fg-muted) hover:bg-(--surface-2) hover:text-(--fg) transition-colors"
      aria-label={t('notifications.bellLabel')}
    >
      <Bell size={18} aria-hidden="true" />
    </Link>
  )
}
