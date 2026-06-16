/**
 * /admin/users/[user_id] — single-user inspector + management actions.
 *
 * Shows:
 *   - Auth metadata (email, full_name, signup, last sign-in, confirmation, ban)
 *   - Every brand_profiles row owned by this auth_user_id, with quick stats
 *     and a deep-link to /admin/branddna/<brand_id>.
 *   - Suspend / unsuspend / resend invite / delete actions.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { getServerT } from '@/lib/i18n-server'
import { formatDate, tierLabel } from '@/lib/format'
import { UserActionPanel } from './actions-panel'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ user_id: string }>
}) {
  const { user_id } = await params
  const { locale, t } = await getServerT()
  const user = await adminQ.getAdminUser(user_id)
  if (!user) notFound()

  const banned = !!(user.banned_until && new Date(user.banned_until) > new Date())
  const initial = (user.full_name ?? user.email ?? '?').trim().slice(0, 1).toUpperCase()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Users"
        title={user.full_name ?? user.email ?? user_id.slice(0, 8) + '…'}
        subtitle={user.email ?? 'No email on file'}
      />

      {/* Identity strip */}
      <Card>
        <CardBody className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-(--accent) to-(--accent)/60 font-display text-xl font-semibold text-(--accent-fg)">
            {initial}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {banned && <Badge tone="danger" dot>banned until {formatDate(user.banned_until!, locale)}</Badge>}
              {!banned && user.email_confirmed_at && <Badge tone="success" dot>active</Badge>}
              {!user.email_confirmed_at && <Badge tone="warning" dot>email unconfirmed</Badge>}
              {user.is_anonymous && <Badge tone="outline">anonymous</Badge>}
              <Badge tone="info" size="sm">{user.brands.length} brand{user.brands.length === 1 ? '' : 's'}</Badge>
            </div>
            <div className="grid gap-x-6 gap-y-1.5 text-xs text-(--fg-muted) sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0 break-all">User ID: <span className="font-mono text-(--fg-subtle)">{user.user_id}</span></div>
              <div>Signed up: <span className="text-(--fg-subtle)">{formatDate(user.created_at, locale)}</span></div>
              <div>Last sign-in: <span className="text-(--fg-subtle)">{user.last_sign_in_at ? formatDate(user.last_sign_in_at, locale) : 'never'}</span></div>
              <div>Email confirmed: <span className="text-(--fg-subtle)">{user.email_confirmed_at ? formatDate(user.email_confirmed_at, locale) : '—'}</span></div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Brands */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Brands owned ({user.brands.length})</CardTitle>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {user.brands.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-(--fg-muted)">
              This user has not created any brands yet.
            </div>
          ) : (
            <ul className="divide-y divide-(--border-subtle)">
              {user.brands.map((b) => {
                const name = locale === 'en' && b.brand_name_en ? b.brand_name_en : b.brand_name_ar
                const tone = b.completeness_score >= 70 ? 'success' : b.completeness_score >= 40 ? 'warning' : 'danger'
                return (
                  <li key={b.brand_id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                    <div className="flex items-center gap-3 sm:contents">
                    {b.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.logo_url} alt={name} className="h-10 w-10 shrink-0 rounded-(--r-md) border border-(--border-subtle) object-contain" />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) font-display text-sm text-(--fg-muted)">
                        {name.slice(0, 1)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <Link href={`/admin/branddna/${b.brand_id}`} className="font-medium text-(--fg) hover:text-(--accent) truncate">
                          {name}
                        </Link>
                        <span className="text-xs text-(--fg-faint) truncate">{b.client_slug}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge tone="outline" size="sm">{b.sector}</Badge>
                        <Badge tone={b.tier === 'free' ? 'outline' : 'accent'} size="sm">{tierLabel(b.tier, t)}</Badge>
                        <Badge tone={tone} size="sm">{b.completeness_score}%</Badge>
                        {b.onboarding_status && b.onboarding_status !== 'complete' && (
                          <Badge tone="warning" size="sm">{b.onboarding_status}</Badge>
                        )}
                        <span className="text-(--fg-muted)">created {formatDate(b.created_at, locale)}</span>
                      </div>
                    </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                      <LinkButton href={`/admin/branddna/${b.brand_id}`} size="sm" variant="ghost">
                        BrandDNA →
                      </LinkButton>
                      <LinkButton href={`/admin/clients/${b.brand_id}`} size="sm" variant="ghost">
                        Client view →
                      </LinkButton>
                      <LinkButton href={`/${b.client_slug}/snapshot`} size="sm" variant="outline">
                        Open as user →
                      </LinkButton>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Action panel (client component) */}
      <UserActionPanel
        userId={user.user_id}
        userEmail={user.email ?? ''}
        currentlyBanned={banned}
        hasBrands={user.brands.length > 0}
      />
    </div>
  )
}
