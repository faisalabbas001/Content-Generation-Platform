import Link from 'next/link'
import { adminClient, isDbConfigured } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Badge } from '@repo/ui/badge'
import { Card, CardBody } from '@repo/ui/card'
import { getServerT } from '@/lib/i18n-server'
import { confidenceModeTone, formatDate } from '@/lib/format'
import { FilterBar } from '../admin-widgets'
import type { RoutingDecision } from '@repo/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export default async function RoutingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale, t } = await getServerT()
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={t('adminRouting.eyebrow')} title={t('adminRouting.title')} subtitle={t('adminRouting.subtitle')} />
        <p className="text-sm text-(--fg-faint)">Database not configured.</p>
      </div>
    )
  }

  const db = adminClient()
  let q = db.from('routing_decisions').select('*', { count: 'exact' })
  if (sp.flow_id)  q = q.eq('flow_id', sp.flow_id)
  if (sp.brand_id) q = q.eq('brand_id', sp.brand_id)
  if (sp.outcome)  q = q.eq('outcome', sp.outcome)
  if (sp.mode)     q = q.eq('confidence_mode', sp.mode as never)

  const { data, count } = await q
    .order('timestamp', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  const rows = (data ?? []) as RoutingDecision[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Build filter param string (preserve all current filters when paginating)
  const filterParams = [
    sp.flow_id  ? `flow_id=${encodeURIComponent(sp.flow_id)}`  : '',
    sp.brand_id ? `brand_id=${encodeURIComponent(sp.brand_id)}` : '',
    sp.outcome  ? `outcome=${encodeURIComponent(sp.outcome)}`   : '',
    sp.mode     ? `mode=${encodeURIComponent(sp.mode)}`         : '',
  ].filter(Boolean).join('&')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('adminRouting.eyebrow')}
        title={t('adminRouting.title')}
        subtitle={t('adminRouting.subtitle')}
      />

      <FilterBar
        filters={[
          { key: 'flow_id',  placeholder: 'Flow (e.g. N8N-A01)', current: sp.flow_id },
          { key: 'mode',     placeholder: 'Mode', type: 'select', options: ['Standard', 'Cautious', 'Minimal', 'Blocked'], current: sp.mode },
          { key: 'outcome',  placeholder: 'Outcome', type: 'select', options: ['pending', 'completed', 'failed'], current: sp.outcome },
          { key: 'brand_id', placeholder: 'Brand ID (UUID)', current: sp.brand_id },
        ]}
      />

      {/* Summary bar */}
      <div className="flex items-center justify-between text-xs text-(--fg-muted)">
        <span>{total.toLocaleString()} decisions · page {page} of {totalPages}</span>
        <span className="text-(--fg-faint)">Showing {rows.length} rows</span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-sm text-(--fg-faint)">No routing decisions match these filters.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <RoutingRow key={r.decision_id} row={r} locale={locale} />
          ))}
        </div>
      )}

      <Pagination current={page} total={totalPages} filterParams={filterParams} />
    </div>
  )
}

// ── Flow ID labels ────────────────────────────────────────────────────────────

const FLOW_LABEL: Record<string, string> = {
  'N8N-A01': 'Batch Calendar',
  'N8N-A02': 'On-Demand Post',
  'N8N-B03': 'Revision',
  'N8N-A04': 'Brand Correction',
  'N8N-A05': 'Upgrade Readiness',
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  'on_demand_post': 'On-demand post',
  'batch_calendar': 'Batch calendar',
  'revision': 'Revision',
  'brand_correction': 'Brand correction',
  'upgrade_readiness': 'Upgrade readiness',
}

interface ConstraintsApplied {
  cost_status?: string
  anomaly_flag?: boolean
  occasion_flags?: string[]
  confidence_mode?: string
  human_gate_required?: boolean
  human_gate_reasons?: string[]
  constraint_payload?: {
    revision_context?: {
      post_id?: string
      instruction?: string
      revision_number?: number
      max_revisions?: number
      revision_reason?: string
      revisions_remaining?: number
      original_caption_score?: number
    }
  }
}

interface OutcomePayload {
  reasoning?: string
  selected_chain?: string
  memory_nominations?: unknown[]
  human_gate_required?: boolean
  anomaly_flag?: boolean
  agents_to_dispatch?: string[]
}

function parseConstraints(val: unknown): ConstraintsApplied | null {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  if (typeof val === 'object') return val as ConstraintsApplied
  return null
}

function parseOutcomePayload(val: unknown): OutcomePayload | null {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  if (typeof val === 'object') return val as OutcomePayload
  return null
}

function rawOutcomeJson(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'string') { try { return JSON.stringify(JSON.parse(val), null, 2) } catch { return val } }
  return JSON.stringify(val, null, 2)
}

// ── Row card ─────────────────────────────────────────────────────────────────

