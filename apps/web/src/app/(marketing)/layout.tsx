import Link from 'next/link'
import { MarketingHeader, type MarketingHeaderLink } from '@repo/ui/client/marketing-header'
import { MarketingFooter } from '@repo/ui/client/marketing-footer'
import { LinkButton } from '@repo/ui/button'
import { LocaleToggle } from '@/components/locale-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { LogoutButton } from '@/components/auth/logout-button'
import { getCurrentUser, getFirstBrandForCurrentUser } from '@repo/auth/server'
import { getServerT } from '@/lib/i18n-server'
import { getTheme } from '@/lib/theme-server'

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { locale, t } = await getServerT()
  const theme = await getTheme()
  const user = await getCurrentUser()
  // Uses the user-scoped client + RLS — no service-role bypass.
  const firstBrand = user ? await getFirstBrandForCurrentUser() : null
  const dashboardHref = user
    ? firstBrand?.client_slug
      ? `/${firstBrand.client_slug}/dashboard`
      : '/onboarding-start'
    : null

  const nav: MarketingHeaderLink[] = [
    { href: '/#features',  label: t('marketingNav.features') },
    { href: '/pricing',    label: t('marketingNav.pricing') },
    { href: '/about',      label: t('marketingNav.about') },
    { href: '/score-cards', label: t('marketingNav.scoreCard') },
  ]

  return (
    <>
      <MarketingHeader
        brand={
          <Link href="/" className="flex items-center" aria-label={t('common.appName')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/ogz-logo-dark-DSFb1E81.png"
              alt={t('common.appName')}
              className="h-12 w-auto select-none sm:h-14"
              draggable={false}
            />
          </Link>
        }
        nav={nav}
        cta={
          <>
            <ThemeToggle current={theme} />
            <LocaleToggle current={locale} />
            {user && dashboardHref ? (
              <>
                <LinkButton href={dashboardHref} variant="primary" size="sm">
                  {t('marketingNav.dashboard')}
                </LinkButton>
                <LogoutButton label={t('marketingNav.logout')} variant="ghost" size="sm" />
              </>
            ) : (
              <>
                <LinkButton href="/login" variant="ghost" size="sm">
                  {t('marketingNav.login')}
                </LinkButton>
                <LinkButton href="/signup" variant="primary" size="sm">
                  {t('marketingNav.signup')}
                </LinkButton>
              </>
            )}
          </>
        }
      />
      {children}
      <MarketingFooter
        copyright={t('marketingFooter.copyright')}
        subnote={t('marketingFooter.vatNote')}
        badges={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-(--border-default) bg-(--surface-2) px-3 py-1">
              {t('marketingFooter.verifiedMaroof')}
              <span className="font-medium text-(--accent)">{t('marketingFooter.maroofBadge')}</span>
            </span>
            <span className="text-(--fg-faint)">{t('marketingFooter.madeIn')}</span>
          </>
        }
      />
    </>
  )
}
