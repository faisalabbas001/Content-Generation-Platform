'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@repo/ui/button'
import { Field, Input } from '@repo/ui/input'
import { ArrowUpRight } from '@repo/ui/icons'
import { useSignup } from '@/hooks/use-auth'
import { PasswordInput } from './password-input'

interface SignupFormProps {
  fullNameLabel: string
  emailLabel: string
  passwordLabel: string
  submitLabel: string
  pendingLabel: string
  successLabel: string
  defaultRedirectTo: string
  showPasswordLabel?: string
  hidePasswordLabel?: string
}

export function SignupForm({
  fullNameLabel,
  emailLabel,
  passwordLabel,
  submitLabel,
  pendingLabel,
  successLabel,
  defaultRedirectTo,
  showPasswordLabel,
  hidePasswordLabel,
}: SignupFormProps) {
  const router = useRouter()
  const signup = useSignup()
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)
    setSuccessMessage(null)

    const formData = new FormData(event.currentTarget)
    const fullName = String(formData.get('fullName') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    const redirectTo = String(formData.get('redirectTo') ?? defaultRedirectTo)

    if (!fullName || !email || !password) {
      setLocalError('Please complete all required fields.')
      return
    }

    try {
      const result = await signup.mutateAsync({ fullName, email, password })
      if (result.message) {
        setSuccessMessage(successLabel)
        return
      }
      router.replace(result.redirectTo ?? redirectTo)
      router.refresh()
    } catch {
      // Error message already normalized by the hook.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="redirectTo" value={defaultRedirectTo} />

      <Field label={fullNameLabel} required>
        <Input name="fullName" required autoComplete="name" />
      </Field>

      <Field label={emailLabel} required>
        <Input name="email" type="email" required dir="ltr" placeholder="name@example.com" />
      </Field>

      <Field label={passwordLabel} required>
        <PasswordInput
          name="password"
          required
          minLength={8}
          dir="ltr"
          autoComplete="new-password"
          toggleShowLabel={showPasswordLabel}
          toggleHideLabel={hidePasswordLabel}
        />
      </Field>

      {(localError || signup.error) && (
        <p className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)" role="alert">
          {localError ?? signup.error}
        </p>
      )}

      {successMessage && (
        <p className="rounded-(--r-sm) border border-(--accent)/30 bg-(--accent-soft) px-3 py-2 text-sm text-(--fg)" role="status">
          {successMessage}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        trailingIcon={<ArrowUpRight size={16} />}
        disabled={signup.isPending}
      >
        {signup.isPending ? pendingLabel : submitLabel}
      </Button>
    </form>
  )
}
