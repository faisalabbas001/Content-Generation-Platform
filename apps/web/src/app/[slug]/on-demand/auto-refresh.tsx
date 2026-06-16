'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Silently refreshes server data every `intervalMs` while any card is in an
 * active state (generating → delivering) or held (waiting for admin approval
 * → V01 runs after admin approves). Stops as soon as no active cards remain.
 */
export function AutoRefresh({
  hasActiveCards,
  intervalMs = 8000,
}: {
  hasActiveCards: boolean
  intervalMs?: number
}) {
  const router = useRouter()

  useEffect(() => {
    if (!hasActiveCards) return
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [hasActiveCards, intervalMs, router])

  return null
}
