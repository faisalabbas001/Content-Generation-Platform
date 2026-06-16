'use client'

import { useEffect, useState, useCallback } from 'react'

export interface GalleryAsset {
  url: string
  name?: string
  mime?: string
  size?: number
}

interface LightboxProps {
  assets: GalleryAsset[]
  index: number
  onClose: () => void
}

function Lightbox({ assets, index: initialIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex)
  const asset = assets[index]
  const total = assets.length

  const prev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total])
  const next = useCallback(() => setIndex((i) => (i + 1) % total), [total])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')       onClose()
      if (e.key === 'ArrowLeft')    prev()
      if (e.key === 'ArrowRight')   next()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  // lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
        aria-label="Close"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>

      {/* Counter */}
      {total > 1 && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
          {index + 1} / {total}
        </div>
      )}

      {/* Prev */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev() }}
          className="absolute left-3 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition"
          aria-label="Previous image"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
      )}

      {/* Image */}
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={asset.url}
          src={asset.url}
          alt={asset.name ?? `asset-${index}`}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          draggable={false}
        />
        {asset.name && (
          <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 px-4 py-2 text-center text-xs text-white/80">
            {asset.name}
            {asset.size != null && <span className="ml-2 opacity-60">· {(asset.size / 1024).toFixed(0)} KB</span>}
          </div>
        )}
      </div>

      {/* Next */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next() }}
          className="absolute right-3 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition"
          aria-label="Next image"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
      )}
    </div>
  )
}

interface AssetGalleryProps {
  assets: GalleryAsset[]
  /** Grid columns class — default 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8' */
  gridClass?: string
}

export function AssetGallery({ assets, gridClass }: AssetGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const images = assets.filter((a) => !a.mime || a.mime.startsWith('image/'))
  const others  = assets.filter((a) => a.mime && !a.mime.startsWith('image/'))

  return (
    <>
      {images.length > 0 && (
        <div className={`grid gap-2 ${gridClass ?? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'}`}>
          {images.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="group relative aspect-square overflow-hidden rounded-(--r-sm) bg-(--surface-3) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
              aria-label={`View ${a.name ?? `image ${i + 1}`}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.name ?? `asset-${i}`}
                className="h-full w-full object-cover transition group-hover:scale-105"
                loading="lazy"
              />
              {/* Hover overlay */}
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
                <svg className="text-white opacity-0 transition group-hover:opacity-100 drop-shadow" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                </svg>
              </span>
            </button>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {others.map((a, i) => (
            <li key={i}>
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-(--r-sm) bg-(--surface-2) px-3 py-2 text-xs text-(--fg) hover:bg-(--surface-3)"
              >
                <span className="text-base">
                  {a.mime?.includes('pdf') ? '📄' : a.mime?.includes('video') ? '🎬' : '📎'}
                </span>
                <span className="truncate flex-1">{a.name ?? 'file'}</span>
                {a.size != null && <span className="shrink-0 text-(--fg-muted)">{(a.size / 1024).toFixed(0)} KB</span>}
              </a>
            </li>
          ))}
        </ul>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          assets={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}
