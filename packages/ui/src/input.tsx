import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

const fieldBase =
  'w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-4) px-3 text-sm text-(--fg) ' +
  'placeholder:text-(--fg-faint) ' +
  'transition-colors duration-(--d-fast) ease-out ' +
  'focus:border-(--accent) focus:outline-none focus:ring-2 focus:ring-(--accent-soft) ' +
  'disabled:opacity-50 disabled:pointer-events-none'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}
export function Input({ className, dir = 'auto', ...rest }: InputProps) {
  return <input dir={dir} className={cn(fieldBase, 'h-10', className)} {...rest} />
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}
export function Select({ className, dir = 'auto', children, ...rest }: SelectProps) {
  return (
    <select dir={dir} className={cn(fieldBase, 'h-10 cursor-pointer pe-8', className)} {...rest}>
      {children}
    </select>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function Textarea({ className, dir = 'auto', ...rest }: TextareaProps) {
  return <textarea dir={dir} className={cn(fieldBase, 'py-2.5 leading-relaxed min-h-24', className)} {...rest} />
}

export function Label({ children, htmlFor, required }: { children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-(--fg-muted)">
      {children}
      {required && <span className="ms-1 text-(--accent)">*</span>}
    </label>
  )
}

export function Field({
  label,
  required,
  hint,
  badge,
  children,
}: {
  label: string
  required?: boolean
  hint?: ReactNode
  /** Optional adornment shown inline with the label — e.g. "auto-detected". */
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      {badge ? (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <Label required={required}>{label}</Label>
          <span className="-mt-1.5">{badge}</span>
        </div>
      ) : (
        <Label required={required}>{label}</Label>
      )}
      {children}
      {hint && <p className="mt-1 text-xs text-(--fg-faint)">{hint}</p>}
    </div>
  )
}
