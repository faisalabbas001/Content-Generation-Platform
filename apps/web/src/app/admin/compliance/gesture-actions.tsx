'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { toggleGestureBlock } from '../actions'

export function GestureBlockToggle({
  gesture_key,
  is_active,
}: {
  gesture_key: string
  is_active: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="text-xs text-rose-500">{error}</span>}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await toggleGestureBlock({ gesture_key, is_active: !is_active })
            if (!r.ok) setError(r.error)
            else { setError(null); router.refresh() }
          })
        }
        title={is_active ? 'Deactivate — gate will no longer block this gesture' : 'Activate — gate will block this gesture'}
      >
        {pending ? '…' : is_active ? '⏸' : '▶'}
      </Button>
    </div>
  )
}
