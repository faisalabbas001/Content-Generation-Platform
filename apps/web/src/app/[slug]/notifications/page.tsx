import Link from 'next/link'
import { requireBrandAccess } from '@repo/auth/server'
import { adminClient } from '@repo/db/client'
import { Bell, CheckCircle2, XCircle, Calendar, RefreshCw, Send, Zap } from '@repo/ui/icons'
import { Card } from '@repo/ui/card'
import { PageHeader } from '@repo/ui/page-header'
import { getServerT } from '@/lib/i18n-server'
import { MarkAllReadButton } from './mark-all-read-button'
import { NotificationRow } from './notification-row'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

interface NotificationRowDb {
  notification_id: string
  lang: string
  rendered_title: string
  read_at: string | null
  created_at: string
  post_id: string | null
  calendar_id: string | null
  template_key: string | null
}

// Filter tab definitions — each maps to a set of template keys
const FILTER_TABS = [
  { key: 'all',      labelAr: 'الكل',     labelEn: 'All' },
  { key: 'calendar', labelAr: 'التقويم',  labelEn: 'Calendar' },
  { key: 'posts',    labelAr: 'المنشورات', labelEn: 'Posts' },
  { key: 'system',   labelAr: 'النظام',   labelEn: 'System' },
] as const

const FILTER_KEYS: Record<string, string[]> = {
  calendar: ['calendar_delivered', 'calendar_approved', 'calendar_pending_review', 'calendar_rejected'],
  posts:    ['post_approved', 'post_rejected', 'revision_ready', 'publish_success', 'publish_failed'],
  system:   ['branddna_correction_applied', 'branddna_correction_rejected', 'branddna_onboarding_complete', 'cost_ceiling_approaching', 'cost_ceiling_breached'],
}

function buildDeepLink(slug: string, row: NotificationRowDb): string | null {
  if (row.post_id)     return `/${slug}/calendar?post=${row.post_id}`
  if (row.calendar_id) return `/${slug}/calendar`
  return null
}

function getDateGroup(dateStr: string, locale: string): string {
  const now  = new Date()
  const date = new Date(dateStr)
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000)

  if (locale === 'ar') {
    if (diffDays === 0) return 'اليوم'
    if (diffDays === 1) return 'أمس'
    if (diffDays <  7) return 'هذا الأسبوع'
    if (diffDays < 30) return 'هذا الشهر'
    return 'أقدم'
  }
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays <  7) return 'This week'
  if (diffDays < 30) return 'This month'
  return 'Earlier'
}

