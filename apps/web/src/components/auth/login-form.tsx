'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@repo/ui/button'
import { Field, Input } from '@repo/ui/input'
import { LogIn } from '@repo/ui/icons'
import { useLogin } from '@/hooks/use-auth'
import { PasswordInput } from './password-input'

interface LoginFormProps {
  emailLabel: string
  passwordLabel: string
  submitLabel: string
  pendingLabel: string
  defaultRedirectTo: string
  showPasswordLabel?: string
  hidePasswordLabel?: string
  forgotPasswordLabel?: string
}

export function LoginForm({
  emailLabel,
  passwordLabel,
  submitLabel,
  pendingLabel,
  defaultRedirectTo,
  showPasswordLabel,
  hidePasswordLabel,
  forgotPasswordLabel,
}: LoginFormProps) {
  const login = useLogin()
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    const redirectTo = String(formData.get('redirectTo') ?? defaultRedirectTo)

    if (!email || !password) {
      setLocalError('Please provide both email and password.')
      return
    }

    try {
      const result = await login.mutateAsync({ email, password })
      window.location.assign(result.redirectTo ?? redirectTo)
    } catch {
      // Error already normalized by hook
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      name="login"
      method="post"
      noValidate
    >
      <input type="hidden" name="redirectTo" value={defaultRedirectTo} />

      <Field label={emailLabel} required>
        <Input
          id="email"
          name="email"
          type="email"
          required
          dir="ltr"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@example.com"
        />
      </Field>

      <Field label={passwordLabel} required>
        <PasswordInput
          id="current-password"
          name="password"
          required
          dir="ltr"
          autoComplete="current-password"
          toggleShowLabel={showPasswordLabel}
          toggleHideLabel={hidePasswordLabel}
        />
      </Field>

      {forgotPasswordLabel && (
        <div className="flex justify-end -mt-2">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-(--accent) hover:underline"
          >
            {forgotPasswordLabel}
          </Link>
        </div>
      )}

      {(localError || login.error) && (
        <p
          className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)"
          role="alert"
        >
          {localError ?? login.error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        leadingIcon={<LogIn size={16} />}
        disabled={login.isPending}
      >
        {login.isPending ? pendingLabel : submitLabel}
      </Button>
    </form>
  )
}
