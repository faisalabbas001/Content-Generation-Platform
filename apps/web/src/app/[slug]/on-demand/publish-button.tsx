'use client'

/**
 * "Publish now" trigger for a delivered on-demand post.
 *
 * Calls the publishNow server action, which pushes the post to the brand's
 * connected Instagram channel via Postiz (type:'now' → immediate publish).
 *
 * Two visual modes (mirrors OnDemandDownloadButton):
 *   variant="icon"  → 32×32 overlay button on listing cards.
 *   variant="full"  → labeled button on the details page sidebar.
 *
 * Already-published posts render a static "Published" state instead of the
 * button (publish_status comes from calendar_posts via the server page).
 */

import { useState, useTransition } from 'react'
import { Button } from '@repo/ui/button'
import { Send, Loader2, CheckCircle2 } from '@repo/ui/icons'
import { cn } from '@repo/ui/cn'
import { publishNow, type PublishCode } from './actions'

export interface PublishLabels {
  publishNow: string
  publishing: string
  published: string
  success: string
  notConnected: string
  notReady: string
  failed: string
  confirm: string
}

interface Props {
  slug: string
  requestId: string
  labels: PublishLabels
  /** publish_status from calendar_posts — renders the static Published state. */
  alreadyPublished?: boolean
  /** Used on icon-variant card overlays so the click doesn't open the card link. */
  stopPropagation?: boolean
  variant?: 'icon' | 'full'
  className?: string
}

function messageFor(code: PublishCode, labels: PublishLabels): string {
  switch (code) {
    case 'published':         return labels.success
    case 'not_connected':     return labels.notConnected
    case 'not_ready':         return labels.notReady
    case 'already_published': return labels.published
    default:                  return labels.failed
  }
}

export function PublishNowButton({
  slug,
  requestId,
  labels,
  alreadyPublished,
  stopPropagation,
  variant = 'full',
  className,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const published = alreadyPublished || done

  function handleClick(e: React.MouseEvent) {
    if (stopPropagation) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (pending || published) return
    if (!window.confirm(labels.confirm)) return
    setMessage(null)
    startTransition(async () => {
      const res = await publishNow(slug, requestId)
      if (res.ok) {
        setDone(true)
        setIsError(false)
        setMessage(labels.success)
      } else if (res.code === 'already_published') {
        setDone(true)
        setIsError(false)
        setMessage(null)
      } else {
        setIsError(true)
        setMessage(messageFor(res.code, labels))
      }
    })
  }

  if (variant === 'icon') {
    if (published) {
      return (
        <span
          aria-label={labels.published}
          title={labels.published}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-(--r-md)',
            'bg-emerald-500/15 text-emerald-500 backdrop-blur-md shadow-(--shadow-1)',
            'border border-emerald-500/30',
            className,
          )}
        >
          <CheckCircle2 size={14} aria-hidden />
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={pending ? labels.publishing : labels.publishNow}
        title={pending ? labels.publishing : labels.publishNow}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-(--r-md)',
          'bg-(--bg)/80 text-(--fg) backdrop-blur-md shadow-(--shadow-1)',
          'border border-(--border-subtle) transition-colors duration-(--d-fast)',
          'hover:bg-(--bg) hover:border-(--border-default)',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)',
          'disabled:opacity-50 disabled:pointer-events-none',
          className,
        )}
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <Send size={14} aria-hidden />
        )}
      </button>
    )
  }

  if (published) {
    return (
      <div className={cn('flex flex-col items-stretch gap-1.5', className)}>
        <span className="inline-flex items-center justify-center gap-2 rounded-(--r-md) border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-500">
          <CheckCircle2 size={16} aria-hidden />
          {labels.published}
        </span>
        {message && !isError && (
          <p role="status" className="text-xs text-emerald-500">{message}</p>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col items-stretch gap-1.5', className)}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={pending}
        leadingIcon={pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      >
        {pending ? labels.publishing : labels.publishNow}
      </Button>
      {message && isError && (
        <p role="alert" className="text-xs text-red-400">{message}</p>
      )}
    </div>
  )
}
