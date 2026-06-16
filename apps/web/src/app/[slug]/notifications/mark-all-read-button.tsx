'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { markAllRead } from './actions'

export function MarkAllReadButton({
  slug,
  label,
}: {
  slug: string
  label: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markAllRead(slug)
          router.refresh()
        })
      }
    >
      {pending ? '...' : label}
    </Button>
  )
}
