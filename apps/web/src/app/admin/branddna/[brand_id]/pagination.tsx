import Link from 'next/link'

export function Pagination({ current, total, paramKey, otherParam }: {
  current: number
  total: number
  paramKey: string
  otherParam: string
}) {
  if (total <= 1) return null
  const prev = current > 1 ? current - 1 : null
  const next = current < total ? current + 1 : null
  return (
    <div className="flex items-center justify-between border-t border-(--border-subtle) px-4 py-2 text-xs text-(--fg-muted)">
      <span>Page {current} of {total}</span>
      <div className="flex gap-2">
        {prev ? (
          <Link href={`?${paramKey}=${prev}&${otherParam}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 hover:bg-(--surface-2) transition-colors">← Prev</Link>
        ) : (
          <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 opacity-40">← Prev</span>
        )}
        {next ? (
          <Link href={`?${paramKey}=${next}&${otherParam}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 hover:bg-(--surface-2) transition-colors">Next →</Link>
        ) : (
          <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 opacity-40">Next →</span>
        )}
      </div>
    </div>
  )
}
