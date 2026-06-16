'use client'

import { useRef, useState } from 'react'
import { Play } from '@repo/ui/icons'

/**
 * Video preview tile for the on-demand card grid.
 *
 * Plays only while the user hovers (or focuses) the card — on pointer leave it
 * pauses and rewinds to the first frame, so idle cards stay a still poster and
 * the page never runs N autoplaying clips at once. A centred play badge is shown
 * whenever the clip is paused, signalling "this is a video — hover to play".
 *
 * The element is intentionally non-interactive (tabIndex=-1, aria-hidden, no
 * native controls): the whole card is wrapped in a <Link>, and controls would
 * intercept the click. Keyboard/focus play is driven from the parent card via
 * group-hover, so we react to pointer + the synthetic focus/blur that bubbles.
 */
export function VideoCardPreview({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  function start() {
    const el = ref.current
    if (!el) return
    // play() returns a promise that rejects if interrupted (e.g. fast hover in/out).
    // Swallow it — the pause in stop() is the source of truth.
    void el.play().catch(() => {})
  }

  function stop() {
    const el = ref.current
    if (!el) return
    el.pause()
    el.currentTime = 0
  }

  return (
    <div
      className="relative aspect-square w-full bg-black"
      onMouseEnter={start}
      onMouseLeave={stop}
      onFocus={start}
      onBlur={stop}
    >
      <video
        ref={ref}
        // #t=0.001 forces first-frame paint with preload="metadata" — without
        // it some browsers leave the tile black until the first play.
        src={`${src}#t=0.001`}
        preload="metadata"
        loop
        muted
        playsInline
        tabIndex={-1}
        aria-hidden
        className="h-full w-full object-cover"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {/* Centred play badge — visible whenever the clip is paused. Fades out
          while it plays so the moving frame is unobstructed. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
          playing ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm ring-1 ring-white/20">
          <Play size={22} className="ms-0.5 fill-white text-white" aria-hidden />
        </span>
      </div>
    </div>
  )
}
