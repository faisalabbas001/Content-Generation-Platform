'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@repo/ui/button'
import { LogOut } from '@repo/ui/icons'
import { signOut } from '@repo/auth/client'

interface Props {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'ghost' | 'secondary' | 'primary'
  redirectTo?: string
  className?: string
}

export function LogoutButton({
  label = 'Sign out',
  size = 'sm',
  variant = 'ghost',
  redirectTo = '/',
  className,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      try {
        await signOut()
      } finally {
        router.replace(redirectTo)
        router.refresh()
      }
    })
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={pending}
      leadingIcon={<LogOut size={14} />}
      className={className}
    >
      {pending ? '…' : label}
    </Button>
  )
}
