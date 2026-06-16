'use client'

import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import { PostActions } from './post-actions'
import { selectCaptionVariant } from './actions'
import { RegenerateButton } from '../on-demand/regenerate-button'

const MAX_REVISIONS = 3

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusChipClass(s: string) {
  if (s === 'approved') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
  if (s === 'draft') return 'bg-amber-500/15 text-amber-400 border-amber-500/25'
  if (s === 'pending') return 'bg-blue-500/15 text-blue-400 border-blue-500/25'
  return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
}

function statusLabel(s: string, isAr: boolean): string {
  if (isAr) {
    if (s === 'approved') return 'موافق عليه'
    if (s === 'draft') return 'مسودة'
    if (s === 'pending') return 'قيد المراجعة'
    return 'مُنتج'
  }
  if (s === 'approved') return 'Approved'
  if (s === 'draft') return 'Draft'
  if (s === 'pending') return 'In Review'
  return 'Generated'
}

function statusIcon(s: string) {
  if (s === 'approved') return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
  if (s === 'pending') return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
    </svg>
  )
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  )
}

function formatScheduleDate(iso: string, isAr: boolean): string {
  return new Date(iso).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function formatScheduleTime(iso: string, isAr: boolean): string {
  return new Date(iso).toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

function contentTypeLabel(type: string, isAr: boolean): string {
  if (isAr) {
    if (type === 'offer') return 'ترويجي'
    if (type === 'emotional') return 'عاطفي'
    return 'أسلوب حياة'
  }
  if (type === 'offer') return 'Promo'
  if (type === 'emotional') return 'Emotional'
  return 'Lifestyle'
}

function contentTypeClasses(type: string): string {
  if (type === 'offer') return 'bg-orange-500/10 text-orange-400 border-orange-500/20'
  if (type === 'emotional') return 'bg-rose-500/10 text-rose-400 border-rose-500/20'
  return 'bg-sky-500/10 text-sky-400 border-sky-500/20'
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, isAr }: { text: string; isAr: boolean }) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
        copied
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-(--surface-3) text-(--fg-faint) hover:text-(--fg-muted) hover:bg-(--surface-2)'
      }`}
      title={isAr ? 'نسخ النص' : 'Copy caption'}
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {isAr ? 'تم النسخ' : 'Copied!'}
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {isAr ? 'نسخ' : 'Copy'}
        </>
      )}
    </button>
  )
}

// ── Brand avatar ──────────────────────────────────────────────────────────────

function BrandAvatar({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  if (logoUrl) {
    return (
      <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-(--border-subtle) shrink-0">
        <Image src={logoUrl} alt={name} width={36} height={36} className="object-cover w-full h-full" unoptimized />
      </div>
    )
  }
  return (
    <div className="w-9 h-9 rounded-full shrink-0 bg-gradient-to-br from-pink-500 via-rose-500 to-orange-400 flex items-center justify-center ring-2 ring-(--border-subtle)">
      <span className="text-white text-sm font-bold leading-none">{name?.[0] ?? '?'}</span>
    </div>
  )
}

// ── Caption variant picker ────────────────────────────────────────────────────

type Variant = { caption_ar: string; hashtags: string[]; tone: string }

function CaptionVariantPicker({
  variants,
  selectedIndex,
  postId,
  slug,
  isAr,
}: {
  variants: Variant[]
  selectedIndex: number | null
  postId: string
  slug: string
  isAr: boolean
}) {
  const [active, setActive] = useState<number>(selectedIndex ?? 0)
  const [saved, setSaved] = useState<number | null>(selectedIndex)
  const [isPending, startTransition] = useTransition()

  function handleSelect(idx: number) {
    setActive(idx)
    startTransition(async () => {
      const result = await selectCaptionVariant(postId, slug, idx as 0 | 1 | 2)
      if (result.ok) setSaved(idx)
    })
  }

  const toneLabel = (tone: string) => {
    if (isAr) {
      if (tone === 'formal') return 'رسمي'
      if (tone === 'playful') return 'مرح'
      if (tone === 'emotional') return 'عاطفي'
      return tone
    }
    if (tone === 'formal') return 'Formal'
    if (tone === 'playful') return 'Playful'
    if (tone === 'emotional') return 'Emotional'
    return tone
  }

  const v = variants[active]
  const hashtagLine = (v?.hashtags ?? []).map(t => t.startsWith('#') ? t : `#${t}`).join(' ')

  return (
    <div className="px-4 pb-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-(--fg-faint)">
          {isAr ? 'نسخ الكابشن (٣ خيارات)' : 'Caption Variants (3)'}
        </span>
        {isPending && (
          <span className="text-[10px] text-(--fg-faint)">{isAr ? 'جارٍ الحفظ…' : 'Saving…'}</span>
        )}
        {!isPending && saved !== null && (
          <span className="text-[10px] text-emerald-400">{isAr ? 'تم الحفظ ✓' : 'Saved ✓'}</span>
        )}
      </div>

      {/* Tone tabs */}
      <div className="flex gap-1.5 mb-3">
        {variants.map((variant, idx) => (
          <button
            key={idx}
            onClick={() => handleSelect(idx)}
            disabled={isPending}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
              active === idx
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                : 'bg-(--surface-3) text-(--fg-faint) border-(--border-subtle) hover:text-(--fg-muted)'
            } ${saved === idx ? 'ring-1 ring-emerald-500/40' : ''}`}
          >
            {toneLabel(variant.tone)}
          </button>
        ))}
      </div>

      {/* Active variant preview */}
      {v && (
        <div className="rounded-xl border border-(--border-subtle) bg-(--surface-2) px-3 py-2.5">
          <div dir="rtl" lang="ar" className="text-sm leading-loose text-(--fg) whitespace-pre-wrap">
            {v.caption_ar}
          </div>
          {hashtagLine && (
            <div className="mt-1.5 text-blue-400 text-xs leading-relaxed select-all" dir="rtl">
              {hashtagLine}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Revision history ─────────────────────────────────────────────────────────

type RevisionEntry = {
  revision_number: number
  reason?: string | null
  old_caption?: string | null
  new_caption?: string | null
  old_image_url?: string | null
  new_image_url?: string | null
  confidence_score?: number | null
  visual_score?: number | null
  route?: string | null
  revised_at?: string | null
}

function RevisionHistory({ history, isAr }: { history: RevisionEntry[]; isAr: boolean }) {
  const [open, setOpen] = useState(false)
  if (!history || history.length === 0) return null

  const sorted = [...history].sort((a, b) => b.revision_number - a.revision_number)

  return (
    <div className="px-4 pb-3" dir={isAr ? 'rtl' : 'ltr'}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-(--border-subtle) bg-(--surface-2) px-3.5 py-2.5 text-left hover:bg-(--surface-3) transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-(--fg-muted) shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs font-semibold text-(--fg-muted)">
            {isAr ? `سجل المراجعات (${history.length})` : `Revision History (${history.length})`}
          </span>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-(--fg-faint) transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3">
          {sorted.map((rev) => (
            <div
              key={rev.revision_number}
              className="rounded-xl border border-(--border-subtle) bg-(--surface-2) overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-(--surface-3) border-b border-(--border-subtle)">
                <span className="text-[11px] font-bold text-(--fg-muted) uppercase tracking-wider">
                  {isAr ? `مراجعة ${rev.revision_number}` : `Revision ${rev.revision_number}`}
                </span>
                <div className="flex items-center gap-1.5">
                  {rev.confidence_score != null && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      rev.confidence_score >= 75 ? 'bg-emerald-500/15 text-emerald-400' :
                      rev.confidence_score >= 50 ? 'bg-amber-500/15 text-amber-400' :
                      'bg-rose-500/15 text-rose-400'
                    }`}>
                      {Math.round(rev.confidence_score)}%
                    </span>
                  )}
                  {rev.revised_at && (
                    <span className="text-[10px] text-(--fg-faint)">
                      {new Date(rev.revised_at).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Before / After thumbnails */}
              {(rev.old_image_url || rev.new_image_url) && (
                <div className="grid grid-cols-2 gap-px bg-(--border-subtle)">
                  <div className="relative bg-(--surface-2) flex flex-col">
                    <span className="absolute top-1 left-1 z-10 text-[8px] font-bold px-1 py-0.5 rounded bg-black/60 text-white/70 uppercase tracking-wide">
                      {isAr ? 'قبل' : 'Before'}
                    </span>
                    {rev.old_image_url ? (
                      <div className="relative h-24 w-full overflow-hidden">
                        <Image
                          src={rev.old_image_url}
                          alt="Before"
                          fill
                          sizes="160px"
                          className="object-cover opacity-70 grayscale-[30%]"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="h-24 flex items-center justify-center text-(--fg-faint)">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 18h16.5" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="relative bg-(--surface-2) flex flex-col">
                    <span className="absolute top-1 left-1 z-10 text-[8px] font-bold px-1 py-0.5 rounded bg-black/60 text-white/70 uppercase tracking-wide">
                      {isAr ? 'بعد' : 'After'}
                    </span>
                    {rev.new_image_url ? (
                      <div className="relative h-24 w-full overflow-hidden">
                        <Image
                          src={rev.new_image_url}
                          alt="After"
                          fill
                          sizes="160px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="h-24 flex items-center justify-center text-(--fg-faint)">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 18h16.5" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Reason */}
              {rev.reason && (
                <div className="px-3 py-2.5">
                  <p className="text-xs text-(--fg-muted) leading-relaxed" dir={isAr ? 'rtl' : 'ltr'}>
                    <span className="font-semibold text-(--fg-faint) uppercase text-[10px] tracking-wide me-1.5">
                      {isAr ? 'السبب:' : 'Reason:'}
                    </span>
                    {rev.reason}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export function SideDrawer({
  post,
  isOpen,
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  dayInfo = null,
  slug,
  locale,
  brandNameAr,
  brandLogoUrl,
  channel,
  strings,
  isHeld = false,
  onRegenStart,
  onRegenEnd,
}: {
  post: any
  isOpen: boolean
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  /** Set when the post's day holds several posts: which one is open (1-based). */
  dayInfo?: { index: number; count: number } | null
  slug: string
  locale: string
  brandNameAr: string
  brandLogoUrl: string | null
  channel: string
  strings: any
  isHeld?: boolean
  onRegenStart?: (postId: string) => void
  onRegenEnd?: (postId: string) => void
}) {
  const isAr = locale === 'ar'
  const [isMounted, setIsMounted] = useState(false)
  const revisionCount = post?.revision_count ?? 0
  const revisionsUsed = Math.min(revisionCount, MAX_REVISIONS)
  const revisionsLeft = Math.max(0, MAX_REVISIONS - revisionsUsed)
  const revisionHistory: RevisionEntry[] = post?.revision_history ?? []

  useEffect(() => {
    setIsMounted(true)
    if (isOpen) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = 'unset' }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') { isAr ? onNext?.() : onPrev?.() }
      else if (e.key === 'ArrowRight') { isAr ? onPrev?.() : onNext?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onPrev, onNext, isAr])

  if (!isMounted) return null

  const hashtags: string[] = post?.hashtags ?? []
  const hashtagLine = hashtags
    .map((t: string) => (t.startsWith('#') ? t : `#${t}`))
    .join(' ')

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6 lg:p-10 transition-all duration-300 ${
        isOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'
      }`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />

      {/* Modal shell */}
      <div
        className={`relative w-full max-w-5xl bg-(--surface-1) md:rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row transform transition-all duration-300 ease-out h-[100dvh] md:h-[88vh] ${
          isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4 md:translate-y-0'
        }`}
      >
        {/* Mobile close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-50 p-2 bg-black/60 text-white rounded-full hover:bg-black/80 md:hidden"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* ── LEFT — Image ─────────────────────────────────────────────── */}
        <div className="relative w-full md:flex-1 bg-zinc-950 h-[50vh] md:h-full overflow-hidden">
          {/* Prev / Next nav arrows */}
          {hasPrev && (
            <button
              onClick={onPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-white/20 hover:bg-white/50 text-white backdrop-blur-sm transition-colors"
              aria-label="Previous post"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {hasNext && (
            <button
              onClick={onNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-white/20 hover:bg-white/50 text-white backdrop-blur-sm transition-colors"
              aria-label="Next post"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {post && (
            <>
              {post.storage_url && (post.format_tier === 'video' || post.format === 'video' || post.media_type === 'video' || /\.mp4([?#]|$)/i.test(post.storage_url)) ? (
                /* Video post — real player with controls (detail view). An .mp4
                   must never reach <Image>: Next's optimizer rejects it. */
                <video
                  src={post.storage_url.trim()}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-contain bg-black"
                />
              ) : (
                <Image
                  src={post.storage_url?.trim() || `https://picsum.photos/seed/${post.post_id.replace(/-/g, '').slice(0, 8)}/800/800`}
                  alt="Post preview"
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                  unoptimized={!post.storage_url}
                />
              )}

              {/* Bottom gradient + status chip */}
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
              {post.status && (
                <div className="absolute bottom-4 right-4 pointer-events-none">
                  <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border backdrop-blur-sm ${statusChipClass(post.status)}`}>
                    {statusIcon(post.status)}
                    {statusLabel(post.status, isAr)}
                  </span>
                </div>
              )}

              {post.format_tier === 'video' && (
                <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-bold text-white">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {isAr ? 'فيديو' : 'VIDEO'}
                </div>
              )}

              {/* Multi-post day chip — "2/3 today": this date holds several
                  posts; prev/next pages through them. */}
              {dayInfo && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-bold text-white" dir="ltr">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="4" width="18" height="17" rx="2" />
                    <path strokeLinecap="round" d="M8 2v4m8-4v4M3 9h18" />
                  </svg>
                  {dayInfo.index}/{dayInfo.count} {isAr ? 'في هذا اليوم' : 'this day'}
                </div>
              )}

              {post.watermark && (
                <div className={`absolute z-10 flex items-center gap-1.5 bg-amber-500/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-bold text-white ${post.format_tier === 'video' ? 'top-10 left-3' : 'top-3 left-3'}`}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  {isAr ? 'مسودة بصرية' : 'AI Draft'}
                </div>
              )}

              {!post.storage_url && !post.watermark && (
                <div className="absolute top-3 left-3 z-10 bg-black/50 backdrop-blur-sm px-2 py-1 rounded text-[10px] text-zinc-400">
                  {isAr ? 'معاينة' : 'Preview'}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT — Instagram-style detail panel ─────────────────────── */}
        <div className="w-full md:w-[400px] flex flex-col h-[50vh] md:h-full border-l border-(--border-subtle) bg-(--surface-1)">

          {/* ── Instagram-style post header ── */}
          <div
            className="flex items-center gap-3 px-4 py-3 border-b border-(--border-subtle) shrink-0"
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <BrandAvatar logoUrl={brandLogoUrl} name={brandNameAr} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-bold text-(--fg) leading-tight truncate">{brandNameAr}</span>
                {post?.content_type && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${contentTypeClasses(post.content_type)}`}>
                    {contentTypeLabel(post.content_type, isAr)}
                  </span>
                )}
              </div>
              {post?.posting_time && (
                <p className="text-[11px] text-(--fg-faint) mt-1.5 leading-none">
                  {formatScheduleDate(post.posting_time, isAr)}
                  <span className="mx-1 opacity-40">·</span>
                  {formatScheduleTime(post.posting_time, isAr)}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <PlatformIcon channel={channel} />
              <button
                onClick={onClose}
                className="hidden md:flex p-1.5 text-(--fg-muted) hover:text-(--fg) hover:bg-(--surface-3) rounded-full transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">

            {/* ── Held-post banner — regeneration sent to admin QA ── */}
            {isHeld && (
              <div className="px-4 pt-3" dir={isAr ? 'rtl' : 'ltr'}>
                <div className="flex items-start gap-2.5 rounded-xl border border-violet-500/25 bg-violet-500/8 px-3.5 py-3">
                  <svg className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                  <div>
                    <p className="text-xs font-semibold text-violet-300 leading-none mb-1">
                      {isAr ? 'قيد المراجعة الإدارية' : 'Under admin review'}
                    </p>
                    <p className="text-xs text-violet-400/80 leading-relaxed">
                      {isAr
                        ? 'طلب إعادة التوليد الأخير يتم فحصه من قِبل فريق OGZ. ستُحدَّث الصورة تلقائيًا بعد الاعتماد.'
                        : 'Your last regeneration request is being reviewed by the OGZ team. The image will update automatically once approved.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── AI Draft notice ── */}
            {post?.watermark && (
              <div className="px-4 pt-3" dir={isAr ? 'rtl' : 'ltr'}>
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3">
                  <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  <p className="text-xs text-amber-400/90 leading-relaxed">
                    {isAr
                      ? 'مسودة أولية — يُنصح بمراجعة النص قبل الموافقة.'
                      : 'AI-assisted first draft. Review caption before approving.'}
                  </p>
                </div>
              </div>
            )}

            {/* ── Caption block ── */}
            {post?.caption_variants?.length === 3 ? (
              <CaptionVariantPicker
                variants={post.caption_variants}
                selectedIndex={post.selected_variant_index ?? null}
                postId={post.post_id}
                slug={slug}
                isAr={isAr}
              />
            ) : (
              <div className="px-4 pt-3 pb-4">
                {!post?.caption_ar ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <svg className="w-8 h-8 text-(--fg-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                    <p className="text-xs text-(--fg-faint)">
                      {isAr ? 'لم يتم إنشاء النص بعد' : 'Caption not generated yet'}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Caption header with copy */}
                    <div className="flex items-center justify-between mb-2" dir={isAr ? 'rtl' : 'ltr'}>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-(--fg-faint)">
                        {isAr ? 'التعليق' : 'Caption'}
                      </span>
                      <CopyButton text={`${post.caption_ar}${hashtagLine ? `\n\n${hashtagLine}` : ''}`} isAr={isAr} />
                    </div>

                    {/* Caption body — brand name bold + text + inline hashtags */}
                    <div dir="rtl" lang="ar" className="text-sm leading-loose text-(--fg)">
                      <span className="font-bold text-(--fg)">{brandNameAr} </span>
                      <span className="whitespace-pre-wrap">{post.caption_ar}</span>
                      {hashtagLine && (
                        <span className="block mt-2 text-blue-400 leading-relaxed select-all">
                          {hashtagLine}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Revision history ── */}
            {revisionHistory.length > 0 && (
              <RevisionHistory history={revisionHistory} isAr={isAr} />
            )}
          </div>

          {/* ── Regeneration section (user-side, max 3 revisions) ── */}
          {post && post.brand_id && post.status !== 'approved' && (
            <div className="shrink-0 border-t border-(--border-subtle) px-4 py-3 space-y-3">
              {/* Revision counter — always shown when post is not approved */}
              <div className="flex items-center justify-between" dir={isAr ? 'rtl' : 'ltr'}>
                <span className="text-xs font-semibold text-(--fg-muted)">
                  {isAr ? 'مراجعات الإعادة' : 'Regenerations'}
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: MAX_REVISIONS }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-2 w-2 rounded-full transition-colors ${
                          i < revisionsUsed
                            ? revisionsLeft === 0 ? 'bg-rose-400' : 'bg-(--accent)'
                            : 'bg-(--border-subtle)'
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-[11px] font-bold tabular-nums ${
                    revisionsLeft === 0 ? 'text-rose-400' :
                    revisionsLeft === 1 ? 'text-amber-400' : 'text-(--fg-muted)'
                  }`}>
                    {revisionsLeft === 0
                      ? (isAr ? 'استُنفِد' : 'Exhausted')
                      : isAr
                        ? `${revisionsLeft} متبقية`
                        : `${revisionsLeft} left`}
                  </span>
                </div>
              </div>

              {/* Held state — show message instead of regen button */}
              {isHeld ? (
                <div
                  className="flex items-start gap-2.5 rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2.5"
                  dir={isAr ? 'rtl' : 'ltr'}
                >
                  <svg className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <p className="text-xs text-violet-400/80 leading-relaxed">
                    {isAr
                      ? 'لا يمكن الإعادة الآن — إصدارك الأخير قيد المراجعة. ستتمكن من الإعادة مرة أخرى بعد الاعتماد.'
                      : "Can't regenerate now — your last version is under review. You'll be able to regenerate again once it's approved."}
                  </p>
                </div>
              ) : revisionsLeft > 0 ? (
                <RegenerateButton
                  slug={slug}
                  requestId={null}
                  postId={post.post_id}
                  brandId={post.brand_id}
                  revisionCount={revisionCount}
                  previousPrompt={post.image_prompt_en ?? null}
                  currentImageUrl={post.storage_url ?? null}
                  isVideo={post.format_tier === 'video' || post.media_type === 'video'}
                  onRegenStart={onRegenStart}
                  onRegenEnd={onRegenEnd}
                />
              ) : (
                <div
                  className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5"
                  dir={isAr ? 'rtl' : 'ltr'}
                >
                  <svg className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  <p className="text-xs text-rose-400/80 leading-relaxed">
                    {isAr
                      ? 'لقد استخدمت الحد الأقصى البالغ 3 مراجعات لهذا المنشور. تواصل مع فريق OGZ إذا كنت بحاجة إلى مزيد من التعديلات.'
                      : "You've used all 3 regenerations for this post. Contact the OGZ team if you need further changes."}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Actions footer ── */}
          <div className="shrink-0 border-t border-(--border-subtle) bg-(--surface-2) px-4 pt-3.5 pb-4">
            {post && (
              /* key={post_id}: prev/next swaps the post prop on the SAME
                 component instance — without a key, all useState initializers
                 (status, publish state, schedule time…) keep the FIRST post's
                 values. The key forces a clean remount per post. */
              <PostActions
                key={post.post_id}
                postId={post.post_id}
                slug={slug}
                status={post.status}
                publishStatus={post.publish_status ?? null}
                publishRequestedAt={post.publish_requested_at ?? null}
                postingTime={post.posting_time ?? null}
                externalPostId={post.external_post_id ?? null}
                revisionCount={post.revision_count ?? 0}
                storageUrl={post.storage_url}
                strings={strings}
                isAr={isAr}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Platform icon ─────────────────────────────────────────────────────────────

function PlatformIcon({ channel }: { channel: string }) {
  if (channel === 'Snapchat') {
    return (
      <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.06-.929-.06-.54 0-.958.089-1.272.15-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.104-.465-.166-.553-1.872-.285-2.906-.702-3.145-1.271-.03-.075-.046-.15-.046-.226.016-.239.195-.465.45-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z" />
      </svg>
    )
  }
  if (channel === 'TikTok') {
    return (
      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.13 8.13 0 004.78 1.52V6.76a4.84 4.84 0 01-1.01-.07z" />
      </svg>
    )
  }
  if (channel === 'Twitter') {
    return (
      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.732-8.843L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    )
  }
  return (
    <svg className="w-4 h-4 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574v9.176A2.25 2.25 0 004.5 21h15a2.25 2.25 0 002.25-2.25V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
    </svg>
  )
}
