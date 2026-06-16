import Link from 'next/link'
import { listScoreCards } from '@/lib/scoring/db'
import type { ScoreCard } from '@repo/db'

export const dynamic = 'force-dynamic'

export default async function AdminScoreCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; sector?: string }>
}) {
  const sp     = await searchParams
  const page   = Number(sp.page ?? '1')
  const sector = sp.sector ?? ''

  const { cards, total } = await listScoreCards({ page, limit: 25, sector: sector || undefined })
  const totalPages = Math.ceil(total / 25)

  function tierBadge(tier: string) {
    const colors: Record<string, string> = {
      high: 'bg-emerald-500/15 text-emerald-400',
      mid:  'bg-amber-500/15 text-amber-400',
      low:  'bg-orange-500/15 text-orange-400',
    }
    return colors[tier] ?? 'bg-white/10 text-white/50'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--fg)]">Brand Scorecards</h1>
          <p className="text-sm text-[var(--fg-muted)] mt-0.5">{total} scans total</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sector filter */}
          {['', 'fnb', 'beauty', 'retail'].map(s => (
            <Link
              key={s}
              href={`?sector=${s}&page=1`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                sector === s
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'bg-[var(--surface-3)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
              }`}
            >
              {s === '' ? 'All' : s === 'fnb' ? 'F&B' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Handle</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Brand</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Sector</th>
              <th className="text-right px-4 py-3 text-[var(--fg-faint)] font-medium">Score</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Tier</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Posts</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Followers</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Scan Status</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Scanned</th>
              <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-medium">Expires</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {cards.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-12 text-[var(--fg-faint)] text-sm">
                  No scorecards yet. Scan a brand at <code className="text-xs">/score-cards</code>.
                </td>
              </tr>
            )}
            {cards.map((card: ScoreCard) => (
              <tr key={card.id} className="hover:bg-[var(--surface-2)] transition">
                <td className="px-4 py-3 font-mono text-xs text-[var(--fg-muted)]">@{card.handle}</td>
                <td className="px-4 py-3 text-[var(--fg)]">{card.brand_name_en ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--fg-muted)]">
                    {card.sector}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold text-[var(--fg)]">{card.overall_score}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${tierBadge(card.tier)}`}>
                    {card.tier}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--fg-muted)] text-xs">{card.posts_analyzed}</td>
                <td className="px-4 py-3 text-[var(--fg-muted)] text-xs">
                  {card.followers_count?.toLocaleString() ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    card.score_status === 'complete'     ? 'bg-[var(--success)]/10 text-[var(--success)]'
                    : card.score_status === 'stale'      ? 'bg-amber-500/10 text-amber-400'
                    : card.score_status === 'preliminary' ? 'bg-blue-500/10 text-blue-400'
                    : 'bg-red-500/10 text-red-400'
                  }`}>
                    {card.score_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--fg-muted)] text-xs whitespace-nowrap">
                  {new Date(card.scanned_at).toLocaleDateString('en-SA')}
                </td>
                <td className="px-4 py-3 text-[var(--fg-faint)] text-xs whitespace-nowrap">
                  {new Date(card.expires_at) < new Date()
                    ? <span className="text-red-400">Expired</span>
                    : new Date(card.expires_at).toLocaleDateString('en-SA')}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/scorecards/${card.share_slug}`}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    Inspect →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--fg-faint)]">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`?sector=${sector}&page=${page - 1}`} className="px-3 py-1.5 rounded bg-[var(--surface-3)] text-[var(--fg-muted)] hover:text-[var(--fg)] transition text-xs">
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link href={`?sector=${sector}&page=${page + 1}`} className="px-3 py-1.5 rounded bg-[var(--surface-3)] text-[var(--fg-muted)] hover:text-[var(--fg)] transition text-xs">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
