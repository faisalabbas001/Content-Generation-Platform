'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@repo/ui/button'
import { Field, Input } from '@repo/ui/input'
import { Mail, CheckCircle2 } from '@repo/ui/icons'
import { useForgotPassword } from '@/hooks/use-auth'

interface ForgotPasswordFormProps {
  emailLabel: string
  submitLabel: string
  submittingLabel: string
  successTitle: string
  successBodyTemplate: string
  backToLoginLabel: string
  genericErrorLabel: string
}

export function ForgotPasswordForm({
  emailLabel,
  submitLabel,
  submittingLabel,
  successTitle,
  successBodyTemplate,
  backToLoginLabel,
  genericErrorLabel,
}: ForgotPasswordFormProps) {
  const forgot = useForgotPassword()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '').trim()
    if (!email) {
      setLocalError(genericErrorLabel)
      return
    }

    try {
      await forgot.mutateAsync({ email })
      setSentTo(email)
    } catch {
      setLocalError(genericErrorLabel)
    }
  }

  // Success state — never reveals whether the email actually exists.
  if (sentTo) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <div className="rounded-(--r-md) border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="mt-0.5 text-emerald-400 shrink-0" aria-hidden="true" />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-(--fg)">{successTitle}</p>
              <p className="text-xs text-(--fg-muted) leading-relaxed">
                {successBodyTemplate.replace('{{email}}', sentTo)}
              </p>
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-(--fg-muted)">
          <Link href="/login" className="font-medium text-(--accent) hover:underline">
            ← {backToLoginLabel}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label={emailLabel} required>
        <Input
          id="forgot-email"
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

      {localError && (
        <p
          className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)"
          role="alert"
        >
          {localError}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        leadingIcon={<Mail size={16} />}
        disabled={forgot.isPending}
      >
        {forgot.isPending ? submittingLabel : submitLabel}
      </Button>

      <p className="text-center text-xs text-(--fg-muted)">
        <Link href="/login" className="font-medium text-(--accent) hover:underline">
          ← {backToLoginLabel}
        </Link>
      </p>
    </form>
  )
}
