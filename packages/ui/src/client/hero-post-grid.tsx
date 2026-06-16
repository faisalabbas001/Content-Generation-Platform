'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '../cn'

/**
 * HeroShowcase — animated, engaging hero visual.
 *
 *   • Three vertical columns of real HD photographs.
 *   • Continuously translate at staggered speeds (col-1 up, col-2 down, col-3 up).
 *   • Pause on pointer-enter so the user can read.
 *   • Cursor-following spotlight glow on top of the entire stack.
 *   • Subtle 3D tilt on each tile based on the local cursor position
 *     (viewport-relative, computed per-tile from getBoundingClientRect).
 *   • Honours `prefers-reduced-motion`.
 *
 * Photos are served directly from the Unsplash CDN with a sized query
 * (?w=600&q=80&auto=format&fit=crop). Plain <img> is used so this
 * component stays framework-agnostic inside @repo/ui.
 */

interface ShowcasePhoto {
  id: string
  caption: string
  brand: string
  tag: string
  tagTone: 'accent' | 'success' | 'warning' | 'info'
}

const PHOTOS: ShowcasePhoto[] = [
  { id: '1517248135467-4c7edcad34c4', caption: 'قهوة عربية مع تمر مديني',         brand: 'قهوة الأصالة', tag: 'F&B',     tagTone: 'success' },
  { id: '1504674900247-0877df9cc836', caption: 'اجمع العائلة على وجبة دافئة',     brand: 'مطعم نجد',     tag: 'F&B',     tagTone: 'success' },
  { id: '1556228720-195a672e8a03',    caption: 'عناية طبيعية يومية',             brand: 'واحة الجمال',  tag: 'Beauty',  tagTone: 'accent'  },
  { id: '1542816417-0983c9c9ad53',    caption: 'ليالي رمضان السعودية',           brand: 'حملة موسمية',  tag: 'رمضان',   tagTone: 'warning' },
  { id: '1490481651871-ab68de25d43d', caption: 'إطلالة محتشمة لكل المناسبات',    brand: 'بوتيك السلام', tag: 'Retail',  tagTone: 'accent'  },
  { id: '1584285405429-136bf988919c', caption: 'فانوس وأجواء رمضانية',           brand: 'حملة موسمية',  tag: 'رمضان',   tagTone: 'warning' },
  { id: '1509042239860-f550ce710b93', caption: 'فنجان قهوة الصباح',              brand: 'قهوة الأصالة', tag: 'F&B',     tagTone: 'success' },
  { id: '1604654894610-df63bc536371', caption: 'عناية بالبشرة بمكونات طبيعية',   brand: 'واحة الجمال',  tag: 'Beauty',  tagTone: 'accent'  },
  { id: '1551782450-a2132b4ba21d',    caption: 'تجربة عشاء بنكهة سعودية',        brand: 'مطعم نجد',     tag: 'F&B',     tagTone: 'success' },
  { id: '1483985988355-763728e1935b', caption: 'أزياء العيد وصلت',               brand: 'بوتيك السلام', tag: 'العيد',   tagTone: 'accent'  },
  { id: '1605196560547-b2f7281b7355', caption: 'تمور المدينة الفاخرة',           brand: 'تمور سعودية',  tag: 'F&B',     tagTone: 'success' },
  { id: '1596797038530-2c107229654b', caption: 'بهارات وعطور الأسواق',           brand: 'سوق التراث',   tag: 'Retail',  tagTone: 'info'    },
  { id: '1487412947147-5cebf100ffc2', caption: 'روتين العناية الكامل',           brand: 'واحة الجمال',  tag: 'Beauty',  tagTone: 'accent'  },
  { id: '1485968579580-b6d095142e6e', caption: 'إطلالة الأسبوع الجديدة',         brand: 'بوتيك السلام', tag: 'Retail',  tagTone: 'accent'  },
  { id: '1495474472287-4d71bcdd2085', caption: 'لحظة قهوة الأصيل',               brand: 'قهوة الأصالة', tag: 'F&B',     tagTone: 'success' },
]

const TONE_BG: Record<ShowcasePhoto['tagTone'], string> = {
  accent:  'bg-(--accent-soft) text-(--accent)',
  success: 'bg-(--success-soft) text-(--success)',
  warning: 'bg-(--warning-soft) text-(--warning)',
  info:    'bg-(--info-soft) text-(--info)',
}

function partition<T>(items: T[], cols: number): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => [])
  items.forEach((item, i) => {
    const target = out[i % cols]
    if (target) target.push(item)
  })
  return out
}

interface CursorState {
  /** Container-local x (used for the spotlight). */
  localX: number
  /** Container-local y. */
  localY: number
  /** Viewport-relative x (used by tiles via getBoundingClientRect). */
  clientX: number
  clientY: number
  active: boolean
}

const INITIAL_CURSOR: CursorState = { localX: 0, localY: 0, clientX: 0, clientY: 0, active: false }

