import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const baseClass =
  'inline-flex items-center justify-center gap-2 rounded-(--r-md) font-medium ' +
  'transition-colors duration-(--d-fast) ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg) ' +
  'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none'

const variantClass: Record<Variant, string> = {
  primary:
    'bg-(--accent) text-(--accent-fg) hover:bg-(--accent-strong) shadow-(--shadow-1)',
  secondary:
    'bg-(--surface-3) text-(--fg) hover:bg-(--surface-4) border border-(--border-default)',
  ghost:
    'text-(--fg-subtle) hover:bg-(--surface-3) hover:text-(--fg)',
  outline:
    'border border-(--border-default) text-(--fg-subtle) hover:border-(--border-strong) hover:text-(--fg) bg-transparent',
  danger:
    'bg-(--danger) text-white hover:opacity-90',
}

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-sm',
  icon: 'h-9 w-9',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={cn(baseClass, variantClass[variant], sizeClass[size], className)} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  )
}

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant
  size?: Size
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a className={cn(baseClass, variantClass[variant], sizeClass[size], className)} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </a>
  )
}
