import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getScoreCardBySlug } from '@/lib/scoring/db'
import { DIMENSION_LABELS } from '@/lib/scoring/types'
import type { ScoreDimension } from '@repo/db'

export const dynamic = 'force-dynamic'

export default async function AdminScorecardInspectorPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const full = await getScoreCardBySlug(slug)
  if (!full) notFound()

  const { card, dimensions, findings, actions, competitors } = full

  function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div className="flex items-start gap-4 py-2.5 border-b border-[var(--border)] last:border-0">
        <span className="text-xs text-[var(--fg-faint)] w-40 shrink-0">{label}</span>
        <span className="text-sm text-[var(--fg)]">{value ?? '—'}</span>
      </div>
    )
  }

  const tierBg: Record<string, string> = {
    high: 'bg-emerald-500/15 text-emerald-400',
    mid:  'bg-amber-500/15 text-amber-400',
    low:  'bg-orange-500/15 text-orange-400',
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
        <Link href="/admin/scorecards" className="hover:text-[var(--fg)] transition">Scorecards</Link>
        <span>/</span>
        <span className="text-[var(--fg)]">@{card.handle}</span>
      </div>

      {/* Hero */}
      <div className="flex items-start gap-6 bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-6">
        <div className="flex-shrink-0 w-20 h-20 rounded-2xl bg-[var(--surface-3)] flex items-center justify-center text-3xl font-bold" style={{ color: card.tier === 'high' ? '#10b981' : card.tier === 'mid' ? '#f59e0b' : '#f97316' }}>
          {card.overall_score}
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[var(--fg)]">{card.brand_name_en ?? `@${card.handle}`}</h1>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${tierBg[card.tier]}`}>{card.tier}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--fg-muted)]">{card.sector}</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">@{card.handle} · {card.followers_count?.toLocaleString()} followers · {card.posts_analyzed} posts</p>
          <p className="text-xs text-[var(--fg-faint)]">Scanned {new Date(card.scanned_at).toLocaleString('en-SA')} · Expires {new Date(card.expires_at).toLocaleDateString('en-SA')}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/score-cards/${card.share_slug}`} target="_blank" className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 transition">
            View Public Card →
          </Link>
        </div>
      </div>

      {/* Card metadata */}
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-4">Card Metadata</h2>
        <Row label="ID" value={<code className="text-xs font-mono text-[var(--fg-muted)]">{card.id}</code>} />
        <Row label="Share Slug" value={<code className="text-xs font-mono">{card.share_slug}</code>} />
        <Row label="Share Views" value={card.share_views} />
        <Row label="Share Count" value={card.share_count} />
        <Row label="Scan Tier" value={card.scan_tier} />
        <Row label="Score Status" value={card.score_status} />
        <Row label="Overall Score" value={<strong>{card.overall_score}/100</strong>} />
        <Row label="Score Tier" value={card.tier} />
        <Row label="Location" value={[card.location_city, card.location_neighborhood].filter(Boolean).join(', ') || null} />
        <Row label="Brand Name AR" value={card.brand_name_ar} />
        <Row label="Brand DNA ID" value={card.brand_dna_id ? <code className="text-xs font-mono">{card.brand_dna_id}</code> : null} />
      </div>

      {/* Dimension scores */}
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-4">Dimension Scores</h2>
        <div className="space-y-3">
          {dimensions.map(d => {
            const key = d.dimension as ScoreDimension
            const labels = DIMENSION_LABELS[key]
            const dc = d.score >= 70 ? '#10b981' : d.score >= 40 ? '#f59e0b' : '#f97316'
            return (
              <div key={d.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--fg)]">{labels?.en}</span>
                  <div className="flex items-center gap-3">
                    {d.benchmark && <span className="text-xs text-[var(--fg-faint)]">Benchmark: {d.benchmark}</span>}
                    <span className="font-mono font-bold" style={{ color: dc }}>{d.score}/100</span>
                    <span className="text-xs text-[var(--fg-faint)]">w={d.weight}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${d.score}%`, background: dc }} />
                </div>
                {/* Submetrics */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {Object.entries(d.submetrics ?? {}).map(([k, v]) => (
                    typeof v === 'number' || typeof v === 'string' ? (
                      <span key={k} className="text-xs font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-2 py-0.5 rounded">
                        {k}: {typeof v === 'number' ? Math.round(v * 100) / 100 : v}
                      </span>
                    ) : null
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Findings */}
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-4">Findings ({findings.length})</h2>
        <div className="space-y-3">
          {findings.map(f => (
            <div key={f.id} className={`px-4 py-3 rounded-xl border text-sm ${
              f.severity === 'high' ? 'border-red-500/20 bg-red-500/5'
              : f.severity === 'mid' ? 'border-amber-500/20 bg-amber-500/5'
              : 'border-[var(--border)]'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-[var(--fg-faint)]">{f.dimension}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  f.severity === 'high' ? 'bg-red-500/20 text-red-400'
                  : f.severity === 'mid' ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-[var(--surface-3)] text-[var(--fg-faint)]'
                }`}>{f.severity}</span>
              </div>
              <p className="text-[var(--fg)]">{f.finding_en}</p>
              <p className="text-[var(--fg-muted)] text-sm mt-0.5" dir="rtl">{f.finding_ar}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-4">Recommended Actions</h2>
        <div className="space-y-3">
          {actions.map(a => (
            <div key={a.id} className="flex items-center gap-4 px-4 py-3 bg-[var(--surface-3)] rounded-xl">
              <span className="text-xl">{a.icon_emoji ?? '✅'}</span>
              <div className="flex-1">
                <p className="text-sm text-[var(--fg)] font-medium">{a.action_label_en}</p>
                <p className="text-xs text-[var(--fg-muted)]">{a.dimension} · {a.workflow_id}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-emerald-400">+{a.estimated_lift} pts</p>
                <p className="text-xs text-[var(--fg-faint)]">{a.timeframe_weeks}w</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Competitors */}
      {competitors.length > 0 && (
        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-[var(--fg)] mb-4">Competitor Comparison</h2>
          <div className="space-y-2">
            {competitors.sort((a, b) => a.rank - b.rank).map(c => {
              const cc = c.competitor_score >= 70 ? '#10b981' : c.competitor_score >= 40 ? '#f59e0b' : '#f97316'
              return (
                <div key={c.id} className={`flex items-center gap-4 px-4 py-2.5 rounded-lg ${c.is_focal_brand ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/20' : 'bg-[var(--surface-3)]'}`}>
                  <span className="text-[var(--fg-faint)] text-xs w-4">{c.rank}</span>
                  <div className="flex-1">
                    <span className="text-sm text-[var(--fg)]">{c.competitor_name}</span>
                    {c.is_focal_brand && <span className="ml-2 text-xs text-[var(--accent)]">← Focal</span>}
                    <span className="text-xs text-[var(--fg-faint)] ml-2">@{c.competitor_handle}</span>
                  </div>
                  <span className="font-mono font-bold" style={{ color: cc }}>{c.competitor_score}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
