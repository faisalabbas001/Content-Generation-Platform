import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Card } from './card'
import { Button } from './button'

/**
 * ErrorState — surface for app/error.tsx and inline error surfaces.
 * Pass an `onRetry` to render a retry button (calls the Next.js `reset()`).
 */
export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  hint,
}: {
  title: string
  description?: string
  retryLabel?: string
  onRetry?: () => void
  hint?: ReactNode
}) {
  return (
    <Card className="px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-(--danger-soft) text-(--danger)">
        <AlertTriangle size={20} />
      </div>
      <h3 className="font-display text-lg font-semibold text-(--fg)">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-(--fg-muted)">
          {description}
        </p>
      )}
      {hint && <div className="mt-3 text-xs text-(--fg-faint)">{hint}</div>}
      {onRetry && (
        <div className="mt-5">
          <Button variant="secondary" onClick={onRetry} leadingIcon={<RefreshCw size={14} />}>
            {retryLabel ?? 'Retry'}
          </Button>
        </div>
      )}
    </Card>
  )
}
