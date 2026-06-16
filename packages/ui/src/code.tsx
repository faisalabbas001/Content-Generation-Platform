import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function Code({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        'rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-1.5 py-0.5 font-mono text-[0.85em] text-(--fg-subtle)',
        className,
      )}
      {...rest}
    >
      {children}
    </code>
  )
}
