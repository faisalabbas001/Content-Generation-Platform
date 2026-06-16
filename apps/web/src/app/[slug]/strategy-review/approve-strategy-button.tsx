'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { approveStrategy } from './actions'

export function ApproveStrategyButton({ brandId, slug }: { brandId: string; slug: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveStrategy(brandId, slug)
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong')
        return
      }
      router.push(`/${slug}/dashboard`)
    })
  }

  return (
    <div className="w-full space-y-2">
      <Button onClick={handleApprove} disabled={pending} className="w-full justify-center">
        {pending ? 'Approving…' : 'Approve & Generate ✓'}
      </Button>
      {error && <p className="text-xs text-(--danger)">{error}</p>}
    </div>
  )
}
