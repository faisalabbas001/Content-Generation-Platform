'use client'

import { Spinner } from '@repo/ui/spinner'

export type QaTabKey = 'calendar' | 'on_demand'

export interface QaTabDef {
  key: QaTabKey
  label: string
  /** Pending-item count rendered as a badge on the tab. */
  count?: number
}

/**
 * Segmented tab control for the QA queue. Controlled by QaTableWrapper, which
 * owns the navigation transition so the table's loading overlay covers tab
 * switches and pagination alike. Tab state lives in the URL (`?tab=on_demand`;
 * the default `calendar` carries no param so `/admin/qa` stays canonical).
 *
 * The bar is a true two-up segmented control on every breakpoint — equal-width
 * halves on mobile (`flex-1`) that hug their content on `sm+` (`sm:flex-none`).
 * Labels wrap rather than overflow on very narrow screens (no `flex-wrap` on the
 * container, so the two tabs never stack into a lopsided two-row pill).
 */
export function QaTabs({
  tabs,
  active,
  pending = false,
  onSelect,
}: {
  tabs: QaTabDef[]
  active: QaTabKey
  pending?: boolean
  onSelect: (key: QaTabKey) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="QA categories"
      className="flex w-full gap-1 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) p-1 sm:inline-flex sm:w-auto"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={pending}
            onClick={() => onSelect(tab.key)}
            className={[
              'relative inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-(--r-md) px-3 py-2 text-center text-sm font-medium leading-tight transition-colors sm:flex-none sm:px-4',
              isActive
                ? 'bg-(--surface-1) text-(--fg) shadow-sm'
                : 'text-(--fg-muted) hover:text-(--fg)',
              pending ? 'cursor-wait' : '',
            ].join(' ')}
          >
            <span className="min-w-0">{tab.label}</span>
            {tab.count ? (
              <span
                className={[
                  'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
                  isActive
                    ? 'bg-(--accent) text-white'
                    : 'bg-(--surface-3) text-(--fg-subtle)',
                ].join(' ')}
              >
                {tab.count}
              </span>
            ) : null}
            {pending && isActive && <Spinner size={12} className="shrink-0 text-(--accent)" />}
          </button>
        )
      })}
    </div>
  )
}
