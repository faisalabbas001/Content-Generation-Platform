'use client'

import { useEffect } from 'react'
import { ErrorState } from '@repo/ui/error-state'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Admin error:', error)
  }, [error])

  return (
    <ErrorState
      title="Admin panel ran into an error"
      description="The data layer threw while rendering this view. Try again — if it persists, check the dev console."
      retryLabel="Try again"
      onRetry={() => reset()}
      hint={error.digest ? <span>ref · <code>{error.digest}</code></span> : null}
    />
  )
}
