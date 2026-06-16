'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

/**
 * Live-refreshes the /calendar server component when the brand's calendar or its
 * posts change — e.g. OGZ admin releases posts, an image finishes generating, or
 * a calendar is put on hold. Mirrors the realtime pattern in post-actions.tsx.
 *
 * Uses the public anon client (the browser session authenticates it, so RLS
 * scopes events to this brand). Debounced so a batch release fires one refresh.
 */
export function CalendarRealtime({
  brandId,
  calendarId,
}: {
  brandId: string
  calendarId?: string
}) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) return

    const supabase = createClient(url, anon)

    function scheduleRefresh() {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => router.refresh(), 400)
    }

    const channel = supabase.channel(`calendar-live-${brandId}`)

    // Post-level changes: status flip on release, image url set, publish status…
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calendar_posts', filter: `brand_id=eq.${brandId}` },
      scheduleRefresh,
    )

    // Calendar-level lifecycle: generating → pending_review → delivered / rejected
    if (calendarId) {
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calendars', filter: `calendar_id=eq.${calendarId}` },
        scheduleRefresh,
      )
    }

    channel.subscribe()

    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [brandId, calendarId, router])

  return null
}
