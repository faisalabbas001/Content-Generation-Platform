'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markAllAlertsRead } from './actions'

export function MarkAlertsReadButton({ brandId }: { brandId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      await markAllAlertsRead(brandId)
      router.refresh()
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="text-xs text-(--fg-muted) hover:text-(--fg) hover:underline disabled:opacity-50"
    >
      {pending ? 'جاري التحديث…' : 'تحديد الكل كمقروء'}
    </button>
  )
}
