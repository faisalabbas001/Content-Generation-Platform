import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'
import {
  LayoutDashboard, Sparkles, Brain, Camera, Calendar, Zap,
  CalendarRange, Wallet, User, Settings, LifeBuoy, Rocket,
} from '@repo/ui/icons'
import { Badge } from '@repo/ui/badge'
import { Sidebar, type SidebarItem } from '@repo/ui/sidebar'
import { AdminMobileNav } from '@repo/ui/admin/admin-mobile-nav'
import { requireBrandAccess } from '@repo/auth/server'
import { LocaleToggle } from '@/components/locale-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { LogoutButton } from '@/components/auth/logout-button'
import { NotificationBell, NotificationBellFallback } from '@/components/notification-bell'
import { getServerT } from '@/lib/i18n-server'
import { getTheme } from '@/lib/theme-server'
import { tierLabel } from '@/lib/format'

const NAV_KEYS = ['dashboard', 'strategy', 'brand-insight', 'snapshot', 'calendar', 'on-demand', 'calendars', 'cost', 'profile', 'settings', 'support', 'upgrade'] as const

// Icon per nav key — keeps the sidebar visually scannable like the OGz design.
const NAV_ICONS: Record<(typeof NAV_KEYS)[number], ReactNode> = {
  'dashboard':     <LayoutDashboard size={16} />,
  'strategy':      <Sparkles size={16} />,
  'brand-insight': <Brain size={16} />,
  'snapshot':      <Camera size={16} />,
  'calendar':      <Calendar size={16} />,
  'on-demand':     <Zap size={16} />,
  'calendars':     <CalendarRange size={16} />,
  'cost':          <Wallet size={16} />,
  'profile':       <User size={16} />,
  'settings':      <Settings size={16} />,
  'support':       <LifeBuoy size={16} />,
  'upgrade':       <Rocket size={16} />,
}

// Statuses that mean onboarding is fully done — brand is usable.
// Mirrors the logic in /onboarding-start/page.tsx exactly.
const ONBOARDING_COMPLETE_STATUSES = new Set(['complete'])

// Statuses where A03 pipeline is actively running — user should see /processing.
const PIPELINE_RUNNING_STATUSES = new Set([
  'submitted', 'scraping', 'dna_building', 'memory_writing',
])

// Routes exempt from the onboarding gate even when onboarding is NOT done.
// NOTE: 'processing' is NOT here — it is handled conditionally below
// (only pipeline-running statuses may access it, not extraction statuses).
// - onboarding: deprecated redirect page — must still resolve
// - auth:       OAuth callback
const ALWAYS_EXEMPT_PATHS = new Set(['onboarding', 'auth'])

