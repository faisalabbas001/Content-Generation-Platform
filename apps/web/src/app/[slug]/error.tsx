'use client'

import { useEffect } from 'react'
import { ErrorState } from '@repo/ui/error-state'

export default function ClientError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Client app error:', error)
  }, [error])

  return (
    <ErrorState
      title="We couldn't load this page"
      description="Something went wrong fetching your brand data. Try again."
      retryLabel="Try again"
      onRetry={() => reset()}
      hint={error.digest ? <span>ref · <code>{error.digest}</code></span> : null}
    />
  )
}
