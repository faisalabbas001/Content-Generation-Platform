'use client'

/**
 * Client-side download trigger for an on-demand post image.
 *
 * Why fetch + blob instead of a plain `<a download>`:
 *   The image lives on Supabase Storage / a CDN (cross-origin). The browser
 *   ignores the `download` attribute on cross-origin links, so clicking it
 *   would just open the image in a new tab. Going through our own
 *   `/api/posts/on-demand/:id/download` route fixes that — same-origin AND
 *   the API forces `Content-Disposition: attachment`.
 *
 * Two visual modes:
 *   variant="icon"  → 32×32 button, used as an overlay on listing cards.
 *   variant="full"  → labeled button, used on the details page.
 */

import { useState } from 'react'
import { Button } from '@repo/ui/button'
import { Download, Loader2 } from '@repo/ui/icons'
import { cn } from '@repo/ui/cn'

interface Props {
  requestId: string
  /** Disable the button (e.g. while the post is still generating). */
  disabled?: boolean
  /** Visible label for the full variant; aria-label for the icon variant. */
  label: string
  /** Used on icon-variant card overlays so the click doesn't open the link. */
  stopPropagation?: boolean
  variant?: 'icon' | 'full'
  className?: string
}

export function OnDemandDownloadButton({
  requestId,
  disabled,
  label,
  stopPropagation,
  variant = 'full',
  className,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(e: React.MouseEvent) {
    if (stopPropagation) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (busy || disabled) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/posts/on-demand/${requestId}/download`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const filename = parseFilename(res.headers.get('content-disposition'))
        ?? `openclaw-${requestId.slice(0, 8)}.jpg`

      // Trigger the browser download via an in-memory object URL.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Give the browser a tick to start the save before we revoke.
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download_failed')
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        aria-label={label}
        title={label}
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
        {busy ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <Download size={14} aria-hidden />
        )}
      </button>
    )
  }

  return (
    <div className={cn('flex flex-col items-stretch gap-1.5', className)}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        leadingIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      >
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Extract `filename="…"` (or RFC 5987 `filename*=UTF-8''…`) from a
 * Content-Disposition header. Falls back to null when it can't.
 */
function parseFilename(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star) {
    try { return decodeURIComponent(star[1]) } catch { /* fall through */ }
  }
  const plain = /filename="?([^"]+)"?/i.exec(header)
  return plain ? plain[1] : null
}
