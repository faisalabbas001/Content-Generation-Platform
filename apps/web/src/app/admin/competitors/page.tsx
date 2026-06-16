/**
 * /admin/competitors — Layer 5 Competitive Intelligence overview
 * Shows all competitor accounts across all brands + recent snapshots + alerts
 */
import { adminClient } from '@repo/db'
import { requireAdmin } from '@/lib/admin-session'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'

export const dynamic = 'force-dynamic'

export default async function AdminCompetitorsPage() {
  await requireAdmin()
  const db = adminClient()

  const [competitorRows, alertRows, snapshotRows] = await Promise.all([
    db.from('competitor_accounts')
      .select('competitor_id, brand_id, handle_instagram, display_name, tier, is_active, last_extracted_at, brand_profiles(brand_name_ar, client_slug)')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(100)
      .then((r) => r.data ?? []),
    db.from('competitor_alerts')
      .select('alert_id, brand_id, alert_type, severity, title, body, is_read, created_at, brand_profiles(brand_name_ar, client_slug)')
      .order('created_at', { ascending: false })
      .limit(50)
      .then((r) => r.data ?? []),
    db.from('competitor_snapshots')
      .select('snapshot_id, competitor_id, brand_id, snapshot_type, extracted_at, posting_frequency_per_week, estimated_engagement_rate, platforms_active')
      .order('extracted_at', { ascending: false })
      .limit(20)
      .then((r) => r.data ?? []),
  ])

  const unreadAlerts = (alertRows as Array<{ is_read: boolean }>).filter((a) => !a.is_read).length

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Layer 5"
        title="Competitive Intelligence"
        subtitle={`${competitorRows.length} tracked competitors · ${unreadAlerts} unread alerts`}
      />

      {/* ── Alert feed ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Alerts</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {alertRows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-(--fg-muted)">No alerts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-(--border)">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Brand</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Type</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Severity</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Title</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Date</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Read</th>
                </tr>
              </thead>
              <tbody>
                {(alertRows as Array<Record<string, unknown>>).map((a) => {
                  const bp = a.brand_profiles as { brand_name_ar: string; client_slug: string } | null
                  return (
                    <tr key={String(a.alert_id)} className="border-b border-(--border) last:border-0 hover:bg-(--bg-subtle)">
                      <td className="px-4 py-3">
                        <span dir="rtl" className="font-medium">{bp?.brand_name_ar ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral">{String(a.alert_type)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={a.severity === 'urgent' ? 'danger' : a.severity === 'warning' ? 'warning' : 'neutral'}>
                          {String(a.severity)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate">{String(a.title)}</td>
                      <td className="px-4 py-3 text-(--fg-muted)">
                        {new Date(String(a.created_at)).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-4 py-3">
                        {a.is_read ? (
                          <span className="text-(--fg-muted) text-xs">read</span>
                        ) : (
                          <Badge tone="warning">unread</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* ── Competitor accounts ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Tracked Competitors</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {competitorRows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-(--fg-muted)">No competitors tracked yet. Clients add them during onboarding.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-(--border)">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Brand</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Competitor</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Instagram</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Tier</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Last Extracted</th>
                </tr>
              </thead>
              <tbody>
                {(competitorRows as Array<Record<string, unknown>>).map((c) => {
                  const bp = c.brand_profiles as { brand_name_ar: string; client_slug: string } | null
                  const lastEx = c.last_extracted_at ? new Date(String(c.last_extracted_at)).toLocaleDateString('en-GB') : 'Never'
                  return (
                    <tr key={String(c.competitor_id)} className="border-b border-(--border) last:border-0 hover:bg-(--bg-subtle)">
                      <td className="px-4 py-3">
                        <span dir="rtl" className="font-medium">{bp?.brand_name_ar ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 font-medium">{String(c.display_name ?? c.handle_instagram ?? '—')}</td>
                      <td className="px-4 py-3 text-(--fg-muted)">
                        {c.handle_instagram ? `@${String(c.handle_instagram)}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={c.tier === 'deep' ? 'success' : 'neutral'}>{String(c.tier)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-(--fg-muted)">{lastEx}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* ── Recent snapshots ────────────────────────────────────────── */}
      {snapshotRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Extractions</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-(--border)">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Competitor ID</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Type</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Posts/wk</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Eng. Rate</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Platforms</th>
                  <th className="px-4 py-3 font-medium text-(--fg-muted)">Extracted</th>
                </tr>
              </thead>
              <tbody>
                {(snapshotRows as Array<Record<string, unknown>>).map((s) => (
                  <tr key={String(s.snapshot_id)} className="border-b border-(--border) last:border-0 hover:bg-(--bg-subtle)">
                    <td className="px-4 py-3 text-(--fg-muted) font-mono text-xs">{String(s.competitor_id).slice(0, 8)}…</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{String(s.snapshot_type)}</Badge></td>
                    <td className="px-4 py-3">{s.posting_frequency_per_week != null ? String(s.posting_frequency_per_week) : '—'}</td>
                    <td className="px-4 py-3">{s.estimated_engagement_rate ? `${(Number(s.estimated_engagement_rate) * 100).toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-3 text-(--fg-muted)">{Array.isArray(s.platforms_active) ? (s.platforms_active as string[]).join(', ') : '—'}</td>
                    <td className="px-4 py-3 text-(--fg-muted)">{new Date(String(s.extracted_at)).toLocaleDateString('en-GB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
