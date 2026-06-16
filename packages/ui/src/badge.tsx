import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
type Size = 'sm' | 'md'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-(--surface-4) text-(--fg-subtle) border-(--border-default)',
  accent:  'bg-(--accent-soft) text-(--accent) border-(--accent-border)',
  success: 'bg-(--success-soft) text-(--success) border-(--success-border)',
  warning: 'bg-(--warning-soft) text-(--warning) border-(--warning-border)',
  danger:  'bg-(--danger-soft) text-(--danger) border-(--danger-border)',
  info:    'bg-(--info-soft) text-(--info) border-(--info-border)',
  outline: 'bg-transparent text-(--fg-muted) border-(--border-default)',
}

const sizeClass: Record<Size, string> = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  size?: Size
  dot?: boolean
  children: ReactNode
}

export function Badge({ tone = 'neutral', size = 'md', dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-wide',
        toneClass[tone],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  )
}
