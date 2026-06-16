import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

/**
 * Card — primary content surface.
 *
 * Variants:
 *   default — surface-2 with subtle border
 *   raised  — surface-3, used for nested or hover-target cards
 *   ghost   — transparent with border only
 */

type Variant = 'default' | 'raised' | 'ghost'

const variantClass: Record<Variant, string> = {
  default: 'bg-(--surface-2) border border-(--border-subtle)',
  raised:  'bg-(--surface-3) border border-(--border-default)',
  ghost:   'bg-transparent border border-(--border-default)',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  interactive?: boolean
}

export function Card({ variant = 'default', interactive, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-(--r-lg) shadow-(--shadow-1)',
        variantClass[variant],
        interactive &&
          'transition-colors duration-(--d-fast) ease-out hover:border-(--border-strong) hover:bg-(--surface-3)',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-(--border-subtle) px-6 py-4', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn('font-display text-base font-semibold tracking-tight text-(--fg)', className)}>
      {children}
    </h3>
  )
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-(--fg-muted)', className)}>{children}</p>
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('border-t border-(--border-subtle) px-6 py-3 text-xs text-(--fg-muted)', className)}>
      {children}
    </div>
  )
}