function RoutingRow({ row: r, locale }: { row: RoutingDecision; locale: string }) {
  const agents = Array.isArray(r.agents_dispatched)
    ? r.agents_dispatched as string[]
    : r.agents_dispatched && typeof r.agents_dispatched === 'object'
      ? Object.keys(r.agents_dispatched as object)
      : []

  const constraints = parseConstraints(r.constraints_applied)
  const outcomePayload = parseOutcomePayload(r.outcome)
  const isPlainOutcome = typeof r.outcome === 'string' && !r.outcome.startsWith('{')

  const outcomeTone = r.outcome === 'completed' || outcomePayload?.selected_chain ? 'success'
    : r.outcome === 'failed' ? 'danger'
    : 'warning'

  const outcomeLabel = isPlainOutcome
    ? (r.outcome ?? 'pending')
    : outcomePayload?.selected_chain
      ? `Completed → ${outcomePayload.selected_chain}`
      : 'Pending'

  const revCtx = constraints?.constraint_payload?.revision_context
  const occasions = constraints?.occasion_flags?.filter(Boolean) ?? []
  const humanGate = constraints?.human_gate_required ?? outcomePayload?.human_gate_required

  // Human-readable "what happened" digest for details summary
  const digest: string[] = []
  if (r.request_type) digest.push(REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type)
  if (revCtx?.revision_number && revCtx?.max_revisions) {
    digest.push(`Revision ${revCtx.revision_number} of ${revCtx.max_revisions}`)
  }
  if (occasions.length > 0) digest.push(`Occasion: ${occasions.join(', ')}`)
  if (humanGate) digest.push('Human review required')
  if (outcomePayload?.selected_chain) digest.push(`Chain: ${outcomePayload.selected_chain}`)
  if (outcomePayload?.reasoning) digest.push(outcomePayload.reasoning.slice(0, 100) + (outcomePayload.reasoning.length > 100 ? '…' : ''))

  const hasDetail = !!r.outcome

  return (
    <div className="rounded-lg border border-(--border-subtle) bg-(--surface-1) px-4 py-3 hover:bg-(--surface-2) transition-colors">
      {/* Top row: flow label + mode badge + outcome badge + brand link + timestamp */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" size="sm" className="rounded-md">
          {r.flow_id ?? '—'}{FLOW_LABEL[r.flow_id ?? ''] ? ` · ${FLOW_LABEL[r.flow_id ?? '']}` : ''}
        </Badge>

        {r.confidence_mode && (
          <Badge tone={confidenceModeTone(r.confidence_mode)} size="sm" className="rounded-md">
            {r.confidence_mode}
          </Badge>
        )}

        <Badge tone={outcomeTone} size="sm" className="rounded-md">
          {outcomeLabel}
        </Badge>

        {humanGate && (
          <Badge tone="warning" size="sm" className="rounded-md">Human review</Badge>
        )}

        {r.brand_id && (
          <Link
            href={`/admin/branddna/${r.brand_id}`}
            className="font-mono text-xs text-(--accent) hover:underline"
          >
            {r.brand_id.slice(0, 8)}…
          </Link>
        )}

        <span className="ms-auto text-[11px] text-(--fg-faint) tabular-nums shrink-0">
          {formatDate(r.timestamp, locale as 'ar' | 'en')}
        </span>
      </div>

      {/* Second row: human-readable context */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--fg-muted)">
        {r.request_type && (
          <span>
            <span className="text-(--fg-faint)">What: </span>
            {REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}
            {revCtx?.revision_number && revCtx?.max_revisions
              ? ` · revision ${revCtx.revision_number}/${revCtx.max_revisions}`
              : ''}
          </span>
        )}

        {occasions.length > 0 && (
          <span>
            <span className="text-(--fg-faint)">Occasion: </span>
            {occasions.join(', ')}
          </span>
        )}

        {r.pipeline_assigned && (
          <span>
            <span className="text-(--fg-faint)">Pipeline: </span>
            {r.pipeline_assigned}
          </span>
        )}

        {agents.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            <span className="text-(--fg-faint)">Agents: </span>
            {agents.map((a, i) => (
              <Badge key={i} tone="outline" size="sm" className="rounded-md">{a}</Badge>
            ))}
          </span>
        )}
      </div>

      {/* Revision context if present */}
      {revCtx && (
        <div className="mt-1.5 text-xs text-(--fg-muted)">
          {revCtx.revision_reason && (
            <span><span className="text-(--fg-faint)">Reason: </span>{revCtx.revision_reason}</span>
          )}
          {revCtx.original_caption_score !== undefined && (
            <span className="ml-3"><span className="text-(--fg-faint)">Score: </span>{revCtx.original_caption_score}</span>
          )}
          {revCtx.revisions_remaining !== undefined && (
            <span className="ml-3"><span className="text-(--fg-faint)">Remaining: </span>{revCtx.revisions_remaining}</span>
          )}
        </div>
      )}

      {/* Reasoning from outcome payload */}
      {outcomePayload?.reasoning && (
        <p className="mt-1.5 text-xs text-(--fg-muted) line-clamp-2">
          <span className="text-(--fg-faint)">Reasoning: </span>
          {outcomePayload.reasoning}
        </p>
      )}

      {/* Expandable raw detail */}
      {hasDetail && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-(--fg-faint) hover:text-(--fg-muted) select-none list-none flex items-center gap-1">
            <span className="inline-block transition-transform [[open]_&]:rotate-90">▶</span>
            <span>
              {digest.length > 0 ? digest.slice(0, 3).join(' · ') : 'View full detail'}
            </span>
          </summary>
          <pre className="mt-1.5 max-h-64 overflow-auto rounded-md bg-(--surface-3) p-2.5 font-mono text-[11px] text-(--fg-muted) whitespace-pre-wrap break-all">
            {rawOutcomeJson(r.outcome)}
          </pre>
        </details>
      )}
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ current, total, filterParams }: { current: number; total: number; filterParams: string }) {
  if (total <= 1) return null
  const base = filterParams ? `?${filterParams}&` : '?'
  const prev = current > 1 ? current - 1 : null
  const next = current < total ? current + 1 : null

  // Build page window: always show first, last, and ±2 around current
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
