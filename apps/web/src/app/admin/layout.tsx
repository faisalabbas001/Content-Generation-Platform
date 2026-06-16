import Link from 'next/link'
import { Sidebar, type SidebarItem } from '@repo/ui/sidebar'
import { AdminMobileNav } from '@repo/ui/admin/admin-mobile-nav'
import { Badge } from '@repo/ui/badge'
import { LocaleToggle } from '@/components/locale-toggle'
import { AdminLogoutButton } from '@/components/auth/admin-logout-button'
import { requireAdmin } from '@/lib/admin-session'
import { getServerT } from '@/lib/i18n-server'
import { AdminCopilotWidget } from './_admin-copilot-widget'
import { adminQ } from '@repo/db'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  const { locale, t } = await getServerT()

  // Fetch open anomaly + QA counts for nav badges (non-blocking — fallback to 0 on error)
  const [anomalyResult, qaRows, releaseCals] = await Promise.all([
    adminQ.getAnomalies(200, { resolved: false }).catch(() => ({ rows: [], total: 0 })),
    adminQ.getQaQueue(200).catch(() => []),
    adminQ.getCalendarsForRelease(50).catch(() => []),
  ])
  const criticalCount = anomalyResult.rows.filter(r => r.severity === 'critical' || r.severity === 'error').length
  const openAnomalyCount = anomalyResult.total
  const pendingQaCount = qaRows.filter(r => r.status === 'pending').length + releaseCals.length

  const ITEMS: SidebarItem[] = [
    { group: t('adminNav.groupAdmin'),  href: '/admin',                       label: t('adminNav.overview') },
    { group: t('adminNav.groupAdmin'),  href: '/admin/users',                 label: 'Users' },
    { group: t('adminNav.groupAdmin'),  href: '/admin/clients',               label: t('adminNav.clients') },
    { group: t('adminNav.groupAdmin'),  href: '/admin/cost',                  label: t('adminNav.cost') },
    { group: t('adminNav.groupAdmin'),  href: '/admin/anomalies',             label: t('adminNav.anomalies'),
      badge: openAnomalyCount > 0 ? { count: openAnomalyCount, tone: criticalCount > 0 ? 'danger' : 'warning' } : undefined },
    { group: t('adminNav.groupOps'),    href: '/admin/qa',                    label: 'QA & Content Release',
      badge: pendingQaCount > 0 ? { count: pendingQaCount, tone: 'warning' } : undefined },
    { group: t('adminNav.groupOps'),    href: '/admin/notifications',         label: t('adminNav.notifications') },
    { group: t('adminNav.groupOps'),    href: '/admin/notifications/logs',    label: 'Delivery Log' },
    { group: t('adminNav.groupOps'),    href: '/admin/chains',                label: 'Chain Library' },
    { group: t('adminNav.groupOps'),    href: '/admin/routing',               label: t('adminNav.routing') },
    { group: t('adminNav.groupOps'),    href: '/admin/flows',                 label: t('adminNav.flows') },
    { group: t('adminNav.groupOps'),    href: '/admin/maintenance',           label: 'Maintenance (D02)' },
    { group: t('adminNav.groupOps'),    href: '/admin/upgrade',               label: 'Upgrade Readiness (A05)' },
    { group: t('adminNav.groupMemory'), href: '/admin/branddna',              label: t('adminNav.branddna') },
    { group: t('adminNav.groupMemory'), href: '/admin/negative-patterns',     label: 'Global Blocklist' },
    { group: t('adminNav.groupMemory'), href: '/admin/compliance',            label: 'Gesture Blocks' },
    { group: t('adminNav.groupMemory'), href: '/admin/baselines',             label: t('adminNav.baselines') },
    { group: t('adminNav.groupMemory'), href: '/admin/occasions',             label: t('adminNav.occasions') },
    { group: t('adminNav.groupMemory'), href: '/admin/audit',                 label: t('adminNav.audit') },
    { group: t('adminNav.groupMemory'), href: '/admin/performance',           label: t('adminNav.performance') },
    { group: t('adminNav.groupOps'),    href: '/admin/scorecards',            label: 'Brand Scorecards' },
    { group: t('adminNav.groupSystem'), href: '/admin/settings',              label: t('adminNav.settings') },
  ]

  const brand = (
    <>
      <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-(--r-md) bg-(--accent) font-display text-lg font-bold text-(--accent-fg)">
        O
      </span>
      <div>
        <div className="font-display text-sm font-semibold tracking-tight text-(--fg)">{t('common.appName')}</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-(--fg-faint)">{t('adminNav.header')}</div>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        linkAs={Link as unknown as React.ElementType}
        items={ITEMS}
        brand={<div className="flex items-center gap-2.5">{brand}</div>}
        footer={
          <div className="space-y-2">
            <Link href="/" className="block text-xs text-(--fg-muted) hover:text-(--fg)">
              {locale === 'ar' ? '← ' : '← '}{t('common.backToHome')}
            </Link>
            <div className="flex items-center justify-between text-[11px] text-(--fg-faint)">
              <span>{t('common.phase1')}</span>
              <Badge tone="success" size="sm" dot>{t('common.online')}</Badge>
            </div>
          </div>
        }
      />

      <AdminMobileNav items={ITEMS} brand={brand} />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 hidden border-b border-(--border-subtle) bg-(--bg)/80 backdrop-blur-xl lg:block">
          <div className="flex items-center justify-between gap-4 px-8 py-3.5">
            <div className="text-xs text-(--fg-muted)">{t('common.internalAdmin')}</div>
            <div className="flex items-center gap-2">
              <LocaleToggle current={locale} />
              <Badge tone="outline" size="sm">{t('common.devEnv')}</Badge>
              <AdminLogoutButton label={t('adminAuth.logout')} pendingLabel={t('adminAuth.loggingOut')} />
            </div>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</main>
      </div>

      <AdminCopilotWidget
        texts={{
          placeholder:           t('copilotChat.placeholder'),
          scopeManagement:       t('copilotChat.scopeManagement'),
          scopeTech:             t('copilotChat.scopeTech'),
          scopeProduction:       t('copilotChat.scopeProduction'),
          introManagement:       t('copilotChat.introManagement'),
          introTech:             t('copilotChat.introTech'),
          introProduction:       t('copilotChat.introProduction'),
          navManagement:         t('copilotChat.navManagement'),
          navTech:               t('copilotChat.navTech'),
          navProduction:         t('copilotChat.navProduction'),
          suggestionsManagementA: t('copilotChat.suggestions.managementA'),
          suggestionsManagementB: t('copilotChat.suggestions.managementB'),
          suggestionsManagementC: t('copilotChat.suggestions.managementC'),
          suggestionsTechA:       t('copilotChat.suggestions.techA'),
          suggestionsTechB:       t('copilotChat.suggestions.techB'),
          suggestionsTechC:       t('copilotChat.suggestions.techC'),
          suggestionsProductionA: t('copilotChat.suggestions.productionA'),
          suggestionsProductionB: t('copilotChat.suggestions.productionB'),
          suggestionsProductionC: t('copilotChat.suggestions.productionC'),
          statusOnline:           t('copilotChat.statusOnline'),
          subtitleInternal:       t('copilotChat.subtitleInternal'),
          newThread:              t('copilotChat.newThread'),
          thinking:               t('copilotChat.thinking'),
          sessionExpired:         t('copilotChat.sessionExpired'),
        }}
      />
    </div>
  )
}
