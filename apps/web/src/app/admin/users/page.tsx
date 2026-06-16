/**
 * /admin/users — administrator's view of every Supabase Auth user + their
 * owned brands.
 *
 * Joins:
 *   • auth.users (via supabase.auth.admin.listUsers)
 *   • brand_profiles.auth_user_id (SELECT scoped to user_ids)
 *
 * Filters (URL search params, server-side):
 *   ?q=...      — search email / full_name / brand name / slug / uuid
 *   ?status=... — active | banned | unconfirmed
 *   ?brand=...  — has-brand | no-brand
 */
import Link from 'next/link'
import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { Stat } from '@repo/ui/stat'
import { Users, CheckCircle2, AlertTriangle, Mail } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'
import { formatDate, tierLabel } from '@/lib/format'
import { FilterBar } from '../admin-widgets'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale, t } = await getServerT()
  const sp = await searchParams

  const statusFilter = sp.status as 'active' | 'banned' | 'unconfirmed' | undefined
  const hasBrandFilter = sp.brand === 'has-brand' ? true : sp.brand === 'no-brand' ? false : undefined

  const users = await adminQ.listAdminUsers({
    search: sp.q || undefined,
    status: statusFilter,
    hasBrand: hasBrandFilter,
  })

  // Roll up totals for the stat strip
  const totalUsers = users.length
  const activeUsers = users.filter((u) => u.email_confirmed_at && (!u.banned_until || new Date(u.banned_until) <= new Date())).length
  const bannedUsers = users.filter((u) => u.banned_until && new Date(u.banned_until) > new Date()).length
  const unconfirmedUsers = users.filter((u) => !u.email_confirmed_at).length
  const usersWithBrand = users.filter((u) => u.brands.length > 0).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Users"
        subtitle={`${totalUsers} total · ${activeUsers} active · ${usersWithBrand} with a brand`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total users" value={totalUsers} icon={<Users size={16} />} tone="info" />
        <Stat label="Active" value={activeUsers} icon={<CheckCircle2 size={16} />} tone="success" />
        <Stat label="Unconfirmed" value={unconfirmedUsers} icon={<Mail size={16} />} tone="warning" />
        <Stat label="Banned" value={bannedUsers} icon={<AlertTriangle size={16} />} tone={bannedUsers ? 'danger' : 'neutral'} />
      </div>

      <FilterBar
        filters={[
          { key: 'q',       placeholder: 'Search email, name, brand…', current: sp.q },
          { key: 'status',  placeholder: 'Status (any)', type: 'select', options: ['active', 'banned', 'unconfirmed'], current: sp.status },
          { key: 'brand',   placeholder: 'Brand state', type: 'select', options: ['has-brand', 'no-brand'], current: sp.brand },
        ]}
      />

      {users.length === 0 ? (
        <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-1) px-6 py-12 text-center text-sm text-(--fg-muted)">
          No users match these filters.
        </div>
      ) : (
        <DataTable
          rows={users}
          density="compact"
          columns={[
            { key: 'user', primaryOnMobile: true, header: 'User', render: (u) => {
              const initial = (u.full_name ?? u.email ?? '?').trim().slice(0, 1).toUpperCase()
              const banned = u.banned_until && new Date(u.banned_until) > new Date()
              return (
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-(--accent) to-(--accent)/60 font-display text-sm font-semibold text-(--accent-fg)">
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/users/${u.user_id}`} className="block font-medium text-(--fg) hover:text-(--accent) truncate">
                      {u.full_name ?? u.email ?? u.user_id.slice(0, 8) + '…'}
                    </Link>
                    <div className="truncate text-xs text-(--fg-faint)">{u.email ?? <span className="italic">no email</span>}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {banned && <Badge tone="danger" size="sm" dot>banned</Badge>}
                    {!u.email_confirmed_at && !banned && <Badge tone="warning" size="sm" dot>unconfirmed</Badge>}
                    {u.is_anonymous && <Badge tone="outline" size="sm">anon</Badge>}
                  </div>
                </div>
              )
            } },
            { key: 'brands', header: 'Brands', render: (u) => (
              u.brands.length === 0 ? (
                <span className="text-xs text-(--fg-faint)">—</span>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  {u.brands.slice(0, 3).map((b) => {
                    const name = locale === 'en' && b.brand_name_en ? b.brand_name_en : b.brand_name_ar
                    return (
                      <Link
                        key={b.brand_id}
                        href={`/admin/branddna/${b.brand_id}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 text-xs text-(--fg) hover:border-(--accent) hover:text-(--accent)"
                        title={`${b.client_slug} · ${b.sector} · completeness ${b.completeness_score}%`}
                      >
                        {b.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={b.logo_url} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover" />
                        ) : (
                          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-(--accent)" />
                        )}
                        <span className="truncate">{name}</span>
                      </Link>
                    )
                  })}
                  {u.brands.length > 3 && (
                    <span className="text-xs text-(--fg-muted)">+{u.brands.length - 3}</span>
                  )}
                </div>
              )
            ) },
            { key: 'tier', header: 'Tier', render: (u) => {
              const tier = u.brands[0]?.tier ?? null
              if (!tier) return <span className="text-xs text-(--fg-faint)">—</span>
              return <Badge tone={tier === 'free' ? 'outline' : 'accent'} size="sm">{tierLabel(tier, t)}</Badge>
            } },
            { key: 'completeness', header: 'Best completeness', render: (u) => {
              if (u.brands.length === 0) return <span className="text-xs text-(--fg-faint)">—</span>
              const best = Math.max(...u.brands.map((b) => b.completeness_score ?? 0))
              const tone = best >= 70 ? 'success' : best >= 40 ? 'warning' : 'danger'
              return <Badge tone={tone} size="sm">{best}%</Badge>
            }, align: 'end' },
            { key: 'last', header: 'Last sign-in', hideOnMobile: true, render: (u) => (
              u.last_sign_in_at
                ? <span className="text-xs text-(--fg-muted)">{formatDate(u.last_sign_in_at, locale)}</span>
                : <span className="text-xs text-(--fg-faint)">never</span>
            ), align: 'end' },
            { key: 'created', header: 'Signed up', hideOnMobile: true, render: (u) => <span className="text-xs text-(--fg-muted)">{formatDate(u.created_at, locale)}</span>, align: 'end' },
            { key: 'open', header: '', render: (u) => (
              <Link href={`/admin/users/${u.user_id}`} className="text-xs text-(--accent) hover:underline">Manage →</Link>
            ), align: 'end' },
          ]}
        />
      )}
    </div>
  )
}
