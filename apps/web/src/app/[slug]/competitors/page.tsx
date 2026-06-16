/**
 * /[slug]/competitors — Layer 5 Competitive Intelligence for brand owners
 * Shows their tracked competitors, alerts, and extracted snapshots
 */
import { notFound } from 'next/navigation'
import { adminClient } from '@repo/db'
import { getBrandForCurrentUser } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { MarkAlertsReadButton } from './mark-alerts-read-button'

export const dynamic = 'force-dynamic'

export default async function CompetitorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const brandHeader = await getBrandForCurrentUser(slug)
  if (!brandHeader) notFound()

  const db = adminClient()
  const [competitors, alerts, snapshots] = await Promise.all([
    db.from('competitor_accounts')
      .select('competitor_id, handle_instagram, display_name, tier, last_extracted_at, is_active')
      .eq('brand_id', brandHeader.brand_id as string)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .then((r) => r.data ?? []),
    db.from('competitor_alerts')
      .select('alert_id, alert_type, severity, title, body, suggested_content_direction, is_read, is_actioned, created_at')
      .eq('brand_id', brandHeader.brand_id as string)
      .order('created_at', { ascending: false })
      .limit(20)
      .then((r) => r.data ?? []),
    db.from('competitor_snapshots')
      .select('snapshot_id, competitor_id, snapshot_type, extracted_at, posting_frequency_per_week, estimated_engagement_rate, content_category_distribution, top_performing_tones, gaps_identified, threats_identified')
      .eq('brand_id', brandHeader.brand_id as string)
      .order('extracted_at', { ascending: false })
      .limit(10)
      .then((r) => r.data ?? []),
  ])

  const unreadCount = (alerts as Array<{ is_read: boolean }>).filter((a) => !a.is_read).length

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="ذكاء تنافسي"
        title="المنافسون"
        subtitle={`${(competitors as unknown[]).length} منافس مُتابَع${unreadCount > 0 ? ` · ${unreadCount} تنبيه جديد` : ''}`}
        action={<LinkButton href={`/${slug}/settings`}>إدارة المنافسين</LinkButton>}
      />

      {/* ── Unread alerts ───────────────────────────────────────────── */}
      {(alerts as Array<Record<string, unknown>>).filter((a) => !a.is_read).length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-(--fg-muted) uppercase tracking-wide">تنبيهات جديدة</h3>
            <MarkAlertsReadButton brandId={brandHeader.brand_id as string} />
          </div>
          {(alerts as Array<Record<string, unknown>>).filter((a) => !a.is_read).map((alert) => (
            <div key={String(alert.alert_id)} className={`rounded-xl border px-5 py-4 flex items-start gap-3 ${
              alert.severity === 'urgent' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
            }`}>
              <span className="text-base mt-0.5">
                {alert.alert_type === 'gap_opportunity' ? '💡' : alert.severity === 'urgent' ? '🚨' : '📊'}
              </span>
              <div className="flex-1">
                <p className={`font-semibold text-sm ${alert.severity === 'urgent' ? 'text-red-900' : 'text-blue-900'}`} dir="rtl">
                  {String(alert.title)}
                </p>
                <p className={`text-sm mt-1 ${alert.severity === 'urgent' ? 'text-red-800' : 'text-blue-800'}`} dir="rtl">
                  {String(alert.body)}
                </p>
                {!!alert.suggested_content_direction && (
                  <p className="text-xs text-blue-700 mt-2 italic" dir="rtl">
                    💬 {String(alert.suggested_content_direction)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tracked competitors ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>المنافسون المُتابَعون</CardTitle>
        </CardHeader>
        <CardBody>
          {(competitors as unknown[]).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-(--fg-muted)" dir="rtl">
                لم تتم إضافة منافسين بعد. أضف حسابات المنافسين خلال الإعداد الأولي لتتبع أدائهم.
              </p>
              <div className="mt-4">
                <LinkButton href={`/${slug}/settings`}>إضافة منافسين</LinkButton>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {(competitors as Array<Record<string, unknown>>).map((c) => {
                const latestSnapshot = (snapshots as Array<Record<string, unknown>>).find(
                  (s) => s.competitor_id === c.competitor_id
                )
                return (
                  <div key={String(c.competitor_id)} className="flex items-center justify-between rounded-lg border border-(--border) px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">{String(c.display_name ?? c.handle_instagram)}</p>
                      {!!c.handle_instagram && (
                        <p className="text-xs text-(--fg-muted)">@{String(c.handle_instagram)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {!!latestSnapshot && (
                        <div className="text-right">
                          {!!latestSnapshot.posting_frequency_per_week && (
                            <p className="text-xs text-(--fg-muted)">{Number(latestSnapshot.posting_frequency_per_week).toFixed(1)} posts/wk</p>
                          )}
                          {!!latestSnapshot.estimated_engagement_rate && (
                            <p className="text-xs text-(--fg-muted)">{(Number(latestSnapshot.estimated_engagement_rate) * 100).toFixed(1)}% eng.</p>
                          )}
                        </div>
                      )}
                      <Badge tone={c.tier === 'deep' ? 'success' : 'neutral'}>
                        {c.last_extracted_at ? new Date(String(c.last_extracted_at)).toLocaleDateString('en-GB') : 'لم يُستخرج'}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Latest insights from deep snapshots ─────────────────────── */}
      {(snapshots as Array<Record<string, unknown>>).filter((s) => Array.isArray(s.gaps_identified) && (s.gaps_identified as unknown[]).length > 0).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>الفرص التنافسية</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              {(snapshots as Array<Record<string, unknown>>)
                .filter((s) => Array.isArray(s.gaps_identified) && (s.gaps_identified as unknown[]).length > 0)
                .slice(0, 3)
                .map((s) => (
                  <div key={String(s.snapshot_id)}>
                    <p className="text-xs font-medium text-(--fg-muted) mb-2">ما لا يفعله المنافس:</p>
                    <ul className="space-y-1">
                      {(s.gaps_identified as string[]).map((gap, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm" dir="rtl">
                          <span className="text-green-500 mt-0.5">✓</span>
                          {gap}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
