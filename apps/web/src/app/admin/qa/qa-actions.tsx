'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { approveQaItem, rejectQaItem } from '@/app/actions/qa'
import { releaseCalendarPosts, rejectCalendar } from './release-actions'

type ConfirmType = 'approve' | 'reject'

export function QaActionButtons({
  queueId,
  approveLabel,
  rejectLabel,
  confirmApprove,
  confirmReject,
}: {
  queueId: string
  approveLabel: string
  rejectLabel: string
  confirmApprove: { title: string; body: string; confirm: string; cancel: string }
  confirmReject: { title: string; body: string; confirm: string; cancel: string }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmType, setConfirmType] = useState<ConfirmType | null>(null)

  function confirm() {
    if (!confirmType) return
    const fn = confirmType === 'approve' ? approveQaItem : rejectQaItem
    startTransition(async () => {
      const res = await fn(queueId)
      setConfirmType(null)
      if (res.ok) {
        router.refresh()
      } else {
        // eslint-disable-next-line no-console
        console.error('[qa-actions]', res.error)
      }
    })
  }

  const modal = confirmType === 'approve' ? confirmApprove : confirmType === 'reject' ? confirmReject : null

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => setConfirmType('reject')}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          {rejectLabel}
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => setConfirmType('approve')}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {approveLabel}
        </Button>
      </div>

      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!pending) setConfirmType(null) }}
          />

          {/* Modal card */}
          <div className="relative w-full max-w-lg rounded-(--r-xl) border border-(--border-subtle) bg-(--surface-1) shadow-2xl">
            {/* Header stripe */}
            <div
              className={`h-1.5 w-full rounded-t-(--r-xl) ${
                confirmType === 'approve' ? 'bg-(--accent)' : 'bg-red-500'
              }`}
            />

            <div className="p-8">
              {/* Icon */}
              <div
                className={`mb-5 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
                  confirmType === 'approve'
                    ? 'bg-(--accent)/15 text-(--accent)'
                    : 'bg-red-500/15 text-red-400'
                }`}
              >
                {confirmType === 'approve' ? '✓' : '✕'}
              </div>

              <h2 className="text-xl font-semibold text-(--fg)">{modal.title}</h2>
              <p className="mt-3 text-base leading-relaxed text-(--fg-muted)">{modal.body}</p>

              <div className="mt-8 flex justify-end gap-3">
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setConfirmType(null)}
                >
                  {modal.cancel}
                </Button>
                <Button
                  variant={confirmType === 'reject' ? 'danger' : 'primary'}
                  disabled={pending}
                  onClick={confirm}
                >
                  {pending ? '…' : modal.confirm}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function ReleaseCalendarButton({
  calendarId,
  count,
}: {
  calendarId: string
  count: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [released, setReleased] = useState<number | null>(null)

  function handleRelease() {
    startTransition(async () => {
      const result = await releaseCalendarPosts(calendarId)
      if (result.ok && (result.count ?? 0) > 0) {
        setReleased(result.count ?? 0)
        router.refresh()
      } else if (result.ok && result.count === 0) {
        alert('No posts were updated — they may already be released or in an unexpected status.')
      } else {
        alert(result.error ?? 'Release failed')
      }
    })
  }

  if (released !== null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        {released} posts released to clients
      </span>
    )
  }

  return (
    <button
      onClick={handleRelease}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-emerald-400 hover:text-white transition-colors disabled:opacity-40"
    >
      {isPending ? (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      )}
      Approve &amp; Release ({count})
    </button>
  )
}

/**
 * Put a whole calendar on hold. Switches the client /calendar page to the
 * 'rejected' state and surfaces the reason. Compact inline reason capture.
 */
export function RejectCalendarButton({ calendarId }: { calendarId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  function handleReject() {
    if (reason.trim().length < 5) return
    startTransition(async () => {
      const res = await rejectCalendar(calendarId, reason.trim())
      if (res.ok) {
        setOpen(false)
        setReason('')
        router.refresh()
      } else {
        alert(res.error ?? 'Reject failed')
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Hold
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason shown to client…"
        className="w-56 rounded-lg border border-(--border-subtle) bg-(--surface-1) px-3 py-1.5 text-xs text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-1 focus:ring-red-500/40"
      />
      <button
        onClick={handleReject}
        disabled={isPending || reason.trim().length < 5}
        className="rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-600 hover:text-white transition-colors disabled:opacity-40"
      >
        {isPending ? '…' : 'Confirm hold'}
      </button>
      <button
        onClick={() => { setOpen(false); setReason('') }}
        disabled={isPending}
        className="text-xs text-(--fg-muted) hover:text-(--fg) transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
