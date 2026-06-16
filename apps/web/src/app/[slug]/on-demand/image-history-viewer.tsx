'use client'

/**
 * OnDemandImageViewer
 *
 * Shows the current (latest) generated image with a clickable version strip
 * at the bottom when previous revisions exist. Each revision stores its
 * old_image_url in calendar_posts.revision_history so all versions are
 * preserved in Supabase Storage.
 *
 * When a version thumbnail is clicked, calls setActiveCleanUrl from
 * RevisionProvider context so the sidebar CleanImageCard syncs to the same
 * revision's clean (no-overlay) variant.
 */

import { useState } from 'react'
import { Badge } from '@repo/ui/badge'
import { useRevision } from './on-demand-revision-context'

export interface RevisionEntry {
  revision_number: number
  old_image_url?: string | null
  old_clean_image_url?: string | null
  revised_at?: string | null
}

interface Props {
  /** Latest storage URL (with ?v= cache-buster from the server). */
  currentUrl: string
  /** Alt text for the image. */
  alt: string
  /** revision_history JSONB from calendar_posts. */
  revisionHistory: RevisionEntry[]
  /** Brand primary color for the overlay ring. */
  brandColor: string
  /** Clean (no-overlay) URL of the current/latest image — synced to sidebar when "Latest" is selected. */
  currentCleanUrl?: string | null
}

interface Version {
  url: string
  label: string
  tag: string
  cleanUrl: string | null
}

export function OnDemandImageViewer({ currentUrl, alt, revisionHistory, brandColor, currentCleanUrl }: Props) {
  const { setActiveCleanUrl } = useRevision()

  // Build ordered version list: oldest first, current last.
  const versions: Version[] = []
  revisionHistory.forEach((entry) => {
    if (entry.old_image_url) {
      const n = entry.revision_number - 1  // 0 = original before revision 1
      versions.push({
        url:      entry.old_image_url,
        label:    n === 0 ? 'Original' : `Rev ${n}`,
        tag:      n === 0 ? 'original' : `r${n}`,
        cleanUrl: entry.old_clean_image_url ?? null,
      })
    }
  })
  versions.push({ url: currentUrl, label: 'Latest', tag: 'latest', cleanUrl: currentCleanUrl ?? null })

  const [selected, setSelected] = useState<Version>(versions[versions.length - 1])

  function selectVersion(v: Version) {
    setSelected(v)
    setActiveCleanUrl(v.cleanUrl)
  }

  return (
    <div className="space-y-3">
      {/* ── Main image ──────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-(--r-md) border border-(--border-subtle)">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={selected.url}
          src={selected.url}
          alt={alt}
          className="h-auto w-full"
        />
      </div>

      {/* ── Version label ───────────────────────────────────────── */}
      {versions.length > 1 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-(--fg-muted)">
            Viewing: <span className="font-medium text-(--fg)">{selected.label}</span>
          </span>
          {selected.tag === 'latest' && (
            <Badge tone="success" size="sm">Current</Badge>
          )}
          {selected.tag !== 'latest' && (
            <Badge tone="neutral" size="sm">Older version</Badge>
          )}
        </div>
      )}

      {/* ── Thumbnail strip ─────────────────────────────────────── */}
      {versions.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {versions.map((v) => {
            const isActive = v.url === selected.url
            return (
              <button
                key={v.url}
                type="button"
                onClick={() => selectVersion(v)}
                title={v.label}
                className={[
                  'relative shrink-0 overflow-hidden rounded-(--r-sm) border-2 transition-all',
                  'h-16 w-16 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)',
                  isActive
                    ? 'border-(--accent) shadow-sm'
                    : 'border-(--border-subtle) opacity-60 hover:opacity-90 hover:border-(--border-default)',
                ].join(' ')}
                style={isActive ? { borderColor: brandColor } : {}}
                aria-label={`View ${v.label}`}
                aria-pressed={isActive}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.url}
                  alt={v.label}
                  className="h-full w-full object-cover"
                />
                <span
                  className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 text-center text-[9px] text-white leading-none"
                >
                  {v.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
