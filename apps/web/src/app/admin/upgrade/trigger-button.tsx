'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'

export function TriggerFlowButton({ flow, label }: { flow: 'D02' | 'A05'; label: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function trigger() {
    startTransition(async () => {
      const res = await fetch('/api/admin/maintenance/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flow }),
      })
      if (res.headers.get('content-type')?.includes('text/html')) {
        alert('Session expired — please refresh the page and log in again.')
        return
      }
      let json: { ok: boolean; message?: string; error?: string; detail?: string }
      try {
        json = await res.json()
      } catch {
        alert('Unexpected response from server — please refresh and try again.')
        return
      }
      if (!json.ok) {
        alert(`Failed to trigger ${flow}: ${json.error ?? json.detail ?? 'unknown error'}`)
        return
      }
      alert(json.message ?? `${flow} triggered — check Flows page for status`)
      router.refresh()
    })
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={trigger}>
      {pending ? 'Triggering…' : label}
    </Button>
  )
}
