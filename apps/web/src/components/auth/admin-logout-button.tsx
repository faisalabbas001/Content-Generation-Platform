'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { LogOut } from '@repo/ui/icons'
import { useAdminLogout } from '@/hooks/use-admin-auth'

export function AdminLogoutButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const router = useRouter()
  const logout = useAdminLogout()

  async function onClick() {
    try {
      await logout.mutateAsync()
    } finally {
      router.replace('/admin-access')
      router.refresh()
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      leadingIcon={<LogOut size={14} />}
      disabled={logout.isPending}
      onClick={onClick}
    >
      {logout.isPending ? pendingLabel : label}
    </Button>
  )
}
