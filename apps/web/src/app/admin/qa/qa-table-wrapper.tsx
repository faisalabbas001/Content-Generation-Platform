'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from '@repo/ui/icons'
import { Spinner } from '@repo/ui/spinner'
import { QaTabs, type QaTabKey, type QaTabDef } from './qa-tabs'

interface PaginationProps {
  page: number
  pageCount: number
  summary: string
  pageLabel: string
  previousLabel: string
  nextLabel: string
  locale: 'ar' | 'en'
}

export function QaTableWrapper({
  children,
  pagination,
  tab,
  tabs,
  legend,
  loadingLabel,
}: {
  children: React.ReactNode
  pagination: PaginationProps | null
  /** Active QA tab — preserved across pagination so links stay within the tab. */
  tab: QaTabKey
  tabs: QaTabDef[]
  /** Static legend node rendered between the tabs and the table. */
  legend?: React.ReactNode
  loadingLabel: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function go(href: string) {
    startTransition(() => router.push(href))
  }

  function selectTab(next: QaTabKey) {
    if (next === tab) return
    // Switching tabs always resets pagination to page 1.
    go(next === 'calendar' ? '/admin/qa' : `/admin/qa?tab=${next}`)
  }

  function navigate(p: number) {
    const params = new URLSearchParams()
    if (tab !== 'calendar') params.set('tab', tab)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    go(qs ? `/admin/qa?${qs}` : '/admin/qa')
  }

  return (
    <div className="space-y-6">
      <QaTabs tabs={tabs} active={tab} pending={isPending} onSelect={selectTab} />

      {legend}

      <div className="space-y-4">
        {/* ── Table + loading overlay (covers tab switches AND pagination) ── */}
        <div className="relative">
          {children}

          {isPending && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-(--r-lg) bg-(--surface-1)/70 backdrop-blur-[2px]">
              <Spinner size={36} className="text-(--accent)" />
              <p className="text-sm font-medium text-(--fg-muted)">{loadingLabel}</p>
            </div>
          )}
        </div>

        {/* ── Pagination ──────────────────────────────────────────── */}
        {pagination && pagination.pageCount > 1 && (
          <Pagination
            {...pagination}
            isPending={isPending}
            onNavigate={navigate}
          />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Pagination({
  page,
  pageCount,
  summary,
  pageLabel,
  previousLabel,
  nextLabel,
  locale,
  isPending,
  onNavigate,
}: PaginationProps & {
  isPending: boolean
  onNavigate: (p: number) => void
}) {
  const isRtl = locale === 'ar'
  const window = pageWindow(page, pageCount)

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-(--border-subtle) pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-2">
        <p className="text-xs text-(--fg-faint) sm:text-sm">{summary}</p>
        {isPending && <Spinner size={13} className="text-(--accent)" />}
      </div>

      <div
        className={`flex items-center justify-center gap-1.5 sm:justify-end transition-opacity ${
          isPending ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        <PageBtn
          onClick={() => onNavigate(page - 1)}
          disabled={page <= 1 || isPending}
          aria-label={previousLabel}
        >
          {isRtl
            ? <ChevronRight size={14} aria-hidden />
            : <ChevronLeft size={14} aria-hidden />}
          <span className="hidden sm:inline">{previousLabel}</span>
        </PageBtn>

        <span className="px-2 text-xs text-(--fg-subtle) sm:hidden">{pageLabel}</span>

        <ol className="hidden items-center gap-1 sm:flex">
          {window.map((entry, idx) =>
            entry === 'gap' ? (
              <li key={`gap-${idx}`} aria-hidden className="px-1.5 text-(--fg-faint) select-none">
                …
              </li>
            ) : (
              <li key={entry}>
                <PageBtn
                  onClick={() => onNavigate(entry)}
                  active={entry === page}
                  disabled={isPending}
                  aria-label={`Page ${entry}`}
                  aria-current={entry === page ? 'page' : undefined}
                >
                  {entry}
                </PageBtn>
              </li>
            ),
          )}
        </ol>

        <PageBtn
          onClick={() => onNavigate(page + 1)}
          disabled={page >= pageCount || isPending}
          aria-label={nextLabel}
        >
          <span className="hidden sm:inline">{nextLabel}</span>
          {isRtl
            ? <ChevronLeft size={14} aria-hidden />
            : <ChevronRight size={14} aria-hidden />}
        </PageBtn>
      </div>
    </nav>
  )
}

function PageBtn({
  active = false,
  disabled = false,
  children,
  ...rest
}: {
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      disabled={disabled}
      className={[
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
        active
          ? 'bg-(--accent) text-white shadow-sm'
          : 'border border-(--border-subtle) text-(--fg-subtle) hover:bg-(--surface-3) hover:text-(--fg)',
        disabled ? 'pointer-events-none cursor-not-allowed opacity-40' : '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

function pageWindow(page: number, pageCount: number): Array<number | 'gap'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const out: Array<number | 'gap'> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pageCount - 1, page + 1)
  if (start > 2) out.push('gap')
  for (let p = start; p <= end; p++) out.push(p)
  if (end < pageCount - 1) out.push('gap')
  out.push(pageCount)
  return out
}
