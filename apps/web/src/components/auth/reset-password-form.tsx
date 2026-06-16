'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@repo/ui/button'
import { Field } from '@repo/ui/input'
import { ShieldCheck, CheckCircle2, AlertTriangle } from '@repo/ui/icons'
import { useResetPassword } from '@/hooks/use-auth'
import { exchangeRecoveryCode, signOut } from '@repo/auth/client'
import { PasswordInput } from './password-input'

interface ResetPasswordFormProps {
  passwordLabel: string
  confirmLabel: string
  submitLabel: string
  submittingLabel: string
  successTitle: string
  successBody: string
  goToLoginLabel: string
  mismatchLabel: string
  tooShortLabel: string
  invalidLinkLabel: string
  genericErrorLabel: string
  showPasswordLabel: string
  hidePasswordLabel: string
}

type Stage = 'verifying' | 'invalid' | 'ready' | 'success'

export function ResetPasswordForm({
  passwordLabel,
  confirmLabel,
  submitLabel,
  submittingLabel,
  successTitle,
  successBody,
  goToLoginLabel,
  mismatchLabel,
  tooShortLabel,
  invalidLinkLabel,
  genericErrorLabel,
  showPasswordLabel,
  hidePasswordLabel,
}: ResetPasswordFormProps) {
  const reset = useResetPassword()
  const [stage, setStage] = useState<Stage>('verifying')
  const [localError, setLocalError] = useState<string | null>(null)

  // ── Step 1: Exchange the URL `?code=…` for a session on mount ──────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorDesc = params.get('error_description')

    if (errorDesc || !code) {
      setStage('invalid')
      return
    }

    exchangeRecoveryCode(code)
      .then(() => setStage('ready'))
      .catch(() => setStage('invalid'))
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)

    const formData = new FormData(event.currentTarget)
    const password = String(formData.get('password') ?? '')
    const confirm = String(formData.get('confirm') ?? '')

    if (password.length < 8) {
      setLocalError(tooShortLabel)
      return
    }
    if (password !== confirm) {
      setLocalError(mismatchLabel)
      return
    }

    try {
      await reset.mutateAsync({ password })
      // Sign out the temporary recovery session — user must sign in fresh
      // with their new password (defense in depth).
      await signOut().catch(() => {})
      setStage('success')
    } catch {
      setLocalError(genericErrorLabel)
    }
  }

  // ── Verifying spinner ──────────────────────────────────────────────────────
  if (stage === 'verifying') {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--accent) border-t-transparent" aria-hidden="true" />
        <span className="sr-only">Verifying reset link…</span>
      </div>
    )
  }

  // ── Invalid / expired link ─────────────────────────────────────────────────
  if (stage === 'invalid') {
    return (
      <div className="space-y-4" role="alert">
        <div className="rounded-(--r-md) border border-(--danger)/30 bg-(--danger)/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 text-(--danger) shrink-0" aria-hidden="true" />
            <p className="text-sm text-(--fg)">{invalidLinkLabel}</p>
          </div>
        </div>
        <Link
          href="/forgot-password"
          className="block w-full text-center font-medium text-(--accent) hover:underline text-sm"
        >
          {goToLoginLabel} →
        </Link>
      </div>
    )
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (stage === 'success') {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <div className="rounded-(--r-md) border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="mt-0.5 text-emerald-400 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-(--fg)">{successTitle}</p>
              <p className="text-xs text-(--fg-muted)">{successBody}</p>
            </div>
          </div>
        </div>
        <Link
          href="/login"
          className="block w-full text-center font-medium text-(--accent) hover:underline text-sm"
        >
          {goToLoginLabel} →
        </Link>
      </div>
    )
  }

  // ── Ready: show password form ───────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label={passwordLabel} required>
        <PasswordInput
          id="new-password"
          name="password"
          required
          minLength={8}
          dir="ltr"
          autoComplete="new-password"
          toggleShowLabel={showPasswordLabel}
          toggleHideLabel={hidePasswordLabel}
        />
      </Field>

      <Field label={confirmLabel} required>
        <PasswordInput
          id="confirm-password"
          name="confirm"
          required
          minLength={8}
          dir="ltr"
          autoComplete="new-password"
          toggleShowLabel={showPasswordLabel}
          toggleHideLabel={hidePasswordLabel}
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
        leadingIcon={<ShieldCheck size={16} />}
        disabled={reset.isPending}
      >
        {reset.isPending ? submittingLabel : submitLabel}
      </Button>
    </form>
  )
}
