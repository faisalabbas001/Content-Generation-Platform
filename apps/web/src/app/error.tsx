'use client'

import { useEffect } from 'react'
import { ErrorState } from '@repo/ui/error-state'
import { LinkButton } from '@repo/ui/button'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Hook for Sentry/PostHog if added later.
    if (typeof console !== 'undefined') console.error('App error:', error)
  }, [error])

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <ErrorState
        title="Something went wrong"
        description="An unexpected error occurred while loading this page. Try again, or head back to the home page."
        retryLabel="Try again"
        onRetry={() => reset()}
        hint={error.digest ? <span>Reference: <code>{error.digest}</code></span> : null}
      />
      <div className="mt-6 flex justify-center">
        <LinkButton href="/" variant="ghost" size="sm">Go home</LinkButton>
      </div>
    </main>
  )
}
