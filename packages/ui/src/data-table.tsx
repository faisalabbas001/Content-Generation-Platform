import type { ReactNode } from 'react'
import { cn } from './cn'
import { Card } from './card'

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  align?: 'start' | 'center' | 'end'
  width?: string
  /**
   * Hide this column from the mobile card view. Use for noisy / low-priority
   * columns (raw IDs, timestamps) that you still want in the desktop table.
   */
  hideOnMobile?: boolean
  /**
   * When true, this column renders as the FULL-WIDTH first row of each
   * mobile card (typically the identity column — name, badges, avatar).
   */
  primaryOnMobile?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  empty,
  caption,
  density = 'normal',
}: {
  columns: Array<DataTableColumn<T>>
  rows: T[]
  empty?: ReactNode
  caption?: ReactNode
  density?: 'normal' | 'compact'
}) {
  if (rows.length === 0) {
    return (
      <Card className="px-6 py-14 text-center">
        <div className="text-sm text-(--fg-muted)">
          {empty ?? 'لا توجد بيانات بعد'}
        </div>
      </Card>
    )
  }

  const padX = density === 'compact' ? 'px-3' : 'px-4'
  const padY = density === 'compact' ? 'py-2' : 'py-3'

  const mobileVisible = columns.filter((c) => !c.hideOnMobile)
  const primaryCol = mobileVisible.find((c) => c.primaryOnMobile) ?? mobileVisible[0]
  const detailCols = mobileVisible.filter((c) => c !== primaryCol)

  return (
    <Card className="overflow-hidden">
      {caption && (
        <div className="border-b border-(--border-subtle) px-5 py-3 text-xs text-(--fg-muted)">
          {caption}
        </div>
      )}

      {/* ── Desktop ≥ md: classic horizontal-scroll table ─────────── */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-(--border-subtle) bg-(--surface-1)">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'text-xs font-medium uppercase tracking-wide text-(--fg-muted)',
                    padX,
                    padY,
                    c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start',
                  )}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border-subtle)">
            {rows.map((r, i) => (
              <tr
                key={i}
                className="transition-colors duration-(--d-fast) ease-out hover:bg-(--surface-3)"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      padX,
                      padY,
                      'align-top text-(--fg-subtle)',
                      c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start',
                    )}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile < md: stacked card-per-row ─────────────────────── */}
      <ul className="divide-y divide-(--border-subtle) md:hidden">
        {rows.map((r, i) => (
          <li key={i} className="space-y-2.5 px-4 py-3.5">
            {primaryCol && (
              <div className="text-sm font-medium text-(--fg)">
                {primaryCol.render(r)}
              </div>
            )}
            {detailCols.length > 0 && (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
                {detailCols.map((c) => {
                  const value = c.render(r)
                  if (value == null || value === false || value === '') return null
                  return (
                    <div key={c.key} className="contents">
                      <dt className="text-(--fg-muted) uppercase tracking-wide">{c.header}</dt>
                      <dd className={cn('min-w-0 break-words text-(--fg-subtle)', c.align === 'end' ? 'text-end' : '')}>
                        {value}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
