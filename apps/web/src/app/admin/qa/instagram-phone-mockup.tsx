'use client'

import { useState, useRef, useEffect } from 'react'

interface InstagramPhoneMockupProps {
  storageUrl: string | null
  cleanUrl?: string | null
  isVideo: boolean
  captionAr?: string | null
  hashtags?: string[] | null
  brandName?: string | null
  brandLogoUrl?: string | null
  contentType?: string | null
  scheduledDate?: string | null
  onFullscreen?: (clean: boolean) => void
}

export function InstagramPhoneMockup({
  storageUrl,
  cleanUrl,
  isVideo,
  captionAr,
  hashtags,
  brandName,
  brandLogoUrl,
  contentType,
  scheduledDate,
  onFullscreen,
}: InstagramPhoneMockupProps) {
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [showClean, setShowClean] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const hasClean = !!(cleanUrl && cleanUrl !== storageUrl)
  const displayUrl = showClean ? (cleanUrl ?? storageUrl) : storageUrl

  const dateLabel = scheduledDate
    ? new Date(scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  const captionPreview = captionAr
    ? captionAr.length > 120 ? captionAr.slice(0, 120) + '…' : captionAr
    : null

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    function onTime() { setProgress(v!.duration ? (v!.currentTime / v!.duration) * 100 : 0) }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [isVideo])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) } else { v.pause(); setPlaying(false) }
  }

  // iPhone 15 Pro proportions: 393×852 screen → shell adds ~14px each side
  const W = 320
  const H = Math.round(W / 0.461) // ≈ 694

  return (
    <div className="flex flex-col items-center gap-4">

      {/* ── Arabic / Clean toggle ───────────────────────────────────── */}
      {hasClean && (
        <div className="flex rounded-xl border border-white/10 overflow-hidden text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setShowClean(false)}
            className={`px-4 py-1.5 transition-colors ${!showClean ? 'bg-white/15 text-white' : 'text-white/35 hover:text-white/60'}`}
          >
            With Arabic
          </button>
          <button
            type="button"
            onClick={() => setShowClean(true)}
            className={`px-4 py-1.5 transition-colors ${showClean ? 'bg-white/15 text-white' : 'text-white/35 hover:text-white/60'}`}
          >
            Clean
          </button>
        </div>
      )}

      {/* ── iPhone 15 Pro shell ─────────────────────────────────────── */}
      <div className="relative select-none" style={{ width: W, height: H }}>

        {/* Outer body — titanium gradient */}
        <div
          className="absolute inset-0 rounded-[54px]"
          style={{
            background: 'linear-gradient(160deg, #3a3a3c 0%, #1c1c1e 45%, #111113 100%)',
            boxShadow: [
              '0 60px 120px rgba(0,0,0,0.8)',
              '0 24px 48px rgba(0,0,0,0.55)',
              '0 0 0 1px rgba(255,255,255,0.10)',
              'inset 0 1.5px 0 rgba(255,255,255,0.16)',
              'inset 0 -1px 0 rgba(0,0,0,0.5)',
            ].join(','),
            zIndex: 10,
          }}
        />

        {/* Side buttons */}
        {/* Power (right) */}
        <div className="absolute rounded-r-sm" style={{ right: -3, top: 116, width: 3, height: 68, background: 'linear-gradient(to right, #111, #2a2a2c)', zIndex: 11 }} />
        {/* Silent (left) */}
        <div className="absolute rounded-l-sm" style={{ left: -3, top: 100, width: 3, height: 36, background: 'linear-gradient(to left, #111, #2a2a2c)', zIndex: 11 }} />
        {/* Volume up (left) */}
        <div className="absolute rounded-l-sm" style={{ left: -3, top: 148, width: 3, height: 62, background: 'linear-gradient(to left, #111, #2a2a2c)', zIndex: 11 }} />
        {/* Volume down (left) */}
        <div className="absolute rounded-l-sm" style={{ left: -3, top: 222, width: 3, height: 62, background: 'linear-gradient(to left, #111, #2a2a2c)', zIndex: 11 }} />

        {/* Screen cutout */}
        <div
          className="absolute overflow-hidden"
          style={{ inset: 8, borderRadius: 46, background: '#000', zIndex: 12 }}
        >
          {/* Dynamic Island */}
          <div
            className="absolute left-1/2 -translate-x-1/2 bg-black z-30"
            style={{ top: 12, width: 96, height: 28, borderRadius: 20, boxShadow: '0 0 0 1px rgba(255,255,255,0.07)' }}
          />

          {/* ── Screen content ─────────────────────────────────────────── */}
          <div className="absolute inset-0 overflow-hidden bg-black">

            {isVideo ? (
              /* ── VIDEO layout ──────────────────────────────────────── */
              <div className="absolute inset-0 cursor-pointer" onClick={togglePlay}>

                {/* Full-bleed video */}
                {displayUrl && (
                  <video
                    ref={videoRef}
                    src={displayUrl}
                    className="absolute inset-0 w-full h-full object-cover"
                    autoPlay
                    loop
                    muted={muted}
                    playsInline
                  />
                )}

                {/* Scrim top */}
                <div className="absolute top-0 inset-x-0 h-28 bg-gradient-to-b from-black/65 to-transparent pointer-events-none z-10" />
                {/* Scrim bottom */}
                <div className="absolute bottom-0 inset-x-0 h-56 bg-gradient-to-t from-black/92 via-black/50 to-transparent pointer-events-none z-10" />

                {/* Pause icon */}
                {!playing && (
                  <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="rounded-full bg-black/55 p-4 backdrop-blur-sm">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                  </div>
                )}

                {/* Mute pill */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMuted(m => !m) }}
                  className="absolute z-20 flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-sm px-2.5 py-1.5 opacity-80 hover:opacity-100 transition-opacity"
                  style={{ top: 52, right: 12 }}
                >
                  {muted
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  }
                  <span className="text-[9px] font-semibold text-white/80 leading-none">{muted ? 'Muted' : 'Live'}</span>
                </button>

                {/* Bottom: brand + caption + hashtags */}
                <div className="absolute bottom-4 inset-x-0 px-4 z-20 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full overflow-hidden shrink-0 ring-1 ring-white/30">
                      {brandLogoUrl
                        ? <img src={brandLogoUrl} alt={brandName ?? 'logo'} className="h-full w-full object-cover" draggable={false} />
                        : <div className="h-full w-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: 'linear-gradient(135deg, #f97316, #dc2626)' }}>
                            {(brandName ?? 'B').slice(0, 1).toUpperCase()}
                          </div>
                      }
                    </div>
                    <span className="text-[12px] font-bold text-white leading-tight truncate">{brandName ?? 'Brand'}</span>
                    {dateLabel && <span className="text-[9px] text-white/40 shrink-0">· {dateLabel}</span>}
                  </div>
                  {captionPreview && (
                    <p dir="rtl" className="text-[10px] text-white/85 leading-relaxed line-clamp-2">{captionPreview}</p>
                  )}
                  {hashtags && hashtags.length > 0 && (
                    <p className="text-[9px] text-sky-300/70 truncate">
                      {hashtags.slice(0, 4).map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}
                    </p>
                  )}
                </div>

                {/* Progress bar */}
                <div className="absolute bottom-0 inset-x-0 h-[2px] bg-white/15 z-20">
                  <div className="h-full bg-white/70 transition-all duration-150" style={{ width: `${progress}%` }} />
                </div>
              </div>

            ) : (
              /* ── IMAGE layout — Instagram feed post style ────────────
                 Layout: Dynamic Island gap → header → square image (object-contain)
                 → action row → caption/hashtags → flex-1 filler with subtle
                 gradient so the remaining screen space looks intentional.       */
              <div className="absolute inset-0 flex flex-col" style={{ background: '#0a0a0a' }}>

                {/* ── Header — pushed below Dynamic Island ─────────── */}
                <div style={{ paddingTop: 86 }} className="shrink-0 flex items-center gap-2.5 px-4 pb-5">
                  {/* Avatar with Instagram gradient ring + actual logo */}
                  <div className="h-10 w-10 rounded-full p-[2.5px] shrink-0" style={{ background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}>
                    <div className="h-full w-full rounded-full overflow-hidden bg-black p-[1.5px]">
                      {brandLogoUrl
                        ? <img src={brandLogoUrl} alt={brandName ?? 'logo'} className="h-full w-full rounded-full object-cover" draggable={false} />
                        : <div className="h-full w-full rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: 'linear-gradient(135deg, #f97316, #dc2626)' }}>
                            {(brandName ?? 'B').slice(0, 1).toUpperCase()}
                          </div>
                      }
                    </div>
                  </div>
                  {/* Name + content-type chip */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-[13px] font-bold text-white leading-tight truncate">{brandName ?? 'Brand'}</p>
                      {contentType && (
                        <span className="shrink-0 rounded bg-white/15 px-2 py-0.5 text-[9px] font-bold text-white/70 uppercase tracking-wider leading-none">
                          {contentType}
                        </span>
                      )}
                    </div>
                    {dateLabel && <p className="text-[10px] text-white/40 leading-tight mt-0.5">{dateLabel}</p>}
                  </div>
                  {/* 3-dot */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white" opacity={0.35} className="shrink-0"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                </div>

                {/* ── Square image — object-contain, full post visible ── */}
                <div className="shrink-0 w-full bg-black" style={{ aspectRatio: '1 / 1' }}>
                  {displayUrl
                    ? <img src={displayUrl} alt="Post" className="w-full h-full object-contain" draggable={false} />
                    : <div className="w-full h-full flex items-center justify-center">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1} opacity={0.2}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                      </div>
                  }
                </div>

                {/* ── Action row (like / comment / share / save) ─────── */}
                <div className="shrink-0 flex items-center justify-between px-3.5 pt-2.5 pb-1.5">
                  <div className="flex items-center gap-3.5">
                    {/* Heart */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.8} opacity={0.7}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    {/* Comment */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.8} opacity={0.7}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    {/* Share */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.8} opacity={0.7}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </div>
                  {/* Bookmark */}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.8} opacity={0.7}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </div>

                {/* ── Caption + hashtags ─────────────────────────────── */}
                <div className="shrink-0 px-3.5 pb-3 space-y-2">
                  {captionAr && (
                    <p dir="rtl" className="text-[13px] text-white/90 leading-[1.55] line-clamp-4">
                      <span className="font-bold text-white ml-1">{brandName ?? 'brand'}</span>
                      {captionPreview}
                    </p>
                  )}
                  {hashtags && hashtags.length > 0 && (
                    <p className="text-[12px] text-sky-300/80 leading-relaxed">
                      {hashtags.slice(0, 6).map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}
                    </p>
                  )}
                </div>

                {/* ── Filler — fills remaining screen with subtle gradient ── */}
                <div className="flex-1" style={{ background: 'linear-gradient(to bottom, #0a0a0a 0%, #111 60%, #0d0d0d 100%)' }}>
                  <div className="mx-3.5 mt-3 h-px bg-white/5 rounded-full" />
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Home indicator */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-white/22" style={{ bottom: 9, width: 104, height: 4, zIndex: 15 }} />
      </div>

      {/* ── Fullscreen button ───────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onFullscreen?.(showClean)}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/6 hover:bg-white/12 px-3.5 py-1.5 text-[11px] font-semibold text-white/45 hover:text-white/80 transition-all"
        title="Fullscreen (F)"
      >
        <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
        Fullscreen
      </button>
    </div>
  )
}
