'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Card, CardBody } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'

type StepStatus = 'done' | 'running' | 'pending'

interface Step {
  label: string
  sub?: string
}

interface Strings {
  statusDone: string
  statusRunning: string
  statusPending: string
  timeout: string
  footer: string
}

interface ProcessingTrackerProps {
  brandId: string
  slug: string
  steps: Step[]
  strings: Strings
}

/**
 * Watches brand_snapshots via Supabase Realtime (doc §8.3).
 *
 * Step progression:
 *   Start     → steps 0+1 marked done (form received, scrape started)
 *   is_partial INSERT → step 2 done, step 3 running  (COO finished BrandDNA v0.1)
 *   full INSERT       → all done → redirect to /snapshot
 *   10-min timeout    → show error + contact link (doc §8.3 requirement)
 */
export function ProcessingTracker({ brandId, slug, steps, strings }: ProcessingTrackerProps) {
  const router = useRouter()
  // stepsDone = how many steps are complete. Steps 0+1 are done the moment
  // the user lands here (form submitted, scrape running).
  const [stepsDone, setStepsDone] = useState(2)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    const channel = supabase
      .channel(`brand_snapshot_${brandId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'brand_snapshots',
          filter: `brand_id=eq.${brandId}`,
        },
        (payload) => {
          const isPartial = payload.new?.is_partial as boolean

          if (isPartial) {
            // Partial snapshot ready (60s mark) — COO done, CEO now running
            setStepsDone(3)
          } else {
            // Full snapshot ready — go to strategy review (spec §3.2 Step 8)
            // Client approves strategy before calendar generation starts.
            setStepsDone(5)
            router.push(`/${slug}/strategy-review`)
          }
        },
      )
      .subscribe()

    // 10-minute timeout — doc §8.3: show error and notify admin
    const timeout = setTimeout(() => {
      setTimedOut(true)
      // Notify admin via the anomaly API so N8N-S03 can route the alert
      fetch('/api/webhooks/n8n', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'processing_timeout',
          payload: { brand_id: brandId, slug },
        }),
      }).catch(() => {})
    }, 10 * 60 * 1000)

    return () => {
      supabase.removeChannel(channel)
      clearTimeout(timeout)
    }
  }, [brandId, slug, router])

  const statusFor = (index: number): StepStatus => {
    if (index < stepsDone) return 'done'
    if (index === stepsDone) return 'running'
    return 'pending'
  }

  const toneFor = (s: StepStatus) =>
    s === 'done' ? 'success' : s === 'running' ? 'accent' : 'outline'

  const labelFor = (s: StepStatus) =>
    s === 'done' ? strings.statusDone : s === 'running' ? strings.statusRunning : strings.statusPending

  if (timedOut) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm font-medium text-(--fg)">{strings.timeout}</p>
          <a
            href="mailto:support@ogz.studio"
            className="text-xs text-(--accent) underline underline-offset-2"
          >
            support@ogz.studio
          </a>
        </CardBody>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardBody className="p-0">
          <ol>
            {steps.map((s, i) => {
              const status = statusFor(i)
              return (
                <li
                  key={i}
                  className={`oc-mount oc-stagger-${Math.min(i + 1, 4)} flex items-center gap-4 border-b border-(--border-subtle) px-6 py-4 last:border-b-0`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-medium ${
                      status === 'done'
                        ? 'bg-(--success-soft) text-(--success)'
                        : status === 'running'
                        ? 'bg-(--accent-soft) text-(--accent)'
                        : 'bg-(--surface-3) text-(--fg-faint)'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-(--fg)">{s.label}</div>
                    {s.sub && (
                      <div className="mt-0.5 text-xs text-(--fg-muted)">{s.sub}</div>
                    )}
                  </div>
                  <Badge tone={toneFor(status)} dot={status === 'running'}>
                    {labelFor(status)}
                  </Badge>
                </li>
              )
            })}
          </ol>
        </CardBody>
      </Card>

      <div className="mt-5 rounded-(--r-md) border border-dashed border-(--border-default) bg-(--surface-1) px-4 py-3 text-xs text-(--fg-muted)">
        {strings.footer.split('{table}').map((part, i, arr) => (
          <span key={i}>
            {part}
            {i < arr.length - 1 && (
              <span className="font-mono text-(--fg-subtle)">brand_snapshots</span>
            )}
          </span>
        ))}
      </div>
    </>
  )
}
