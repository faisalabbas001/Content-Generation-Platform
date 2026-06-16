import Link from 'next/link'

/**
 * Server-rendered, URL-driven pager for the On-Demand brand workspace. Mirrors
 * the prev/next + numbered-window + summary pattern used by the QA tab's
 * QaTableWrapper, but as plain <Link>s (no client JS) so it works inside the
 * server-rendered brand detail page. Pages are addressed via `?page=N` on the
 * brand's own URL, so the back button and shareable links behave correctly.
 */
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

function btnClass(active = false, disabled = false): string {
  return [
    'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
    active
      ? 'bg-(--accent) text-white shadow-sm'
      : 'border border-(--border-subtle) text-(--fg-subtle) hover:bg-(--surface-3) hover:text-(--fg)',
    disabled ? 'pointer-events-none cursor-not-allowed opacity-40' : '',
  ].join(' ')
}

export function OnDemandPager({
  basePath,
  page,
  pageCount,
  from,
  to,
  total,
  unit = 'items',
}: {
  basePath: string
  page: number
  pageCount: number
  from: number
  to: number
  total: number
  unit?: string
}) {
  if (pageCount <= 1) return null
  const href = (p: number) => (p > 1 ? `${basePath}?page=${p}` : basePath)
  const window = pageWindow(page, pageCount)

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-col gap-3 border-t border-(--border-subtle) pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-xs text-(--fg-faint) sm:text-sm">
        Showing {from}–{to} of {total} {unit}
      </p>

      <div className="flex items-center justify-center gap-1.5 sm:justify-end">
        {/* Previous */}
        {page > 1 ? (
          <Link href={href(page - 1)} aria-label="Previous" className={btnClass(false, false)}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Previous</span>
          </Link>
        ) : (
          <span aria-hidden className={btnClass(false, true)}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Previous</span>
          </span>
        )}

        {/* Compact mobile indicator */}
        <span className="px-2 text-xs text-(--fg-subtle) sm:hidden">Page {page} of {pageCount}</span>

        {/* Numbered window (sm+) */}
        <ol className="hidden items-center gap-1 sm:flex">
          {window.map((entry, idx) =>
            entry === 'gap' ? (
              <li key={`gap-${idx}`} aria-hidden className="px-1.5 text-(--fg-faint) select-none">
                …
              </li>
            ) : (
              <li key={entry}>
                <Link
                  href={href(entry)}
                  aria-label={`Page ${entry}`}
                  aria-current={entry === page ? 'page' : undefined}
                  className={btnClass(entry === page, false)}
                >
                  {entry}
                </Link>
              </li>
            ),
          )}
        </ol>

        {/* Next */}
        {page < pageCount ? (
          <Link href={href(page + 1)} aria-label="Next" className={btnClass(false, false)}>
            <span className="hidden sm:inline">Next</span>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ) : (
          <span aria-hidden className={btnClass(false, true)}>
            <span className="hidden sm:inline">Next</span>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        )}
      </div>
    </nav>
  )
}
