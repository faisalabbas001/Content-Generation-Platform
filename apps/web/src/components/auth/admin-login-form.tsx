'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/button'
import { Field, Input } from '@repo/ui/input'
import { ShieldCheck } from '@repo/ui/icons'
import { useAdminLogin } from '@/hooks/use-admin-auth'
import { PasswordInput } from './password-input'

interface AdminLoginFormProps {
  emailLabel: string
  passwordLabel: string
  submitLabel: string
  pendingLabel: string
  defaultRedirectTo?: string
  showPasswordLabel?: string
  hidePasswordLabel?: string
}

export function AdminLoginForm({
  emailLabel,
  passwordLabel,
  submitLabel,
  pendingLabel,
  defaultRedirectTo = '/admin',
  showPasswordLabel,
  hidePasswordLabel,
}: AdminLoginFormProps) {
  const login = useAdminLogin()
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
      await login.mutateAsync({ email, password })
      // Hard navigation triggers the browser's "Save password?" prompt and
      // lets the password manager associate the saved credential with this
      // origin reliably (router.replace is a soft navigation that browsers
      // often don't detect as a successful login).
      window.location.assign(redirectTo)
    } catch {
      // Error already normalized by API layer.
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      name="admin-login"
      method="post"
      noValidate
    >
      <input type="hidden" name="redirectTo" value={defaultRedirectTo} />

      <Field label={emailLabel} required>
        <Input
          id="admin-email"
          name="email"
          type="email"
          required
          dir="ltr"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>

      <Field label={passwordLabel} required>
        <PasswordInput
          id="admin-password"
          name="password"
          required
          dir="ltr"
          autoComplete="current-password"
          toggleShowLabel={showPasswordLabel}
          toggleHideLabel={hidePasswordLabel}
        />
      </Field>

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
        leadingIcon={<ShieldCheck size={16} />}
        disabled={login.isPending}
      >
        {login.isPending ? pendingLabel : submitLabel}
      </Button>
    </form>
  )
}