export default async function ClientLayout({
  children,
  params,
  // Next.js 16 App Router passes `searchParams` and sibling segment as slot via
  // the layout, but the child path is not directly in layout params. We derive
  // it from the request URL in the headers instead.
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { locale, t } = await getServerT()
  const theme = await getTheme()
  // Enforces: signed-in + this user owns this slug. Redirects otherwise.
  const { brand } = await requireBrandAccess(slug)

  // proxy.ts injects x-pathname on every client-app request.
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''

  // ── Onboarding gate ──────────────────────────────────────────────────────
  // If the brand has not completed onboarding, block every /[slug]/* route
  // except the few that are legitimately accessible mid-flow.
  //
  // Only TWO conditions mean "truly done":
  //   1. onboarding_status = 'complete'   — Memory Controller wrote the final
  //                                         status after A03 successfully ran
  //   2. total_calendars_generated > 0    — brand has already generated a
  //                                         calendar (legacy/seed brands)
  //
  // completeness_score is intentionally NOT used here — a partial score (e.g.
  // 10 or 42) is written during extraction and does NOT mean onboarding is done.
  // Using it caused extraction_pending / submitted brands to bypass this gate.
  const bx = brand as unknown as Record<string, unknown>
  const onboardingStatus   = (bx.onboarding_status   as string  | null) ?? null
  const calendarsGenerated = (bx.total_calendars_generated as number | null) ?? 0

  const isOnboardingDone =
    (onboardingStatus !== null && ONBOARDING_COMPLETE_STATUSES.has(onboardingStatus)) ||
    calendarsGenerated > 0

  if (!isOnboardingDone) {
    // "/burgerizerkw-p5nc/brand-insight" → "brand-insight"
    // "/burgerizerkw-p5nc/processing"    → "processing"
    const firstSegment = pathname.replace(/^\/[^/]+\/?/, '').split('/')[0] ?? ''

    // Always-exempt paths — these must work regardless of onboarding state
    if (ALWAYS_EXEMPT_PATHS.has(firstSegment)) {
      // fall through and render the layout (deprecated /onboarding, /auth)
    }
    // /processing is ONLY allowed when the A03 pipeline is actually running.
    // extraction_pending / extraction_done / etc. must NOT access it —
    // those statuses mean the user is still in the onboarding stepper.
    else if (firstSegment === 'processing') {
      if (!onboardingStatus || !PIPELINE_RUNNING_STATUSES.has(onboardingStatus)) {
        redirect('/onboarding-start')
      }
      // Pipeline is running → allow /processing, fall through to render
    }
    // Every other route is blocked until onboarding is complete.
    // Route to the right place based on where in the flow the brand is.
    else {
      if (onboardingStatus && PIPELINE_RUNNING_STATUSES.has(onboardingStatus)) {
        // Step 3 submitted, A03 running → show progress screen
        redirect(`/${slug}/processing`)
      }
      // extraction_pending / extraction_done / extraction_unavailable / null / unknown
      // → send back to /onboarding-start (stepper auto-resumes at the correct step)
      redirect('/onboarding-start')
    }
  }
  // ── End onboarding gate ──────────────────────────────────────────────────

  // When onboarding is complete the full layout renders below.
  // When onboarding is NOT done but the path is exempt (processing/auth/onboarding),
  // we fall through here and render a stripped layout — NO nav links so the user
  // cannot navigate away to dashboard or other locked pages.
  const showFullNav = isOnboardingDone

  const displayName = locale === 'en' && brand.brand_name_en ? brand.brand_name_en : brand.brand_name_ar

  // Brand chip — reused in sidebar header + mobile nav header.
  const brandChip = (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--r-md) text-white font-display text-base font-semibold"
        style={{
          background: `linear-gradient(135deg, ${brand.primary_color_hex ?? '#2bee4f'}, ${brand.primary_color_hex ?? '#2bee4f'}aa)`,
        }}
      >
        {displayName.slice(0, 1)}
      </div>
      <div className="min-w-0">
        <div className="truncate font-display text-sm font-semibold text-(--fg)">
          {displayName}
        </div>
        <div className="truncate text-[11px] text-(--fg-muted)">
          {brand.sector} · {brand.city_primary}
        </div>
      </div>
    </div>
  )

  // Build sidebar items with brand-insight attention badge.
  // requireBrandAccess returns SELECT * so all fields are available.
  const b = brand as unknown as Record<string, unknown>
  const filled = (field: string) => {
    const v = b[field]
    if (v === null || v === undefined || v === '') return false
    if (typeof v === 'boolean') return true
    if (Array.isArray(v)) return (v as unknown[]).length > 0
    return true
  }
  // All catalogue fields — required + optional (mirrors insight-form.tsx)
  const allInsightFields = [
    // Required
    'goal_phase', 'permission_level', 'primary_channel', 'primary_kpi_type',
    'brave_safe_default', 'way_of_speaking', 'comfort_on_camera',
    'content_preferences', 'products_list', 'founding_story',
    'caption_style', 'formality_level', 'humor_tolerance', 'posting_rhythm',
    // Optional
    'cultural_tension_owned', 'owner_values', 'brand_goals', 'cust_desc',
    'cust_quote', 'respected_brands', 'respected_why', 'vision_text',
    'hero_why', 'metric', 'communication_style', 'physical_appearance_notes',
    'price_nums', 'sub_sector', 'founded_year',
    'tagline', 'caption_ex', 'custom_restriction', 'music_link',
  ]
  const insightMissingCount = allInsightFields.filter((f) => !filled(f)).length

  const navItems: SidebarItem[] = NAV_KEYS.map((k) => {
    const href = `/${slug}/${k}`
    const item: SidebarItem = {
      href,
      label: t(`clientNav.${k}` as const),
      icon: NAV_ICONS[k],
    }
    if (k === 'brand-insight' && insightMissingCount > 0) {
      item.badge = { count: insightMissingCount, tone: 'warning' }
    }
    return item
  })

  // Active item — match the current pathname against the item href.
  const current = navItems.find((i) => pathname === i.href || pathname.startsWith(i.href + '/'))?.href

  const topRight = (
    <div className="flex items-center gap-2">
      {brand.auth_user_id && (
        <Suspense fallback={<NotificationBellFallback slug={slug} locale={locale} />}>
          <NotificationBell slug={slug} authUserId={brand.auth_user_id} locale={locale} />
        </Suspense>
      )}
      <ThemeToggle current={theme} />
      <LocaleToggle current={locale} />
      <Badge tone={brand.tier === 'free' ? 'outline' : 'accent'} dot>
        {tierLabel(brand.tier, t)}
      </Badge>
      <LogoutButton label={t('marketingNav.logout')} />
    </div>
  )

  // ── Stripped layout (onboarding not done, path is exempt) ───────────────
  // No nav so the user cannot escape to locked pages.
  if (!showFullNav) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-(--border-subtle) bg-(--bg)/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/" className="text-xs text-(--fg-muted) hover:text-(--fg) transition-colors">
                ← {t('common.back')}
              </Link>
              <span className="hidden h-4 w-px bg-(--border-default) sm:block" />
              {brandChip}
            </div>
            {topRight}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </div>
    )
  }

  // ── Full sidebar layout ─────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        linkAs={Link as unknown as React.ElementType}
        items={navItems}
        current={current}
        brand={brandChip}
        footer={
          <Link href="/" className="block text-xs text-(--fg-muted) hover:text-(--fg) transition-colors">
            ← {t('common.back')}
          </Link>
        }
      />

      <AdminMobileNav items={navItems} brand={brandChip} current={current} pathname={pathname} />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 hidden border-b border-(--border-subtle) bg-(--bg)/80 backdrop-blur-xl lg:block">
          <div className="flex items-center justify-end gap-4 px-8 py-3">
            {topRight}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  )
}
