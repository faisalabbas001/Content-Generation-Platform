'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { Input, Select } from '@repo/ui/input'
import { Spinner } from '@repo/ui/spinner'
import { retryFailedNotification } from '../actions'

interface LogRow {
  notification_id: string
  template_key: string
  lang: string
  auth_user_id: string
  user_email: string | null
  rendered_subject: string
  resend_status: string
  resend_error: string | null
  resend_message_id: string | null
  retry_count: number
  sent_at: string | null
  created_at: string
}

interface Props {
  rows: LogRow[]
  templateKeys: string[]
  currentTemplate: string
  currentStatus: string
  currentSearch: string
  page: number
  totalPages: number
  total: number
  grandTotal: number
  pageSize: number
  pageSizes: number[]
  rangeFrom: number
  rangeTo: number
  filtersActive: boolean
}

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'outline'> = {
  sent:    'success',
  failed:  'danger',
  queued:  'warning',
  bounced: 'outline',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function DeliveryLogTable({
  rows,
  templateKeys,
  currentTemplate,
  currentStatus,
  currentSearch,
  page,
  totalPages,
  total,
  grandTotal,
  pageSize,
  pageSizes,
  rangeFrom,
  rangeTo,
  filtersActive,
}: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const sp       = useSearchParams()

  const [retryingId, setRetryingId]     = useState<string | null>(null)
  const [retryError, setRetryError]     = useState<Record<string, string>>({})
  const [retrySuccess, setRetrySuccess] = useState<Set<string>>(new Set())
  const [searchValue, setSearchValue]   = useState(currentSearch)
  const [lastSearch, setLastSearch]     = useState(currentSearch)
  const [isPending, startTransition]    = useTransition()

  // Sync the local search box when the URL changes externally (Clear filters,
  // back/forward). Render-phase adjustment — React's recommended alternative to
  // a setState-in-effect (https://react.dev/learn/you-might-not-need-an-effect).
  if (currentSearch !== lastSearch) {
    setLastSearch(currentSearch)
    setSearchValue(currentSearch)
  }

  function navigate(params: Record<string, string>) {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(params)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    const qs = next.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  // Debounced search → resets to page 1. Skips the initial mount and no-op edits.
  const didMount = useRef(false)
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return }
    if (searchValue.trim() === currentSearch) return
    const id = setTimeout(() => navigate({ q: searchValue.trim(), page: '1' }), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue])

  function handleRetry(id: string) {
    setRetryingId(id)
    setRetryError((prev) => { const n = { ...prev }; delete n[id]; return n })
    startTransition(async () => {
      const r = await retryFailedNotification(id)
      setRetryingId(null)
      if (r.ok) {
        setRetrySuccess((prev) => new Set(prev).add(id))
        router.refresh()
      } else {
        setRetryError((prev) => ({ ...prev, [id]: r.error }))
      }
    })
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 border-b border-(--border-subtle) px-5 py-3">
        {/* Search */}
        <div className="relative">
          <Input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search subject or template…"
            aria-label="Search notifications by subject or template"
            className="h-9 w-56 ps-3 pe-8 text-xs"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => setSearchValue('')}
              aria-label="Clear search"
              className="absolute end-2 top-1/2 -translate-y-1/2 text-(--fg-faint) hover:text-(--fg)"
            >
              ✕
            </button>
          )}
        </div>

        {/* Template filter */}
        <Select
          value={currentTemplate}
          onChange={(e) => navigate({ template: e.target.value, page: '1' })}
          aria-label="Filter by template"
          className="h-9 w-auto text-xs"
        >
          <option value="">All templates</option>
          {templateKeys.map((k) => (
            <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
          ))}
        </Select>

        {/* Status filter */}
        <Select
          value={currentStatus}
          onChange={(e) => navigate({ status: e.target.value, page: '1' })}
          aria-label="Filter by status"
          className="h-9 w-auto text-xs"
        >
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="queued">Queued</option>
          <option value="bounced">Bounced</option>
        </Select>

        {filtersActive && (
          <button
            onClick={() => { setSearchValue(''); navigate({ template: '', status: '', q: '', page: '1' }) }}
            className="text-xs text-(--fg-muted) underline hover:text-(--fg)"
          >
            Clear filters
          </button>
        )}

        <div className="ms-auto flex items-center gap-3">
          {isPending && <Spinner size={14} className="text-(--fg-muted)" />}
          <span className="text-xs text-(--fg-faint)">
            {total > 0 ? `${rangeFrom}–${rangeTo} of ${total}` : '0 results'}
          </span>
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center">
          {grandTotal === 0 ? (
            <>
              <p className="text-sm font-medium text-(--fg)">No notifications yet</p>
              <p className="mt-1 text-xs text-(--fg-muted)">
                Delivery records appear here once the system sends its first email.
              </p>
            </>
          ) : filtersActive ? (
            <>
              <p className="text-sm font-medium text-(--fg)">No notifications match your filters</p>
              <p className="mt-1 text-xs text-(--fg-muted)">Try adjusting the search, template, or status.</p>
              <div className="mt-4 flex justify-center">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setSearchValue(''); navigate({ template: '', status: '', q: '', page: '1' }) }}
                >
                  Clear filters
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-(--fg-muted)">No notifications to show.</p>
          )}
        </div>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${isPending ? 'pointer-events-none opacity-60' : ''}`}>
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-(--border-subtle) bg-(--surface-2)">
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-(--fg-faint)">Template</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-(--fg-faint)">Recipient</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-(--fg-faint)">Subject</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-(--fg-faint)">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-(--fg-faint)">Retries</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-(--fg-faint)">Sent</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-(--fg-faint)"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border-subtle)">
              {rows.map((row) => {
                const isRetrying = retryingId === row.notification_id && isPending
                const wasRetried = retrySuccess.has(row.notification_id)
                const err        = retryError[row.notification_id]
                const canRetry   = (row.resend_status === 'failed' || row.resend_status === 'queued') && !wasRetried

                return (
                  <tr key={row.notification_id} className="transition-colors hover:bg-(--surface-2)">
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <code className="rounded bg-(--surface-3) px-1.5 py-0.5 font-mono text-xs text-(--fg)">
                          {row.template_key}
                        </code>
                        <span className="text-[10px] uppercase text-(--fg-faint)">{row.lang}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="max-w-[180px]">
                        <p className="truncate text-xs text-(--fg)">{row.user_email ?? '—'}</p>
                        <p className="truncate font-mono text-[10px] text-(--fg-faint)">{row.auth_user_id.slice(0, 8)}…</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="max-w-[240px] truncate text-xs text-(--fg)" title={row.rendered_subject}>
                        {row.rendered_subject}
                      </p>
                      {row.resend_message_id && (
                        <p className="max-w-[240px] truncate font-mono text-[10px] text-(--fg-faint)" title={row.resend_message_id}>
                          ID: {row.resend_message_id}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="space-y-1">
                        <Badge tone={STATUS_TONE[row.resend_status] ?? 'outline'} size="sm">
                          {row.resend_status}
                        </Badge>
                        {row.resend_error && (
                          <p className="max-w-[160px] text-[10px] leading-snug text-(--danger)" title={row.resend_error}>
                            {row.resend_error.slice(0, 80)}{row.resend_error.length > 80 ? '…' : ''}
                          </p>
                        )}
                        {err && <p className="text-[10px] text-(--danger)">Retry failed: {err}</p>}
                        {wasRetried && <p className="text-[10px] text-emerald-400">Retried ✓</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-(--fg-muted)">
                      {row.retry_count > 0 ? `×${row.retry_count}` : '—'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div>
                        <p className="whitespace-nowrap text-xs text-(--fg-muted)">
                          {row.sent_at ? timeAgo(row.sent_at) : '—'}
                        </p>
                        <p className="whitespace-nowrap text-[10px] text-(--fg-faint)">
                          {new Date(row.created_at).toLocaleString('en-SA', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {canRetry && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isRetrying}
                          onClick={() => handleRetry(row.notification_id)}
                        >
                          {isRetrying ? 'Retrying…' : 'Retry'}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: page size + pagination */}
      {(total > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-subtle) px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-(--fg-muted)">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onChange={(e) => navigate({ size: e.target.value, page: '1' })}
              aria-label="Rows per page"
              className="h-8 w-auto text-xs"
            >
              {pageSizes.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={page <= 1 || isPending} onClick={() => navigate({ page: '1' })}>« First</Button>
            <Button size="sm" variant="ghost" disabled={page <= 1 || isPending} onClick={() => navigate({ page: String(page - 1) })}>← Prev</Button>
            <span className="px-2 text-xs text-(--fg-muted)">Page {page} of {totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page >= totalPages || isPending} onClick={() => navigate({ page: String(page + 1) })}>Next →</Button>
            <Button size="sm" variant="ghost" disabled={page >= totalPages || isPending} onClick={() => navigate({ page: String(totalPages) })}>Last »</Button>
          </div>
        </div>
      )}
    </div>
  )
}
