import Link from 'next/link'
import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'
import { formatDate } from '@/lib/format'
import { ResolveAnomalyButton, BulkResolveAnomaliesButton, FilterBar } from '../admin-widgets'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

// ── Flow label map ─────────────────────────────────────────────────────────────
const FLOW_LABEL: Record<string, string> = {
  'N8N-A01': 'Batch Calendar',
  'N8N-A02': 'On-Demand Post',
  'N8N-A03': 'Onboarding',
  'N8N-A04': 'Brand Correction',
  'N8N-A05': 'Upgrade Readiness',
  'N8N-A06': 'Extraction',
  'N8N-B03': 'Revision',
  'N8N-S03': 'Anomaly Router',
  'N8N-V01': 'Visuals',
}

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'outline'> = {
  critical: 'danger',
  error:    'danger',
  warning:  'warning',
  info:     'info',
  INFO:     'info',
}

export default async function AnomaliesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale, t } = await getServerT()
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const filters = {
    severity:     sp.severity || undefined,
    anomaly_type: sp.type || undefined,
    brand_id:     sp.brand_id || undefined,
    resolved:     sp.state === 'resolved' ? true : sp.state === 'open' ? false : undefined,
  }

  const { rows, total } = await adminQ.getAnomalies(PAGE_SIZE, filters, offset)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const openCount = rows.filter((r) => !r.resolved).length

  // Build filter query string (without page) for pagination links
  const filterParams = [
    sp.severity && `severity=${sp.severity}`,
    sp.type     && `type=${encodeURIComponent(sp.type)}`,
    sp.state    && `state=${sp.state}`,
    sp.brand_id && `brand_id=${sp.brand_id}`,
  ].filter(Boolean).join('&')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('adminAnomalies.eyebrow')}
        title={t('adminAnomalies.title')}
        subtitle={t('adminAnomalies.subtitle')}
        action={openCount > 0 ? <BulkResolveAnomaliesButton /> : null}
      />

      <FilterBar
        clearHref="/admin/anomalies"
        filters={[
          { key: 'severity', placeholder: 'Severity (all)', type: 'select', options: ['critical', 'error', 'warning', 'info'], current: sp.severity },
          { key: 'type',     placeholder: 'Type (e.g. ceo_call_failed)', current: sp.type },
          { key: 'state',    placeholder: 'State (all)', type: 'select', options: ['open', 'resolved'], current: sp.state },
          { key: 'brand_id', placeholder: 'Brand ID', current: sp.brand_id },
        ]}
      />

      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2)/50 px-3 py-2 text-sm">
        <div className="flex items-center gap-2.5 text-(--fg-muted)">
          <span>
            {total.toLocaleString()}{' '}
            {sp.state === 'open'
              ? 'open'
              : sp.state === 'resolved'
                ? 'resolved'
                : 'total'}{' '}
            anomal{total === 1 ? 'y' : 'ies'}
          </span>
          {!sp.state && openCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {openCount} open this page
            </span>
          )}
        </div>
        {totalPages > 1 && (
          <span className="text-xs text-(--fg-faint)">Page {page} of {totalPages}</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-(--r-lg) border border-dashed border-(--border-subtle) bg-(--surface-1) px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-2xl">✓</div>
          <div>
            <p className="text-sm font-medium text-(--fg-muted)">No anomalies match the current filters</p>
            {(sp.severity || sp.type || sp.state || sp.brand_id) && (
              <p className="mt-1 text-xs text-(--fg-faint)">
                Try adjusting your filters, or{' '}
                <Link href="/admin/anomalies" className="underline underline-offset-2 hover:text-(--fg-muted) transition-colors">
                  clear all filters
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const details = (r.details ?? {}) as Record<string, unknown>
            // source_flow and message are dedicated columns; fall back to details for old rows.
            // AI-call anomalies (withRetryAndLogging) only set details.flow_id, not source_flow.
            const sourceFlow = (r.source_flow ?? (details.source_flow as string) ?? (details.flow_id as string) ?? null)
            const flowLabel = sourceFlow ? FLOW_LABEL[sourceFlow] : null
            const targetCopilot = details.target_copilot as string | null
            const humanGate = details.human_gate as boolean | undefined
            const isBlocked = details.is_blocked as boolean | undefined
            const message = (r.message ?? (details.message as string) ?? null)
            const reasoning = details.reasoning as string | null
            const humanGateReasons = details.human_gate_reasons as string[] | undefined
            const confidenceMode = details.confidence_mode as string | null

            const hasDetails = Object.keys(details).length > 0

            return (
              <div
                key={r.anomaly_id}
                className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1) overflow-hidden"
              >
                {/* ── Header row ── */}
                <div className="flex flex-wrap items-start gap-2 px-4 py-3 border-b border-(--border-subtle) bg-(--surface-2)/50">
                  {/* Severity */}
                  <Badge
                    size="sm"
                    dot
                    tone={SEVERITY_TONE[r.severity] ?? 'outline'}
                  >
                    {r.severity.toUpperCase()}
                  </Badge>

                  {/* Type */}
                  <Badge tone="info" size="sm" className="font-mono">
                    {r.anomaly_type}
                  </Badge>

                  {/* Source flow */}
                  {sourceFlow && (
                    <Badge tone="accent" size="sm" className="rounded-md">
                      {sourceFlow}{flowLabel ? ` · ${flowLabel}` : ''}
                    </Badge>
                  )}

                  {/* Target copilot */}
                  {targetCopilot && (
                    <Badge tone="outline" size="sm">
                      → {targetCopilot} copilot
                    </Badge>
                  )}

                  {/* Human gate / blocked flags */}
                  {humanGate && (
                    <Badge tone="warning" size="sm" dot>human gate</Badge>
                  )}
                  {isBlocked && (
                    <Badge tone="danger" size="sm" dot>blocked</Badge>
                  )}

                  {/* Confidence mode */}
                  {confidenceMode && confidenceMode !== 'Standard' && (
                    <Badge tone="outline" size="sm">{confidenceMode}</Badge>
                  )}

                  {/* State */}
                  <Badge
                    tone={r.resolved ? 'success' : 'warning'}
                    size="sm"
                    dot
                    className="ml-auto"
                  >
                    {r.resolved ? 'Resolved' : 'Open'}
                  </Badge>
                </div>

                {/* ── Body ── */}
                <div className="px-4 py-3 space-y-3">
                  {/* IDs row */}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-(--fg-muted)">
                    <span>
                      <span className="text-(--fg-faint) mr-1">anomaly_id</span>
                      <span className="font-mono text-(--fg-base)">{r.anomaly_id}</span>
                    </span>
                    {r.brand_id && (
                      <span>
                        <span className="text-(--fg-faint) mr-1">brand_id</span>
                        <Link
                          href={`/admin/branddna/${r.brand_id}`}
                          className="font-mono text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors"
                        >
                          {r.brand_id}
                        </Link>
                      </span>
                    )}
                    <span>
                      <span className="text-(--fg-faint) mr-1">at</span>
                      <span className="font-mono">{formatDate(r.created_at, locale)}</span>
                    </span>
                  </div>

                  {/* Message */}
                  {message && (
                    <p className="text-sm text-(--fg-base) leading-relaxed">{message}</p>
                  )}

                  {/* Reasoning */}
                  {reasoning && reasoning !== 'initial_record' && (
                    <div className="text-xs">
                      <span className="text-(--fg-faint) mr-1">reasoning</span>
                      <span className="text-(--fg-muted)">{reasoning}</span>
                    </div>
                  )}
                  {reasoning === 'initial_record' && (
                    <div className="text-xs text-(--fg-faint) italic">CEO classification pending — anomaly recorded on arrival</div>
                  )}

                  {/* Human gate reasons */}
                  {humanGateReasons && humanGateReasons.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-xs text-(--fg-faint) self-center mr-1">gate reasons</span>
                      {humanGateReasons.map((reason) => (
                        <Badge key={reason} tone="warning" size="sm" className="font-mono">{reason}</Badge>
                      ))}
                    </div>
                  )}

                  {/* Full details JSON — always shown when present */}
                  {hasDetails && (
                    <details className="group" open={!message}>
                      <summary className="cursor-pointer text-xs text-(--fg-faint) hover:text-(--fg-muted) select-none list-none flex items-center gap-1">
                        <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                        full details
                      </summary>
                      <pre className="mt-2 rounded-(--r-sm) bg-(--surface-3) border border-(--border-subtle) p-3 text-xs font-mono text-(--fg-muted) overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                        {JSON.stringify(details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>

                {/* ── Footer / action ── */}
                <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-(--border-subtle) bg-(--surface-2)/30">
                  <ResolveAnomalyButton anomaly_id={r.anomaly_id} currentlyResolved={r.resolved} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Pagination current={page} total={totalPages} filterParams={filterParams} />
    </div>
  )
}

// ── Pagination ─────────────────────────────────────────────────────────────────
function Pagination({ current, total, filterParams }: { current: number; total: number; filterParams: string }) {
  if (total <= 1) return null
  const base = filterParams ? `?${filterParams}&` : '?'
  const prev = current > 1 ? current - 1 : null
  const next = current < total ? current + 1 : null

  const pages = new Set<number>()
  pages.add(1)
  pages.add(total)
  for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) pages.add(i)
  const pageList = Array.from(pages).sort((a, b) => a - b)

  return (
    <div className="flex items-center justify-between border-t border-(--border-subtle) pt-4 text-xs text-(--fg-muted)">
      <div className="flex gap-1 flex-wrap">
        {prev ? (
          <Link href={`${base}page=${prev}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 hover:bg-(--surface-2) transition-colors">← Prev</Link>
        ) : (
          <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 opacity-40">← Prev</span>
        )}
        {pageList.map((p, idx) => {
          const prev2 = pageList[idx - 1]
          const gap = prev2 !== undefined && p - prev2 > 1
          return (
            <span key={p} className="flex items-center gap-1">
              {gap && <span className="px-1 text-(--fg-faint)">…</span>}
              {p === current ? (
                <span className="rounded-(--r-sm) border border-(--accent) bg-(--accent)/10 px-2.5 py-1 font-medium text-(--accent)">{p}</span>
              ) : (
                <Link href={`${base}page=${p}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 hover:bg-(--surface-2) transition-colors">{p}</Link>
              )}
            </span>
          )
        })}
        {next ? (
          <Link href={`${base}page=${next}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 hover:bg-(--surface-2) transition-colors">Next →</Link>
        ) : (
          <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 opacity-40">Next →</span>
        )}
      </div>
      <span>Page {current} of {total}</span>
    </div>
  )
}
