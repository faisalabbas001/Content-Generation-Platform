import Link from 'next/link'
import { brandsQ, occasionsQ, isDbConfigured } from '@repo/db'
import { Card, CardBody } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { PageHeader } from '@repo/ui/page-header'
import { Stat } from '@repo/ui/stat'
import { Section } from '@repo/ui/section'
import { Code } from '@repo/ui/code'
import { SetupBanner } from '@repo/ui/setup-banner'
import { LocaleToggle } from '@/components/locale-toggle'
import { getServerT } from '@/lib/i18n-server'
import { tierLabel } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const { locale, t } = await getServerT()
  const dbReady = isDbConfigured()
  const [brands, occasions] = await Promise.all([
    brandsQ.getAllBrands().catch(() => []),
    occasionsQ.getUpcomingOccasions().catch(() => []),
  ])

  const totalCalendars = brands.reduce((n, b) => n + b.total_calendars_generated, 0)
  const avgCompleteness = brands.length
    ? Math.round(brands.reduce((n, b) => n + b.completeness_score, 0) / brands.length)
    : 0

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <PageHeader
        eyebrow={t('common.phaseLabel')}
        title={t('landing.title')}
        subtitle={t('landing.subtitle')}
        action={
          <div className="flex items-center gap-2">
            <LocaleToggle current={locale} />
          </div>
        }
      />

      <SetupBanner
        show={!dbReady}
        title={t('common.setupBannerTitle')}
        body={
          <>
            {t('common.setupBannerBody').split('{cmd}').map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && <Code>pnpm db:setup</Code>}
              </span>
            ))}
          </>
        }
        hint={t('common.setupBannerHint')}
      />

      <Section>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="oc-mount oc-stagger-1">
            <Stat label={t('landing.stats.activeBrands')} value={brands.length} helper={t('landing.stats.demoData')} tone="accent" />
          </div>
          <div className="oc-mount oc-stagger-2">
            <Stat label={t('landing.stats.calendarsDelivered')} value={totalCalendars} helper={t('landing.stats.acrossAllBrands')} />
          </div>
          <div className="oc-mount oc-stagger-3">
            <Stat label={t('landing.stats.averageCompleteness')} value={`${avgCompleteness}%`} helper={t('landing.stats.brandDnaScore')} tone="info" />
          </div>
        </div>
      </Section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Section title={t('landing.brandsSection.title')} description={t('landing.brandsSection.subtitle')}>
          <Card>
            <CardBody className="p-0">
              {brands.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-(--fg-muted)">
                  {t('landing.brandsSection.noBrands').split('{cmd}').map((part, i, arr) => (
                    <span key={i}>{part}{i < arr.length - 1 && <Code>pnpm db:setup</Code>}</span>
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-(--border-subtle)">
                  {brands.map((b, i) => (
                    <li key={b.brand_id} className={`oc-mount oc-stagger-${Math.min(i + 1, 4)}`}>
                      <Link
                        href={`/${b.client_slug}/snapshot`}
                        className="group flex items-center gap-4 px-6 py-4 transition-colors duration-(--d-fast) ease-out hover:bg-(--surface-3)"
                      >
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-(--r-md) text-white font-display text-lg font-semibold"
                          style={{
                            background: `linear-gradient(135deg, ${b.primary_color_hex ?? '#10b981'}, ${b.primary_color_hex ?? '#10b981'}aa)`,
                          }}
                        >
                          {(locale === 'en' && b.brand_name_en ? b.brand_name_en : b.brand_name_ar).slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-display text-base font-semibold tracking-tight text-(--fg)">
                            {locale === 'en' && b.brand_name_en ? b.brand_name_en : b.brand_name_ar}
                          </div>
                          <div className="mt-0.5 text-xs text-(--fg-muted)">
                            {b.sector} · {b.city_primary} · {b.arabic_dialect}
                          </div>
                        </div>
                        <div className="hidden sm:flex shrink-0 items-center gap-2">
                          <Badge tone={b.tier === 'free' ? 'outline' : 'accent'}>{tierLabel(b.tier, t)}</Badge>
                          <span className="text-xs text-(--fg-muted)">{b.completeness_score}%</span>
                        </div>
                        <span className="text-(--fg-faint) transition-colors group-hover:text-(--accent)">{locale === 'ar' ? '←' : '→'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </Section>

        <Section title={t('landing.occasionsSection.title')} description={t('landing.occasionsSection.subtitle')}>
          <Card>
            <CardBody className="p-0">
              {occasions.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-(--fg-muted)">{t('common.noData')}</div>
              ) : (
                <ul className="divide-y divide-(--border-subtle)">
                  {occasions.slice(0, 6).map((o) => (
                    <li key={o.occasion_id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="font-medium text-(--fg)">{locale === 'en' && o.occasion_name_en ? o.occasion_name_en : o.occasion_name_ar}</div>
                        <div className="text-xs text-(--fg-muted)">{locale === 'en' ? o.occasion_name_ar : o.occasion_name_en}</div>
                      </div>
                      <div className="text-end">
                        <div className="font-mono text-xs text-(--fg-subtle)">{o.gregorian_date}</div>
                        <Badge tone={o.priority === 'Critical' ? 'danger' : 'outline'} size="sm" className="mt-1">
                          {o.priority}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </Section>
      </div>

      <footer className="mt-14 flex items-center justify-between border-t border-(--border-subtle) pt-6 text-xs text-(--fg-faint)">
        <span>{t('common.demoFooter')}</span>
        <span>{t('common.demoData')}</span>
      </footer>
    </main>
  )
}
