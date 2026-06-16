'use client'

/**
 * Sidebar card on the on-demand details page showing the pre-overlay
 * (no Arabic text) variant of the generated image. Lets the user
 * download a text-free copy for editorial reuse.
 *
 * Reads activeCleanUrl from RevisionProvider context so the displayed image
 * automatically syncs when the user clicks a revision thumbnail in the viewer.
 *
 * Shows a placeholder when no clean URL is available — that's the case for
 * posts created before migration 0036, or when the best-effort clean upload
 * failed inside the image pipeline.
 *
 * Download routes through /api/posts/on-demand/:id/download-clean so we
 * (a) force a Content-Disposition attachment instead of opening in-browser,
 * (b) stay same-origin around cross-origin Supabase Storage CDN URLs.
 */

import { useState } from 'react'
import { Button } from '@repo/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Download, Loader2 } from '@repo/ui/icons'
import { useRevision } from './on-demand-revision-context'

interface Props {
  requestId: string
  /** Alt text for the thumbnail (usually the hero concept). */
  alt: string
}

export function CleanImageCard({ requestId, alt }: Props) {
  const { activeCleanUrl } = useRevision()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/posts/on-demand/${requestId}/download-clean`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const filename = parseFilename(res.headers.get('content-disposition'))
        ?? `openclaw-${requestId.slice(0, 8)}-clean.jpg`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image without text</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {activeCleanUrl ? (
          <>
            <div className="overflow-hidden rounded-(--r-sm) border border-(--border-subtle)">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={activeCleanUrl}
                src={activeCleanUrl}
                alt={`${alt} — without text overlay`}
                className="h-auto w-full"
                loading="lazy"
              />
            </div>
            <p className="text-[11px] text-(--fg-muted) leading-relaxed">
              The same generated image without the Arabic typography overlay. Useful when you want
              to add your own copy or repurpose the visual editorially.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={handleDownload}
              disabled={busy}
              leadingIcon={
                busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />
              }
            >
              {busy ? 'Downloading…' : 'Download clean image'}
            </Button>
            {error && (
              <p role="alert" className="text-xs text-(--danger)">
                Download failed: {error}
              </p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-(--fg-muted) leading-relaxed italic">
            The clean image variant will be available after the next generation. Regenerate the
            post to produce one.
          </p>
        )}
      </CardBody>
    </Card>
  )
}

function parseFilename(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star) {
    try { return decodeURIComponent(star[1]) } catch { /* fall through */ }
  }
  const plain = /filename="?([^"]+)"?/i.exec(header)
  return plain ? plain[1] : null
}
