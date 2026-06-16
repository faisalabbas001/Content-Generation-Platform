'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Image preview that can toggle between the final (overlay-applied) version and
 * the clean (pre-overlay) version when both URLs are available.
 *
 * Default: fills full panel width at the image's natural aspect ratio.
 * `fill`: fills a fixed-size parent frame with object-contain — every version
 * (square original, landscape regen, …) occupies the identical frame instead of
 * resizing the panel to its own aspect ratio.
 *
 * Clicking the image opens a full-screen lightbox (zoom view) so admins can
 * inspect generation detail at full resolution. The final/clean toggle is
 * available both inline and inside the lightbox.
 */
export function ImagePreviewToggle({
  finalSrc,
  cleanSrc,
  fill = false,
}: {
  finalSrc: string | null
  cleanSrc: string | null
  fill?: boolean
}) {
  const [showClean, setShowClean] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const hasToggle = !!finalSrc && !!cleanSrc
  const activeSrc = showClean && cleanSrc ? cleanSrc : (finalSrc ?? cleanSrc)

  // Lightbox: close on Escape, lock background scroll while open.
  useEffect(() => {
    if (!zoomed) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setZoomed(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [zoomed])

  if (!activeSrc) return null

  const versionLabel = showClean ? 'Clean (pre-overlay) version' : 'Final (with overlay) version'

  // Render-helper (not a component) so the final/clean toggle can appear both
  // inline and inside the lightbox without re-declaring a component in render.
  function renderToggle(className: string) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShowClean((v) => !v) }}
        className={className}
        title={showClean ? 'Showing clean version — click to see final with overlay' : 'Showing final version — click to see clean (pre-overlay)'}
      >
        {showClean ? (
          <>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Clean
          </>
        ) : (
          <>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
            Final
          </>
        )}
      </button>
    )
  }

  return (
    <div className={fill ? 'group absolute inset-0' : 'group relative'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={activeSrc}
        alt={versionLabel}
        onClick={() => setZoomed(true)}
        className={[
          'cursor-zoom-in',
          fill ? 'h-full w-full object-cover' : 'block w-full',
        ].join(' ')}
      />

      {/* Expand affordance — bottom-left, appears on hover */}
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label="Open full-screen viewer"
        className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80 opacity-0 backdrop-blur-sm transition-all hover:bg-black/80 group-hover:opacity-100"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
        Expand
      </button>

      {hasToggle && renderToggle([
        'absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm transition-all',
        showClean
          ? 'bg-white/25 text-white ring-1 ring-white/30 hover:bg-white/35'
          : 'bg-black/60 text-white/80 hover:bg-black/80',
      ].join(' '))}

      {/* ── Full-screen lightbox ──────────────────────────────────── */}
      {zoomed && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
        >
          {/* Close */}
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close viewer"
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Final/Clean toggle inside the lightbox */}
          {hasToggle && renderToggle([
            'absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider backdrop-blur-sm transition-all',
            showClean
              ? 'bg-white/25 text-white ring-1 ring-white/30 hover:bg-white/35'
              : 'bg-white/10 text-white/80 ring-1 ring-white/15 hover:bg-white/20',
          ].join(' '))}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeSrc}
            alt={versionLabel}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] max-w-[94vw] cursor-default rounded-lg object-contain shadow-2xl"
          />

          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/45">
            Click outside or press Esc to close
          </p>
        </div>,
        document.body,
      )}
    </div>
  )
}