export function HeroPostGrid() {
  const cols = partition(PHOTOS, 3)
  const containerRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<CursorState>(INITIAL_CURSOR)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return (
    <div className="relative ">
      {/* Glow halo */}
      <div
        aria-hidden
        className="absolute  -inset-12 -z-10 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, rgba(16,185,129,0.55), transparent)' }}
      />

      <div
        ref={containerRef}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setCursor({
            localX: e.clientX - r.left,
            localY: e.clientY - r.top,
            clientX: e.clientX,
            clientY: e.clientY,
            active: true,
          })
        }}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => {
          setPaused(false)
          setCursor((c) => ({ ...c, active: false }))
        }}
        className="relative h-112 overflow-hidden rounded-(--r-xl) border border-(--border-subtle) bg-(--surface-2) sm:h-128 lg:h-144"
        style={{ perspective: '1200px' }}
      >
        {/* Cursor spotlight */}
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 transition-opacity duration-300"
          style={{
            left: cursor.localX - 200,
            top: cursor.localY - 200,
            width: 400,
            height: 400,
            opacity: cursor.active ? 1 : 0,
            background:
              'radial-gradient(closest-side, rgba(16,185,129,0.18), rgba(56,189,248,0.08), transparent)',
            mixBlendMode: 'screen',
          }}
        />

        {/* Top + bottom fade masks for cleaner column edges */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-linear-to-b from-(--surface-2) to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 bg-linear-to-t from-(--surface-2) to-transparent" />

        {/* Three columns */}
        <div className="grid h-full grid-cols-3 gap-2 p-2 sm:gap-3 sm:p-3">
          {cols.map((col, i) => (
            <ScrollColumn
              key={i}
              photos={col}
              direction={i === 1 ? 'down' : 'up'}
              durationSeconds={i === 0 ? 28 : i === 1 ? 36 : 32}
              paused={paused || reduced}
              cursor={cursor}
              tiltEnabled={!reduced}
            />
          ))}
        </div>

        {/* Status pill */}
        <div className="absolute bottom-3 inset-s-3 z-30 inline-flex items-center gap-2 rounded-full border border-(--border-subtle) bg-(--bg)/70 px-3 py-1 text-[11px] text-(--fg-subtle) backdrop-blur sm:bottom-4 sm:inset-s-4 sm:text-xs">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--accent) opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-(--accent)" />
          </span>
          ٢٠ منشوراً شهرياً · ٤ وكلاء أذكياء
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function ScrollColumn({
  photos,
  direction,
  durationSeconds,
  paused,
  cursor,
  tiltEnabled,
}: {
  photos: ShowcasePhoto[]
  direction: 'up' | 'down'
  durationSeconds: number
  paused: boolean
  cursor: CursorState
  tiltEnabled: boolean
}) {
  // Duplicate the list so translate(-50%) loops seamlessly.
  const doubled = [...photos, ...photos]

  return (
    <div className="relative h-full overflow-hidden rounded-(--r-md)">
      <div
        className={cn('flex flex-col gap-2 sm:gap-3', direction === 'up' ? 'oc-marquee-up' : 'oc-marquee-down')}
        style={{
          animationDuration: `${durationSeconds}s`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      >
        {doubled.map((p, i) => (
          <ShowcaseTile key={`${i}:${p.id}`} photo={p} cursor={cursor} tiltEnabled={tiltEnabled} />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function ShowcaseTile({
  photo,
  cursor,
  tiltEnabled,
}: {
  photo: ShowcasePhoto
  cursor: CursorState
  tiltEnabled: boolean
}) {
  const tileRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 })

  useEffect(() => {
    if (!tiltEnabled || !cursor.active || !tileRef.current) {
      setTilt({ rx: 0, ry: 0 })
      return
    }
    const r = tileRef.current.getBoundingClientRect()
    // cursor relative to tile centre, normalised to [-1, 1]
    const dx = (cursor.clientX - (r.left + r.width / 2)) / (r.width / 2)
    const dy = (cursor.clientY - (r.top + r.height / 2)) / (r.height / 2)
    // limit tilt magnitude — capped at ~6deg either way
    const maxX = Math.max(-1, Math.min(1, dx))
    const maxY = Math.max(-1, Math.min(1, dy))
    setTilt({
      ry: maxX * 6,
      rx: -maxY * 6,
    })
  }, [cursor, tiltEnabled])

  return (
    <div
      ref={tileRef}
      className="group relative aspect-4/5 shrink-0 overflow-hidden rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) shadow-(--shadow-1) transition-transform duration-(--d-base) ease-out"
      style={{
        transform:
          tilt.rx || tilt.ry
            ? `perspective(800px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`
            : undefined,
        transformStyle: 'preserve-3d',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://images.unsplash.com/photo-${photo.id}?w=600&q=80&auto=format&fit=crop`}
        alt={photo.caption}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
      />

      {/* Bottom gradient for caption legibility */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-black/85 via-black/40 to-transparent"
      />

      {/* Top: tag chip + brand chip */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm', TONE_BG[photo.tagTone])}>
          {photo.tag}
        </span>
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/95 backdrop-blur-sm">
          {photo.brand}
        </span>
      </div>

      {/* Bottom: Arabic caption */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-2.5">
        <p
          dir="rtl"
          className="line-clamp-2 text-[11px] font-medium leading-snug text-white drop-shadow-md sm:text-xs"
        >
          {photo.caption}
        </p>
      </div>
    </div>
  )
}