// Summary icon map for the empty-state category tiles
const CATEGORY_ICONS = [
  { Icon: Calendar,    color: '#10b981', labelAr: 'تسليم التقويمات',   labelEn: 'Calendar delivery'   },
  { Icon: CheckCircle2, color: '#22c55e', labelAr: 'موافقات المنشورات',  labelEn: 'Post approvals'       },
  { Icon: XCircle,     color: '#f43f5e', labelAr: 'رفض المحتوى',        labelEn: 'Content rejections'  },
  { Icon: RefreshCw,   color: '#38bdf8', labelAr: 'جاهز للمراجعة',      labelEn: 'Revision ready'      },
  { Icon: Send,        color: '#22c55e', labelAr: 'نشر ناجح',           labelEn: 'Published'           },
  { Icon: Zap,         color: '#f59e0b', labelAr: 'تنبيهات التكلفة',    labelEn: 'Cost alerts'         },
]

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params:        Promise<{ slug: string }>
  searchParams?: Promise<{ page?: string; filter?: string }>
}) {
  const { slug }           = await params
  const { locale, t }      = await getServerT()
  const { brand }          = await requireBrandAccess(slug)
  const sp                 = (await searchParams) ?? {}
  const page               = Math.max(1, Number(sp.page ?? '1') || 1)
  const filter             = (sp.filter ?? 'all') as keyof typeof FILTER_KEYS | 'all'

  if (!brand.auth_user_id) return null

  const db        = adminClient()
  const from      = (page - 1) * PAGE_SIZE
  const to        = from + PAGE_SIZE - 1

  // Build query — apply template_key filter when not 'all'
  const filterKeys = filter !== 'all' ? FILTER_KEYS[filter] : null

  const baseQuery = db
    .from('notifications')
    .select('notification_id,lang,rendered_title,read_at,created_at,post_id,calendar_id,template_key', { count: 'exact' })
    .eq('auth_user_id', brand.auth_user_id)
    .order('created_at', { ascending: false })

  const [{ data, count }, { count: unreadCount }] = await Promise.all([
    (filterKeys
      ? baseQuery.in('template_key', filterKeys)
      : baseQuery
    ).range(from, to),
    db
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('auth_user_id', brand.auth_user_id)
      .is('read_at', null),
  ])

  const items      = (data ?? []) as NotificationRowDb[]
  const totalCount = count ?? 0
  const unread     = unreadCount ?? 0
  const hasMore    = totalCount > page * PAGE_SIZE
  const dateLocale = locale === 'ar' ? 'ar-SA' : 'en-US'

  // Group notifications by date bucket
  const groups: { label: string; items: NotificationRowDb[] }[] = []
  for (const item of items) {
    const label = getDateGroup(item.created_at, locale)
    const last  = groups[groups.length - 1]
    if (last && last.label === label) {
      last.items.push(item)
    } else {
      groups.push({ label, items: [item] })
    }
  }

  const subtitle = unread > 0
    ? t('notifications.subtitleUnread').replace('{{count}}', String(unread))
    : t('notifications.subtitleClear')

  const buildHref = (f: string, p = 1) => {
    const q = new URLSearchParams()
    if (f !== 'all') q.set('filter', f)
    if (p > 1) q.set('page', String(p))
    const qs = q.toString()
    return `/${slug}/notifications${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('notifications.eyebrow')}
        title={t('notifications.title')}
        subtitle={subtitle}
        action={
          unread > 0 ? (
            <MarkAllReadButton slug={slug} label={t('notifications.markAllRead')} />
          ) : undefined
        }
      />

      {/* Filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        {FILTER_TABS.map((tab) => {
          const isActive = filter === tab.key
          const label = locale === 'ar' ? tab.labelAr : tab.labelEn
          return (
            <Link
              key={tab.key}
              href={buildHref(tab.key)}
              className={[
                'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all',
                isActive
                  ? 'bg-(--accent) text-white shadow-sm'
                  : 'bg-(--surface-2) text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)',
              ].join(' ')}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {items.length === 0 ? (
        /* Empty state */
        <Card>
          <div className="flex flex-col items-center gap-6 py-16 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--surface-2)">
              <Bell size={28} className="text-(--fg-muted)" aria-hidden="true" />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <p className="text-sm font-semibold text-(--fg)">{t('notifications.empty')}</p>
              <p className="text-xs text-(--fg-muted) leading-relaxed">
                {t('notifications.emptyHelper')}
              </p>
            </div>
            {/* Category preview tiles */}
            <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
              {CATEGORY_ICONS.map(({ Icon, color, labelAr, labelEn }) => (
                <div
                  key={labelEn}
                  className="flex flex-col items-center gap-1.5 rounded-xl bg-(--surface-2) px-2 py-3"
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: `${color}20` }}
                  >
                    <Icon size={14} style={{ color }} />
                  </div>
                  <span className="text-[10px] font-medium text-(--fg-muted) leading-tight text-center">
                    {locale === 'ar' ? labelAr : labelEn}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href={`/${slug}/dashboard`}
              className="inline-flex h-8 items-center justify-center rounded-(--r-md) border border-(--border-default) bg-(--surface-3) px-3 text-xs font-medium text-(--fg) hover:bg-(--surface-4) transition-colors"
            >
              {t('notifications.emptyCta')}
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.label}>
              {/* Date group header */}
              <div className="mb-1 flex items-center gap-2 px-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-(--fg-faint)">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-(--border-subtle)" />
                <span className="text-[10px] text-(--fg-faint)">{group.items.length}</span>
              </div>

              <Card>
                <ul
                  role="list"
                  aria-label={group.label}
                  className="divide-y divide-(--border-subtle)"
                >
                  {group.items.map((n) => (
                    <NotificationRow
                      key={n.notification_id}
                      notificationId={n.notification_id}
                      slug={slug}
                      lang={n.lang}
                      isUnread={!n.read_at}
                      renderedTitle={n.rendered_title}
                      createdAt={n.created_at}
                      deepLink={buildDeepLink(slug, n)}
                      dateLocale={dateLocale}
                      templateKey={n.template_key}
                    />
                  ))}
                </ul>
              </Card>
            </div>
          ))}

          {/* Pagination */}
          {(hasMore || page > 1) && (
            <nav
              className="flex items-center justify-between gap-2 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1) px-4 py-2.5"
              aria-label="Pagination"
            >
              {page > 1 ? (
                <Link
                  href={buildHref(filter, page - 1)}
                  className="flex items-center gap-1.5 text-xs font-medium text-(--fg-muted) hover:text-(--fg) transition-colors"
                >
                  {locale === 'ar' ? '← الأحدث' : '← Newer'}
                </Link>
              ) : <span />}

              <span className="text-xs text-(--fg-faint)">
                {page} / {Math.ceil(totalCount / PAGE_SIZE)}
              </span>

              {hasMore ? (
                <Link
                  href={buildHref(filter, page + 1)}
                  className="flex items-center gap-1.5 text-xs font-medium text-(--fg-muted) hover:text-(--fg) transition-colors"
                >
                  {t('notifications.loadMore')} {locale === 'ar' ? '←' : '→'}
                </Link>
              ) : <span />}
            </nav>
          )}
        </div>
      )}
    </div>
  )
}
