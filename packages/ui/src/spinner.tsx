import { cn } from './cn'

/**
 * Spinner — minimal SVG circle with a rotating arc.
 * Inherits text colour, so `<Spinner className="text-(--accent)" />` works.
 */
export function Spinner({
  size = 18,
  className,
  ariaLabel = 'Loading',
}: {
  size?: number
  className?: string
  ariaLabel?: string
}) {
  return (
    <svg
      role="status"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin', className)}
      fill="none"
      stroke="currentColor"
    >
      <circle cx="12" cy="12" r="9" strokeWidth="2.5" opacity="0.18" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
