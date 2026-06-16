'use client'

import { useState, useTransition } from 'react'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Button } from '@repo/ui/button'
import { Input } from '@repo/ui/input'
import { Badge } from '@repo/ui/badge'
import { banUser, resendInvite, deleteUser } from '@/app/admin/actions'

export function UserActionPanel({
  userId,
  userEmail,
  currentlyBanned,
  hasBrands,
}: {
  userId: string
  userEmail: string
  currentlyBanned: boolean
  hasBrands: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [banHours, setBanHours] = useState(168) // 7 days default
  const [confirmEmail, setConfirmEmail] = useState('')

  const fire = (label: string, fn: () => Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }>) => {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      setMsg(r.ok ? { ok: true, text: `✓ ${label} succeeded` } : { ok: false, text: `✗ ${label} failed: ${r.error ?? 'unknown'}` })
    })
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Admin actions</CardTitle>
        </div>
        {msg && <Badge tone={msg.ok ? 'success' : 'danger'} size="sm">{msg.text}</Badge>}
      </CardHeader>
      <CardBody className="space-y-5">
        {/* ── Suspend / unsuspend ──────────────────────────────────── */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-(--fg)">Suspension</div>
          <p className="text-xs text-(--fg-muted)">
            Banning a user prevents new sign-ins immediately and invalidates any
            active refresh tokens. Brand data is preserved.
          </p>
          {currentlyBanned ? (
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() => fire('unban', () => banUser({ user_id: userId, duration_hours: 0 }))}
            >
              {pending ? 'Working…' : 'Lift suspension'}
            </Button>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex w-full items-center gap-2 text-xs text-(--fg-muted) sm:w-auto">
                Duration:
                <select
                  className="flex-1 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 sm:flex-initial"
                  value={banHours}
                  onChange={(e) => setBanHours(parseInt(e.target.value, 10))}
                  disabled={pending}
                >
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days</option>
                  <option value={168}>7 days</option>
                  <option value={720}>30 days</option>
                  <option value={8760}>1 year</option>
                </select>
              </label>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => fire('ban', () => banUser({ user_id: userId, duration_hours: banHours }))}
                className="w-full sm:w-auto"
              >
                {pending ? 'Working…' : `Suspend for ${banHours}h`}
              </Button>
            </div>
          )}
        </div>

        {/* ── Resend confirmation email ─────────────────────────────── */}
        <div className="space-y-2 border-t border-(--border-subtle) pt-4">
          <div className="text-sm font-medium text-(--fg)">Email invite</div>
          <p className="text-xs text-(--fg-muted)">
            Sends a fresh sign-in link to <span className="font-mono text-(--fg)">{userEmail || '(no email)'}</span>. Useful when the
            user can&apos;t confirm or has lost their access link.
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || !userEmail}
            onClick={() => fire('resend invite', () => resendInvite({ user_id: userId }))}
          >
            {pending ? 'Sending…' : 'Resend invite'}
          </Button>
        </div>

        {/* ── Delete (with confirmation) ────────────────────────────── */}
        <div className="space-y-2 border-t border-(--border-subtle) pt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-(--danger)">Danger zone</span>
            {hasBrands && <Badge tone="danger" size="sm">cascades to brands</Badge>}
          </div>
          <p className="text-xs text-(--fg-muted)">
            Permanently delete this user. All owned brand_profiles rows and child data (calendars,
            posts, snapshots, evidence) cascade via FK. <strong>Prefer suspension</strong> unless this is
            a confirmed test account or PDPL deletion request.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              type="email"
              placeholder="Type the user's email to confirm"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              disabled={pending}
              className="w-full sm:w-72"
            />
            <Button
              size="sm"
              variant="danger"
              disabled={pending || !confirmEmail || confirmEmail !== userEmail}
              onClick={() => {
                if (!window.confirm(`Permanently delete ${userEmail}? This cascades to all brands.`)) return
                fire('delete user', () => deleteUser({ user_id: userId, confirm_email: confirmEmail }))
              }}
              className="w-full sm:w-auto"
            >
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
          {confirmEmail && confirmEmail !== userEmail && (
            <p className="text-xs text-(--danger-fg)">Email must match exactly to enable delete.</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
