import type { ReactNode } from 'react'

export interface MarketingFooterColumn {
  title: string
  links: Array<{ href: string; label: string }>
}

/**
 * Minimal marketing footer — a single bottom strip.
 *
 *   left:  copyright + small sub-note (e.g. VAT line)
 *   right: trust badges (Made in Riyadh, Verified on Maroof, …)
 *
 * `columns` / `brand` are accepted for backward compatibility but are not
 * rendered in this minimal layout — pass `subnote` and `badges` instead.
 */
export function MarketingFooter({
  copyright,
  subnote,
  badges,
}: {
  copyright: string
  /** Small muted line under the copyright (e.g. "All prices include 15% VAT"). */
  subnote?: ReactNode
  /** Right-aligned trust badges row. */
  badges?: ReactNode
  // — accepted but unused in the minimal layout —
  brand?: ReactNode
  columns?: MarketingFooterColumn[]
  legal?: ReactNode
  linkAs?: React.ElementType
}) {
  return (
    <footer className="border-t border-(--border-subtle) bg-(--bg)">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="space-y-1">
          <p className="text-sm text-(--fg-muted)">{copyright}</p>
          {subnote && <p className="text-xs text-(--fg-faint)">{subnote}</p>}
        </div>
        {badges && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-(--fg-muted)">
            {badges}
          </div>
        )}
      </div>
    </footer>
  )
}
