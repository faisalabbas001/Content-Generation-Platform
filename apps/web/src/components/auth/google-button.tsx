'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/button'
import { signInWithOAuth } from '@repo/auth/client'

interface Props {
  label: string
  redirectTo?: string
}

export function GoogleAuthButton({ label, redirectTo }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setPending(true)
    try {
      await signInWithOAuth('google', redirectTo)
      // Browser is redirected by Supabase. If we land back here it's an error.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={onClick}
        disabled={pending}
        leadingIcon={
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.166 6.656 3.58 9 3.58z"
            />
          </svg>
        }
      >
        {pending ? '…' : label}
      </Button>
      {error && (
        <p className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-xs text-(--danger)" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
