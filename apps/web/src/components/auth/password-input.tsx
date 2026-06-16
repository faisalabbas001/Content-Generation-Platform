'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from '@repo/ui/icons'
import { Input } from '@repo/ui/input'

/**
 * Password input with a built-in show/hide toggle.
 *
 * - Local `visible` state — resets to `false` on every mount / page reload
 *   (no persistence across navigation, intentionally for security).
 * - Eye icon is a real <button type="button"> so it never submits the form.
 * - aria-pressed on the toggle so screen readers announce the state.
 */
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  toggleHideLabel?: string
  toggleShowLabel?: string
}

export function PasswordInput({
  className,
  toggleHideLabel = 'Hide password',
  toggleShowLabel = 'Show password',
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={`pe-10 ${className ?? ''}`}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? toggleHideLabel : toggleShowLabel}
        tabIndex={0}
        className="absolute inset-y-0 end-0 flex h-full w-10 items-center justify-center text-(--fg-muted) hover:text-(--fg) transition-colors focus-visible:outline-2 focus-visible:outline-(--accent) rounded-(--r-sm)"
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}
