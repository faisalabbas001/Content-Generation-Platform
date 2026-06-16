'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { toast } from '@repo/ui/client/toast';
import { SideDrawer } from './side-drawer';
import { approvePost, bulkApprove } from './actions';

/** True when the post's media is a video — .mp4 must NEVER reach <Image>
    (Next's optimizer rejects it: "isn't a valid image"). */
function isVideoMedia(post: { storage_url?: string | null; format_tier?: string | null; format?: string | null; media_type?: string | null }): boolean {
  if (!post.storage_url) return false;
  return (
    post.format_tier === 'video' ||
    post.format === 'video' ||
    post.media_type === 'video' ||
    /\.mp4([?#]|$)/i.test(post.storage_url)
  );
}

/**
 * Auto-playing video tile. Plays muted + looped, but ONLY while the tile is
 * actually on screen (IntersectionObserver pauses off-screen clips), so a
 * month grid of videos stays smooth and never streams what nobody sees.
 */
function AutoVideo({ src, className = '' }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      // #t=0.001 media fragment: paints the first frame immediately even
      // before autoplay kicks in.
      src={`${src}#t=0.001`}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      tabIndex={-1}
      aria-hidden
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
    />
  );
}

/**
 * Live ticking countdown chip for scheduled posts on the grid cells.
 * Shows d/hh:mm:ss while waiting; flips to a pulsing "publishing" state once
 * the moment passes (the page-load reconcile + drawer polling flip the real
 * status to published shortly after).
 */
function CountdownBadge({ target, isAr }: { target: string; isAr: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = new Date(target).getTime() - now;
  if (isNaN(remaining)) return null;

  if (remaining <= 0) {
    return (
      <div className="absolute top-1.5 start-2 z-20 flex items-center gap-1 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[8px] font-bold text-white animate-pulse" dir="ltr">
        {isAr ? 'جارٍ النشر…' : 'Publishing…'}
      </div>
    );
  }
  const totalSec = Math.floor(remaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = days > 0
    ? `${days}${isAr ? 'ي' : 'd'} ${pad(hours)}:${pad(mins)}`
    : `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return (
    <div className="absolute top-1.5 start-2 z-20 flex items-center gap-1 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[8px] font-bold tabular-nums text-white" dir="ltr">
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
      </svg>
      {text}
    </div>
  );
}

/**
 * Big ticking countdown for the next-up banner — days + hh:mm:ss, updates
 * every second.
 */
function BigCountdown({ target, isAr }: { target: string; isAr: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = new Date(target).getTime() - now;
  if (isNaN(remaining)) return null;
  if (remaining <= 0) {
    return (
      <span className="animate-pulse font-mono text-xl font-bold text-emerald-300 md:text-2xl" dir="ltr">
        {isAr ? 'جارٍ النشر…' : 'Publishing…'}
      </span>
    );
  }
  const totalSec = Math.floor(remaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hh = pad(Math.floor((totalSec % 86400) / 3600));
  const mm = pad(Math.floor((totalSec % 3600) / 60));
  const ss = pad(totalSec % 60);
  return (
    <span className="font-mono text-xl font-bold tabular-nums tracking-tight text-emerald-300 md:text-2xl" dir="ltr">
      {days > 0 ? `${days}${isAr ? 'ي' : 'd'} ` : ''}{hh}:{mm}:{ss}
    </span>
  );
}

/**
 * Next-up hero banner above the grid. Surfaces the single most relevant
 * post so the user always knows the next step:
 *   1. A scheduled post → big live countdown to its auto-publish moment.
 *   2. An approved-but-unscheduled post → "schedule it" call to action.
 *   3. A post awaiting approval → "review & approve" call to action.
 */
function NextUpBanner({
  posts,
  approvedIds,
  isAr,
  onOpen,
}: {
  posts: any[];
  approvedIds: Set<string>;
  isAr: boolean;
  onOpen: (post: any) => void;
}) {
  const byTime = (a: any, b: any) =>
    new Date(a.posting_time).getTime() - new Date(b.posting_time).getTime();
  const now = Date.now();

  const scheduled = posts
    .filter((p) => p.publish_status === 'scheduled' && p.posting_time)
    .sort(byTime)[0];
  const readyToSchedule = !scheduled
    ? posts
        .filter(
          (p) =>
            (p.status === 'approved' || approvedIds.has(p.post_id)) &&
            p.publish_status !== 'scheduled' &&
            p.publish_status !== 'published',
        )
        .sort(byTime)[0]
    : null;
  const awaitingApproval = !scheduled && !readyToSchedule
    ? posts
        .filter((p) => p.status !== 'approved' && !approvedIds.has(p.post_id) && p.storage_url)
        .sort(byTime)[0]
    : null;

  const item = scheduled ?? readyToSchedule ?? awaitingApproval;
  if (!item) return null;
  const kind = scheduled ? 'scheduled' : readyToSchedule ? 'schedule' : 'approve';
  const overdue = item.posting_time ? new Date(item.posting_time).getTime() < now : false;

  const accent =
    kind === 'scheduled' ? 'border-emerald-500/40 from-emerald-600/15'
    : kind === 'schedule' ? 'border-blue-500/40 from-blue-600/15'
    : 'border-amber-500/40 from-amber-600/15';

  return (
    <div
      className={`relative mb-4 flex items-center gap-4 overflow-hidden rounded-2xl border bg-linear-to-r to-transparent p-4 ${accent}`}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {/* Thumbnail */}
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
        aria-label={isAr ? 'فتح المنشور' : 'Open post'}
      >
        <MediaThumb post={item} alt="" sizes="80px" />
      </button>

      {/* Copy + countdown */}
      <div className="min-w-0 flex-1 space-y-1">
        {kind === 'scheduled' ? (
          <>
            <p className="text-xs font-semibold text-emerald-400">
              {isAr ? '⏱ منشورك القادم — ينشر تلقائياً خلال' : '⏱ Your next post — publishing automatically in'}
            </p>
            <BigCountdown target={item.posting_time} isAr={isAr} />
            <p className="truncate text-[11px] text-(--fg-muted)" dir="ltr">
              {new Date(item.posting_time).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </>
        ) : kind === 'schedule' ? (
          <>
            <p className="text-xs font-semibold text-blue-400">
              {isAr ? '🚀 منشور معتمد وجاهز' : '🚀 Approved post is ready'}
            </p>
            <p className="text-sm font-bold text-(--fg)">
              {overdue
                ? (isAr ? 'وقته الموصى به انتهى — اختر وقتاً جديداً وجدوله' : 'Its recommended time passed — pick a new time and schedule it')
                : (isAr ? 'جدوله الآن لينشر تلقائياً في موعده' : 'Schedule it now to publish automatically on time')}
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-amber-400">
              {isAr ? '✋ بانتظار موافقتك' : '✋ Awaiting your approval'}
            </p>
            <p className="line-clamp-1 text-sm font-bold text-(--fg)" dir="rtl" lang="ar">
              {item.caption_ar || (isAr ? 'راجع المنشور واعتمده لمتابعة النشر' : 'Review this post to keep your feed moving')}
            </p>
          </>
        )}
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors ${
          kind === 'scheduled' ? 'bg-emerald-600 hover:bg-emerald-500'
          : kind === 'schedule' ? 'bg-blue-600 hover:bg-blue-500'
          : 'bg-amber-600 hover:bg-amber-500'
        }`}
      >
        {kind === 'scheduled'
          ? (isAr ? 'عرض المنشور' : 'View post')
          : kind === 'schedule'
          ? (isAr ? 'جدولة الآن' : 'Schedule now')
          : (isAr ? 'راجع ووافق' : 'Review & approve')}
      </button>
    </div>
  );
}

/**
 * Media thumbnail that routes video posts to <AutoVideo> and images to
 * next/image. Drop-in for every place the calendar used to feed storage_url
 * straight into <Image>.
 */
function MediaThumb({
  post,
  alt,
  sizes,
  className = 'object-cover',
}: {
  post: any;
  alt: string;
  sizes: string;
  className?: string;
}) {
  if (isVideoMedia(post)) {
    return <AutoVideo src={post.storage_url.trim()} className={className.replace('object-cover', '') + ' object-cover'} />;
  }
  return (
    <Image
      src={post.storage_url?.trim() || `https://picsum.photos/seed/${post.post_id.replace(/-/g, '').slice(0, 8)}/240/240`}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      unoptimized={!post.storage_url}
    />
  );
}

const WEEKDAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function statusBorderClass(s: string) {
  if (s === 'approved') return 'border-l-2 border-l-emerald-500/60';
  if (s === 'generated') return 'border-l-2 border-l-blue-500/60';
  if (s === 'draft') return 'border-l-2 border-l-amber-500/60';
  return 'border-l-2 border-l-rose-500/40';
}

function statusChipClass(s: string) {
  if (s === 'approved') return 'bg-emerald-500/15 text-emerald-400';
  if (s === 'generated') return 'bg-blue-500/15 text-blue-400';
  if (s === 'draft') return 'bg-amber-500/15 text-amber-400';
  return 'bg-rose-500/15 text-rose-400';
}

function statusLabel(s: string, isAr: boolean): string {
  if (isAr) {
    if (s === 'approved') return 'موافق عليه';
    if (s === 'generated') return 'مُنتج';
    if (s === 'draft') return 'مسودة';
    return 'مراجعة';
  }
  if (s === 'approved') return 'Approved';
  if (s === 'generated') return 'Generated';
  if (s === 'draft') return 'Draft';
  return 'Review';
}

function contentTypeIcon(type: string, size = 'w-3 h-3') {
  if (type === 'offer') return (
    <svg className={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  );
  if (type === 'emotional') return (
    <svg className={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  );
  return (
    <svg className={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  );
}

function contentTypeColor(type: string): string {
  if (type === 'offer') return 'text-orange-400 bg-orange-500/10';
  if (type === 'emotional') return 'text-rose-400 bg-rose-500/10';
  return 'text-sky-400 bg-sky-500/10';
}


function fmtTime(iso: string, isAr: boolean): string {
  return new Date(iso).toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function Spinner({ className = 'text-white' }: { className?: string }) {
  return (
    <svg className={`w-3 h-3 animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ApprovalProgress({ approved, total, isAr }: { approved: number; total: number; isAr: boolean }) {
  if (total === 0) return null;
  const pct = Math.round((approved / total) * 100);
  return (
    <div className="mb-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-1.5 text-xs">
        <span className="text-(--fg-muted) font-medium">
          {isAr
            ? `تمت الموافقة على ${approved} من ${total} منشورًا`
            : `${approved} of ${total} posts approved`}
        </span>
        <span className="text-(--fg-faint)">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-(--surface-3) overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Mobile post card ──────────────────────────────────────────────────────────

function MobilePostCard({
  post,
  isAr,
  effectiveStatus,
  isApproving,
  isHeld,
  isAdminPending,
  onApprove,
  onOpen,
}: {
  post: any;
  isAr: boolean;
  effectiveStatus: string;
  isApproving: boolean;
  isHeld?: boolean;
  isAdminPending?: boolean;
  onApprove: (id: string, e: React.MouseEvent) => void;
  onOpen: (post: any) => void;
}) {
  const dateLabel = post.posting_time
    ? new Date(post.posting_time).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
        weekday: 'short', day: 'numeric', month: 'short',
      })
    : '';
  const timeLabel = post.posting_time ? fmtTime(post.posting_time, isAr) : '';

  return (
    <div
      className={`relative flex gap-3 rounded-xl border p-3 cursor-pointer transition-colors hover:bg-(--surface-3) ${statusBorderClass(effectiveStatus)} border-(--border-subtle) bg-(--surface-2)`}
      onClick={() => onOpen(post)}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {/* Thumbnail — video posts hover-play, images via next/image */}
      <div className="relative w-16 h-16 rounded-lg overflow-hidden shrink-0">
        <MediaThumb post={post} alt={`Post ${post.position}`} sizes="64px" />
        {post.format_tier === 'video' && (
          <div className="absolute top-0.5 right-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-black/60 text-white">
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {post.watermark && (
          <div className="absolute bottom-0 inset-x-0 py-0.5 text-center bg-amber-500/80 text-[8px] font-bold text-white">
            {isAr ? 'مسودة' : 'DRAFT'}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
        {isAdminPending ? (
          <p className="text-xs text-(--fg-faint) italic">
            {isAr ? 'قيد المراجعة الداخلية — سيتوفر قريبًا' : 'Pending OGZ internal review — available soon'}
          </p>
        ) : (
          <p className="text-xs text-(--fg) line-clamp-2 leading-relaxed" dir="rtl" lang="ar">
            {post.caption_ar ?? '—'}
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${contentTypeColor(post.content_type)}`}>
            {contentTypeIcon(post.content_type)}
          </span>
          <span className="text-[10px] text-(--fg-faint)">{dateLabel} · {timeLabel}</span>
          {post.watermark && !isAdminPending && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
              {isAr ? 'مسودة بصرية' : 'AI Draft'}
            </span>
          )}
          {isAdminPending && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400">
              {isAr ? 'مراجعة OGZ' : 'OGZ Review'}
            </span>
          )}
          {isHeld && !isAdminPending && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400">
              {isAr ? 'قيد المراجعة' : 'Under Review'}
            </span>
          )}
          {effectiveStatus === 'approved' && post.publish_status === 'scheduled' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
              {isAr ? 'مجدول' : 'Scheduled'}
            </span>
          )}
          {effectiveStatus === 'approved' && post.publish_status === 'published' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              {isAr ? 'منشور' : 'Published'}
            </span>
          )}
          {effectiveStatus === 'approved' && post.publish_status === 'failed' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
              {isAr ? 'فشل' : 'Failed'}
            </span>
          )}
          {effectiveStatus === 'approved' && post.publish_status === 'manual_required' && (
            <span
              title={isAr ? 'التاريخ انتهى — سيتطلب الرفع اليدوي' : 'Date passed — manual upload needed'}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30"
            >
              {isAr ? 'يدوي' : 'Manual'}
            </span>
          )}
        </div>
      </div>

      {/* Quick approve / approved indicator — hidden when pending OGZ internal review */}
      {isAdminPending ? null : effectiveStatus === 'approved' ? (
        <div className="shrink-0 self-center flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      ) : (
        <button
          onClick={(e) => onApprove(post.post_id, e)}
          disabled={isApproving}
          className="shrink-0 self-center flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white transition-colors disabled:opacity-40"
          title={isAr ? 'موافقة' : 'Approve'}
        >
          {isApproving ? <Spinner className="text-emerald-400" /> : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

// ── Upgrade section ───────────────────────────────────────────────────────────

function UpgradeSection({ count, slug, isAr }: { count: number; slug: string; isAr: boolean }) {
  return (
    <div
      className="mt-4 rounded-2xl border border-dashed border-(--border-default) bg-gradient-to-br from-(--surface-2) to-(--surface-1) p-6 text-center"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
        <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h3 className="mb-1 text-base font-bold text-(--fg)">
        {isAr ? `${count} منشورًا آخر بانتظارك` : `${count} more posts waiting for you`}
      </h3>
      <p className="mb-4 text-sm text-(--fg-muted)">
        {isAr
          ? 'قم بالترقية للاطلاع على جميع المنشورات وتحميلها والموافقة عليها.'
          : 'Upgrade to view, download, and approve all your posts.'}
      </p>
      <a
        href={`/${slug}/upgrade`}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-emerald-500 transition-colors"
      >
        {isAr ? 'ابدأ الخطة المدفوعة' : 'Upgrade Plan'}
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={isAr ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
        </svg>
      </a>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CalendarClientView({
  posts,
  heldPostIds,
  freeLimit,
  slug,
  locale,
  brandNameAr,
  brandLogoUrl,
  channel,
  offDays = [0, 6],
  calendarMonth,
  preparingCount = 0,
  strings,
}: {
  posts: any[];
  heldPostIds?: Set<string>;
  freeLimit: number;
  slug: string;
  locale: string;
  brandNameAr: string;
  brandLogoUrl: string | null;
  channel: string;
  offDays?: number[];
  calendarMonth: string;
  /** Posts generated but not yet released — # of blurred "being prepared" slots to show. */
  preparingCount?: number;
  strings: any;
}) {
  const isAr = locale === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const isFreeTier = freeLimit !== Infinity && freeLimit < 20;

  // Derive the locked year/month from the calendar record — never let posts
  // outside this month bleed into view (e.g. a post with posting_time = June 1
  // inside a May calendar should be invisible until the June A01 run).
  const [calYear, calMon] = calendarMonth.split('-').map(Number);
  const currentDate = new Date(calYear, calMon - 1, 1);

  // Hard-filter: only posts whose posting_time actually falls in this month.
  const monthPosts = posts.filter((p) => {
    if (!p.posting_time) return false;
    const d = new Date(p.posting_time);
    return d.getFullYear() === calYear && d.getMonth() + 1 === calMon;
  });

  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloadMeta, setDownloadMeta] = useState<{ calendarId: string; slug: string } | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);

  // Optimistic approve state
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // Regeneration in-progress state — tracks which posts are currently being regenerated
  // so the grid cell can show a "regenerating" placeholder while B03 runs.
  const [regeneratingPostIds, setRegeneratingPostIds] = useState<Set<string>>(new Set());

  function handleRegenStart(postId: string) {
    setRegeneratingPostIds(prev => new Set([...prev, postId]));
  }
  function handleRegenEnd(postId: string) {
    setRegeneratingPostIds(prev => { const next = new Set(prev); next.delete(postId); return next; });
  }

  async function handleQuickApprove(postId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (pendingIds.has(postId)) return;
    setPendingIds(prev => new Set([...prev, postId]));
    try {
      const result = await approvePost(postId, slug);
      if (result.ok) {
        setApprovedIds(prev => new Set([...prev, postId]));
        toast.success(strings.approveSuccess ?? (isAr ? 'تم اعتماد المنشور' : 'Post approved'));
      } else {
        toast.error(result.error ?? strings.approveError ?? (isAr ? 'حدث خطأ ما' : 'Something went wrong'));
      }
    } catch {
      toast.error(strings.approveError ?? (isAr ? 'حدث خطأ ما' : 'Something went wrong'));
    } finally {
      setPendingIds(prev => { const next = new Set(prev); next.delete(postId); return next; });
    }
  }

  useEffect(() => {
    function onSelectMode(e: CustomEvent) {
      setSelectMode(true);
      setSelected(new Set());
      setDownloadMeta(e.detail);
    }
    window.addEventListener('calendar:select-mode', onSelectMode as EventListener);
    return () => window.removeEventListener('calendar:select-mode', onSelectMode as EventListener);
  }, []);

  function toggleSelect(postId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(postId) ? next.delete(postId) : next.add(postId);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(monthPosts.filter(p => p.storage_url && p.position <= freeLimit).map((p: any) => p.post_id)));
  }

  function cancelSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function downloadSelected() {
    if (!downloadMeta || selected.size === 0) return;
    const ids = Array.from(selected).join(',');
    toast.info(strings.downloadStarted ?? (isAr ? 'جارٍ تجهيز التحميل…' : 'Preparing your download…'));
    window.location.href = `/api/calendar/${downloadMeta.calendarId}/export-zip?slug=${downloadMeta.slug}&post_ids=${ids}`;
  }

  async function handleBulkApprove() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkApproving(true);
    try {
      const result = await bulkApprove(ids, slug);
      if (result.approved.length > 0) {
        setApprovedIds(prev => new Set([...prev, ...result.approved]));
        toast.success(
          isAr
            ? `تمت الموافقة على ${result.approved.length} منشور${result.approved.length > 1 ? 'ات' : ''}`
            : `${result.approved.length} post${result.approved.length > 1 ? 's' : ''} approved`,
        );
      }
      if (result.failed.length > 0) {
        toast.error(
          isAr
            ? `فشلت الموافقة على ${result.failed.length} منشور`
            : `Failed to approve ${result.failed.length} post${result.failed.length > 1 ? 's' : ''}`,
        );
      }
    } catch {
      toast.error(isAr ? 'حدث خطأ ما' : 'Something went wrong');
    } finally {
      setBulkApproving(false);
      setSelectMode(false);
      setSelected(new Set());
    }
  }

  const today = new Date();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const emptyCells = Array.from({ length: firstDay });
  const days = Array.from({ length: daysInMonth }).map((_, i) => i + 1);
  // Budget of "being prepared" placeholders to show across weekday cells with no
  // released post (reset right before the days.map below).
  let _preparingLeft = 0;

  const weekdays = isAr ? WEEKDAYS_AR : WEEKDAYS_EN;
  const monthName = currentDate.toLocaleString(isAr ? 'ar-SA' : 'en-US', { month: 'long', year: 'numeric' });

  // Phase B — posts awaiting OGZ internal review (not yet released to client)
  const adminPendingCount = monthPosts.filter(
    p => p.status === 'generated' && !(heldPostIds?.has(p.post_id)),
  ).length;

  // Stats — derived from month-scoped posts only
  const visiblePosts = monthPosts.filter(p => p.position <= freeLimit);
  const lockedPosts = monthPosts.filter(p => p.position > freeLimit);
  const approvedCount = visiblePosts.filter(
    p => p.status === 'approved' || approvedIds.has(p.post_id),
  ).length;
  const generatedCount = monthPosts.filter(p => p.status === 'generated' || p.status === 'pending').length;
  const draftCount = monthPosts.filter(p => p.status === 'draft').length;

  // Working-day visible posts in CHRONOLOGICAL order (posting_time, then
  // position as tie-break) — modal prev/next walks the month like a calendar,
  // so several posts on the same day are adjacent (1/3 → 2/3 → 3/3) instead
  // of scattered by generation position.
  const navigablePosts = visiblePosts
    .filter(p => {
      if (!p.posting_time) return false;
      const dow = new Date(p.posting_time).getDay();
      return !offDays.includes(dow);
    })
    .sort((a: any, b: any) =>
      (new Date(a.posting_time).getTime() - new Date(b.posting_time).getTime()) ||
      (a.position - b.position));

  const selectedIndex = selectedPost
    ? navigablePosts.findIndex(p => p.post_id === selectedPost.post_id)
    : -1;

  function handlePrev() {
    if (selectedIndex > 0) setSelectedPost(navigablePosts[selectedIndex - 1]);
  }

  function handleNext() {
    if (selectedIndex < navigablePosts.length - 1) setSelectedPost(navigablePosts[selectedIndex + 1]);
  }

  return (
    <>
      {/* Next-up banner — the single most relevant post + its next step */}
      <NextUpBanner
        posts={navigablePosts}
        approvedIds={approvedIds}
        isAr={isAr}
        onOpen={setSelectedPost}
      />

      {/* Static month header — no navigation; each calendar page is month-locked */}
      <div className="mb-3 px-1 flex items-center justify-between" dir={dir}>
        <h2 className="text-xl font-bold text-(--fg)">{monthName}</h2>
        {/* Select mode entry — only shown when there are approvable posts and not already in select mode */}
        {!selectMode && visiblePosts.some(p => p.status !== 'approved') && (
          <button
            onClick={() => { setSelectMode(true); setSelected(new Set()); }}
            className="flex items-center gap-1.5 rounded-lg border border-(--border-default) bg-(--surface-2) px-3 py-1.5 text-xs font-semibold text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {isAr ? 'تحديد متعدد' : 'Select'}
          </button>
        )}
      </div>

      {/* Approval progress bar */}
      <ApprovalProgress approved={approvedCount} total={visiblePosts.length} isAr={isAr} />

      {/* Phase B notice — posts pending OGZ internal review */}
      {adminPendingCount > 0 && (
        <div
          className="flex items-center gap-2.5 rounded-(--r-lg) border border-orange-500/30 bg-orange-500/5 px-4 py-2.5 text-xs text-orange-400 mb-2"
          dir={dir}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <span>
            {isAr
              ? `${adminPendingCount} منشور${adminPendingCount > 1 ? 'ات' : ''} قيد المراجعة الداخلية لدى OGZ — ستظهر بعد اعتمادها`
              : `${adminPendingCount} post${adminPendingCount > 1 ? 's' : ''} pending OGZ internal review — they'll appear once approved`}
          </span>
        </div>
      )}

      {/* Summary status bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-xs" dir={dir}>
        <span className="flex items-center gap-1.5 text-(--fg-muted)">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          {isAr ? `موافق عليه (${approvedCount})` : `Approved (${approvedCount})`}
        </span>
        <span className="flex items-center gap-1.5 text-(--fg-muted)">
          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
          {isAr ? `مُنتج (${generatedCount})` : `Generated (${generatedCount})`}
        </span>
        <span className="flex items-center gap-1.5 text-(--fg-muted)">
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          {isAr ? `مسودة (${draftCount})` : `Draft (${draftCount})`}
        </span>
        <span className="h-3 w-px bg-(--border-default)" />
        <span className="flex items-center gap-2 text-(--fg-faint)">
          {contentTypeIcon('offer')}
          {isAr ? 'عرض' : 'Offer'}
          {contentTypeIcon('lifestyle')}
          {isAr ? 'حياة' : 'Life'}
          {contentTypeIcon('emotional')}
          {isAr ? 'عاطفي' : 'Emotion'}
        </span>
      </div>

      {/* ── Mobile: scrollable card list (< md) ─────────────────────────── */}
      <div className="md:hidden space-y-2 mb-4">
        {navigablePosts.length > 0 ? (
          navigablePosts.map((post: any) => {
            const effectiveStatus = approvedIds.has(post.post_id) ? 'approved' : post.status;
            const isHeldMobile = heldPostIds?.has(post.post_id) ?? false;
            const isAdminPendingMobile = post.status === 'generated' && !isHeldMobile;
            return (
              <MobilePostCard
                key={post.post_id}
                post={post}
                isAr={isAr}
                effectiveStatus={effectiveStatus}
                isApproving={pendingIds.has(post.post_id)}
                isHeld={isHeldMobile}
                isAdminPending={isAdminPendingMobile}
                onApprove={handleQuickApprove}
                onOpen={isAdminPendingMobile ? () => {} : setSelectedPost}
              />
            );
          })
        ) : (
          <p className="text-center text-sm text-(--fg-faint) py-8">
            {isAr ? 'لا توجد منشورات لهذا الشهر بعد' : 'No posts for this month yet'}
          </p>
        )}
      </div>

      {/* ── Desktop: 7-column calendar grid (≥ md) ──────────────────────── */}
      <div className="hidden md:block bg-(--surface-2) rounded-(--r-lg) border border-(--border-subtle) shadow-(--shadow-1)">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-(--border-subtle) bg-(--surface-3) rounded-t-(--r-lg)" dir={dir}>
          {weekdays.map((day, i) => {
            const isWeekendCol = offDays.includes(i);
            return (
              <div
                key={i}
                className={`p-3 text-center text-xs font-bold border-r border-(--border-subtle) last:border-r-0 uppercase tracking-wider ${
                  isWeekendCol ? 'text-(--fg-faint)/40 opacity-60' : 'text-(--fg-muted)'
                }`}
              >
                {day}
              </div>
            );
          })}
        </div>

        {/* Grid body */}
        <div className="grid grid-cols-7 auto-rows-[180px]">
          {emptyCells.map((_, i) => (
            <div
              key={`empty-${i}`}
              className={`${offDays.includes(i) ? 'bg-(--surface-1) opacity-40' : 'bg-(--surface-1)'} border-b border-r border-(--border-subtle) last:border-r-0`}
            />
          ))}

          {(() => { _preparingLeft = preparingCount; return null; })()}
          {days.map((day) => {
            const dow = (firstDay + day - 1) % 7;
            const isWeekend = offDays.includes(dow);
            // ALL posts on this day (a day can hold several — e.g. after a
            // reschedule lands on an occupied date). The cell previews the
            // earliest one and shows a "+N" count; each post keeps its own
            // status and is reachable via the drawer's prev/next.
            const dayPosts = isWeekend ? [] : monthPosts
              .filter((p: any) => {
                const d = new Date(p.posting_time);
                return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year;
              })
              .sort((a: any, b: any) =>
                new Date(a.posting_time).getTime() - new Date(b.posting_time).getTime());
            const post = dayPosts[0];
            const extraOnDay = Math.max(0, dayPosts.length - 1);
            // Posts ORIGINALLY planned for this day that were rescheduled away
            // (scheduled_date keeps the first planned day) — the old cell shows
            // a "moved to …" ghost instead of looking like a missing post.
            const movedAway = isWeekend ? [] : monthPosts.filter((p: any) => {
              if (!p.scheduled_date) return false;
              const od = new Date(`${String(p.scheduled_date).slice(0, 10)}T00:00:00`);
              if (!(od.getDate() === day && od.getMonth() === month && od.getFullYear() === year)) return false;
              const nd = new Date(p.posting_time);
              return !(nd.getDate() === day && nd.getMonth() === month && nd.getFullYear() === year);
            });
            // A weekday with no released post, while posts are still being prepared,
            // is a "coming soon" slot → blurred placeholder (consumes the budget).
            const isPreparingSlot = !isWeekend && !post && _preparingLeft > 0;
            if (isPreparingSlot) _preparingLeft -= 1;
            const locked = post ? post.position > freeLimit : false;
            const effectiveStatus = (post && approvedIds.has(post.post_id)) ? 'approved' : post?.status;
            const isHeld = post ? (heldPostIds?.has(post.post_id) ?? false) : false;
            const isAdminPending = post ? (post.status === 'generated' && !isHeld) : false;
            const isRegenerating = post ? regeneratingPostIds.has(post.post_id) : false;
            const isToday = !isWeekend && day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const isSelected = post ? selected.has(post.post_id) : false;
            const isApproving = post ? pendingIds.has(post.post_id) : false;

            return (
              <div
                key={day}
                className={[
                  'relative border-b border-r border-(--border-subtle) group flex flex-col items-center justify-center transition-colors last:border-r-0 overflow-hidden',
                  isWeekend
                    ? 'bg-(--surface-2)/60 cursor-default'
                    : locked
                    ? 'bg-(--surface-1) cursor-default'
                    : post
                    ? `cursor-pointer hover:bg-(--surface-3) ${statusBorderClass(effectiveStatus!)}`
                    : 'bg-(--surface-2)/30 cursor-default',
                  isToday ? 'ring-2 ring-inset ring-emerald-500/70' : '',
                  isSelected ? 'bg-emerald-500/10' : '',
                ].join(' ')}
                style={isWeekend ? {
                  backgroundImage:
                    'repeating-linear-gradient(135deg, transparent 0 8px, rgba(255,255,255,0.025) 8px 16px)',
                } : undefined}
                onClick={() => {
                  if (isWeekend || locked || !post || isAdminPending || isRegenerating) return;
                  if (selectMode) { toggleSelect(post.post_id); return; }
                  setSelectedPost(post);
                }}
              >
                {/* Day number — gets a dark chip backdrop when a real image fills
                    the cell, so it stays readable over the photo. */}
                <span
                  className={`absolute top-1.5 right-2 text-xs font-bold z-20 ${
                    post && post.storage_url ? 'px-1.5 py-0.5 rounded-md bg-black/55 text-white' :
                    isWeekend ? 'text-(--fg-faint) opacity-40' :
                    isToday ? 'text-emerald-400' :
                    post ? 'text-(--fg)' : 'text-(--fg-faint)'
                  }`}
                >
                  {day}
                </span>

                {/* Off-day (weekend) — minimal texture, no icon clutter */}
                {isWeekend && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                    <svg className="w-4 h-4 text-(--fg-faint)/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                    </svg>
                    <span className="text-[8px] font-medium uppercase tracking-wider text-(--fg-faint)/50">
                      {isAr ? 'عطلة' : 'Rest day'}
                    </span>
                  </div>
                )}

                {/* Post moved away — the day originally held a post that was
                    rescheduled to a different date; point the user to it. */}
                {!post && movedAway.length > 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center">
                    <svg className="w-3.5 h-3.5 text-(--fg-faint)/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-[8px] font-semibold leading-tight text-(--fg-faint)/70">
                      {isAr
                        ? `نُقل إلى ${new Date(movedAway[0].posting_time).getDate()}`
                        : `Moved to ${new Date(movedAway[0].posting_time).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`}
                    </span>
                  </div>
                )}

                {/* Plain empty weekday — soft "no post" treatment instead of a
                    stark dark box. */}
                {!post && !isWeekend && !isPreparingSlot && movedAway.length === 0 && !locked && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="h-1 w-1 rounded-full bg-(--fg-faint)/25" aria-hidden />
                  </div>
                )}

                {/* Content type icon — top-right, beside the day number (the
                    top-left corner belongs to the publish badges). */}
                {post && !locked && !isWeekend && (
                  <span className={`absolute top-1.5 right-9 z-10 flex items-center justify-center rounded-full w-5 h-5 ${contentTypeColor(post.content_type)}`}>
                    {contentTypeIcon(post.content_type)}
                  </span>
                )}

                {/* Locked post (free-tier) — FULL-BLEED blurred image + lock. */}
                {locked && post && (
                  <div className="absolute inset-0 overflow-hidden">
                    <MediaThumb
                      post={post}
                      alt=""
                      sizes="120px"
                      className="object-cover blur-sm grayscale opacity-40"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <svg className="w-6 h-6 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                  </div>
                )}

                {/* Admin-pending post — FULL-BLEED "OGZ review" placeholder. */}
                {!isWeekend && !locked && post && isAdminPending && !isRegenerating && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-(--surface-3)">
                    <svg className="w-6 h-6 text-orange-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-orange-400/80 text-center leading-tight">
                      {isAr ? 'مراجعة OGZ' : 'OGZ Review'}
                    </span>
                  </div>
                )}

                {/* Regenerating post — client clicked Regenerate; B03 pipeline is running. */}
                {!isWeekend && !locked && post && isRegenerating && (
                  <div className="absolute inset-0 overflow-hidden">
                    {/* Dim the existing image underneath */}
                    {post.storage_url && (
                      <Image
                        src={post.storage_url.trim()}
                        alt=""
                        fill
                        sizes="120px"
                        className="object-cover opacity-20 blur-[2px]"
                        unoptimized
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-950/80 to-indigo-950/80 flex flex-col items-center justify-center gap-1.5 px-1.5">
                      {/* Animated spinner ring */}
                      <div className="relative flex items-center justify-center">
                        <span className="absolute inline-flex h-8 w-8 rounded-full border border-blue-400/30 animate-ping" style={{ animationDuration: '1.8s' }} />
                        <div className="relative h-6 w-6 rounded-full border-2 border-t-blue-400 border-blue-400/20 animate-spin" />
                      </div>
                      <p className="text-[8.5px] font-bold text-blue-300 tracking-wide text-center leading-tight mt-0.5">
                        {isAr ? 'جارٍ التوليد' : 'Regenerating'}
                      </p>
                      <p className="text-[7px] text-blue-400/60 text-center leading-snug">
                        {isAr ? 'قريبًا' : 'Coming soon'}
                      </p>
                    </div>
                    <div className="absolute inset-[3px] rounded-lg border border-dashed border-blue-500/30 pointer-events-none" />
                  </div>
                )}

                {/* Normal working-day post */}
                  {!isWeekend && !locked && post && !isAdminPending && !isRegenerating && (
                  <>
                    {/* Thumbnail — FILLS the whole cell (no floating margin). A video
                        storage_url (.mp4) renders in <video>, never <Image> (which
                        would show a broken/black box). */}
                    <div className="absolute inset-0 overflow-hidden transition-transform duration-300 group-hover:scale-105">
                      <MediaThumb post={post} alt={`Post ${day}`} sizes="96px" />
                      {/* Watermark badge */}
                      {post.watermark && (
                        <div className="absolute bottom-0 inset-x-0 py-0.5 text-center bg-amber-500/80 text-[8px] font-bold text-white tracking-wide">
                          {isAr ? 'مسودة بصرية' : 'AI DRAFT'}
                        </div>
                      )}
                      {/* Under Review badge — post is held in QA queue */}
                      {isHeld && !post.watermark && (
                        <div className="absolute bottom-0 inset-x-0 py-0.5 text-center bg-violet-600/80 text-[8px] font-bold text-white tracking-wide">
                          {isAr ? 'قيد المراجعة' : 'REVIEW'}
                        </div>
                      )}
                      {/* Live countdown — approved + queued in Postiz */}
                      {post.publish_status === 'scheduled' && post.posting_time && (
                        <CountdownBadge target={post.posting_time} isAr={isAr} />
                      )}
                      {/* Published badge — live on Instagram (top-left) */}
                      {post.publish_status === 'published' && (
                        <div className="absolute top-1.5 start-2 z-20 flex items-center gap-1 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[8px] font-bold text-white">
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {isAr ? 'نُشر' : 'POSTED'}
                        </div>
                      )}
                      {/* Posting time — top-left (start) chip, mirroring the day
                          chip on the other corner. Scheduled posts show the live
                          countdown there instead; published posts show POSTED. */}
                      {post.posting_time &&
                        post.publish_status !== 'scheduled' &&
                        post.publish_status !== 'published' && (
                        <span className="absolute top-1.5 start-2 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white" dir="ltr">
                          {fmtTime(post.posting_time, isAr)}
                        </span>
                      )}
                      {/* Extra-posts count — bottom-end */}
                      {extraOnDay > 0 && (
                        <span className="absolute bottom-1 end-1 z-10 rounded-full bg-black/70 px-1.5 py-0.5 text-[8px] font-bold text-white" dir="ltr">
                          +{extraOnDay}
                        </span>
                      )}
                    </div>

                    {/* Bottom pill — approved checkmark, or publish_status when meaningful */}
                    {effectiveStatus === 'approved' && (
                      <div className="absolute bottom-2 inset-x-0 flex justify-center">
                        {post.publish_status === 'scheduled' ? (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-600 text-white border border-blue-400/40 font-bold shadow-sm">
                            {isAr ? 'مجدول' : 'Scheduled'}
                          </span>
                        ) : post.publish_status === 'published' ? (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-600 text-white border border-emerald-400/40 font-bold shadow-sm">
                            {isAr ? 'منشور' : 'Published'}
                          </span>
                        ) : post.publish_status === 'failed' ? (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-rose-600 text-white border border-rose-400/40 font-bold shadow-sm">
                            {isAr ? 'فشل' : 'Failed'}
                          </span>
                        ) : post.publish_status === 'manual_required' ? (
                          <span
                            title={isAr ? 'التاريخ انتهى — سيتطلب الرفع اليدوي' : 'Date passed — manual upload needed'}
                            className="text-[9px] px-2 py-0.5 rounded-full bg-orange-600 text-white border border-orange-400/40 font-bold shadow-sm"
                          >
                            {isAr ? 'يدوي' : 'Manual'}
                          </span>
                        ) : (
                          <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold shadow-sm">
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            {isAr ? 'موافق' : 'OK'}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quick-approve button — appears on hover for non-approved */}
                    {effectiveStatus !== 'approved' && !selectMode && (
                      <button
                        onClick={(e) => handleQuickApprove(post.post_id, e)}
                        disabled={isApproving}
                        className="absolute bottom-2 inset-x-0 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 disabled:opacity-40"
                        title={isAr ? 'موافقة سريعة' : 'Quick approve'}
                      >
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold">
                          {isApproving ? <Spinner /> : (
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {isAr ? 'وافق' : 'Approve'}
                        </span>
                      </button>
                    )}

                    {/* Hover tooltip */}
                    {!selectMode && (
                      <div className="absolute z-50 w-64 bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-out bg-(--surface-1) border border-(--border-strong) p-3 rounded-xl shadow-xl pointer-events-none">
                        <div className="relative w-full aspect-square mb-3 rounded-md overflow-hidden">
                          <MediaThumb
                            post={post}
                            alt="Preview"
                            sizes="256px"
                            className={`object-cover ${!post.storage_url ? 'opacity-70' : ''}`}
                          />
                          {post.format_tier === 'video' && (
                            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-black/60 text-white px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              {isAr ? 'فيديو' : 'VIDEO'}
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-(--fg) line-clamp-2 leading-relaxed" dir="rtl" lang="ar">
                          {post.caption_ar}
                        </p>
                        <div className="flex items-center justify-between mt-2 flex-wrap gap-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusChipClass(effectiveStatus!)}`}>
                            {statusLabel(effectiveStatus!, isAr)}
                          </span>
                          {post.posting_time && new Date(post.posting_time) < new Date() && effectiveStatus !== 'approved' && (
                            <span
                              title={isAr ? 'التاريخ انتهى — سيتطلب الرفع اليدوي' : 'Date passed — requires manual upload'}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30"
                            >
                              {isAr ? 'منتهي' : 'Past'}
                            </span>
                          )}
                          <div className="flex items-center gap-1.5">
                            {post.watermark && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                                {isAr ? 'مسودة بصرية' : 'AI Draft'}
                              </span>
                            )}
                            <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${contentTypeColor(post.content_type)}`}>
                              {contentTypeIcon(post.content_type)}
                            </span>
                            {post.posting_time && (
                              <time className="text-[10px] text-(--fg-faint)">
                                {fmtTime(post.posting_time, isAr)}
                              </time>
                            )}
                          </div>
                        </div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-(--border-strong)" />
                      </div>
                    )}

                    {/* Select mode checkbox */}
                    {selectMode && (
                      <div className={`absolute top-1.5 left-1.5 z-20 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-emerald-500 border-emerald-500' : 'bg-black/40 border-white/60'
                      }`}>
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Working day, post generated but NOT yet released → refined
                    "pending review" tile — neutral, calm, no aggressive colour. */}
                {isPreparingSlot && (
                  <div className="absolute inset-0 overflow-hidden">
                    {/* Very subtle warm tint — not sky-blue, not distracting */}
                    <div className="absolute inset-0 bg-(--surface-2)" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2">
                      {/* Animated pulse ring */}
                      <div className="relative flex items-center justify-center">
                        <span className="absolute inline-flex h-7 w-7 rounded-full bg-(--fg-faint)/8 animate-ping" style={{ animationDuration: '2.4s' }} />
                        <div className="relative h-6 w-6 rounded-full bg-(--surface-3) border border-(--border-subtle) flex items-center justify-center">
                          <svg className="w-3 h-3 text-(--fg-muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" strokeLinecap="round"/>
                          </svg>
                        </div>
                      </div>
                      <div className="text-center space-y-0.5">
                        <p className="text-[9px] font-semibold text-(--fg-muted) tracking-wide">
                          {isAr ? 'قيد المراجعة' : 'In Review'}
                        </p>
                        <p className="text-[7.5px] text-(--fg-faint) leading-snug">
                          {isAr ? 'يصلك قريبًا' : 'Coming soon'}
                        </p>
                      </div>
                    </div>
                    {/* Dashed border hint */}
                    <div className="absolute inset-[3px] rounded-lg border border-dashed border-(--border-subtle)/60 pointer-events-none" />
                  </div>
                )}

                {/* Working day with no post — empty, very quiet */}
                {!isWeekend && !locked && !post && !isPreparingSlot && (
                  <div className="absolute inset-0 flex items-end justify-start p-2">
                    <span className="text-[7px] font-semibold uppercase tracking-[0.12em] text-(--fg-faint)/20 select-none">
                      {/* intentionally nearly invisible — just prevents pure-black emptiness */}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upgrade section — below calendar for free tier */}
      {isFreeTier && lockedPosts.length > 0 && (
        <UpgradeSection count={lockedPosts.length} slug={slug} isAr={isAr} />
      )}

      {/* Floating select action bar */}
      {selectMode && (
        <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-2 sm:gap-3 rounded-2xl bg-(--surface-1) border border-(--border-default) px-4 py-3 shadow-2xl backdrop-blur-sm">
          <span className="text-sm font-semibold text-(--fg) whitespace-nowrap">
            {selected.size === 0
              ? (isAr ? 'اختر منشورات' : 'Select posts')
              : (isAr ? `${selected.size} محدد` : `${selected.size} selected`)}
          </span>
          <div className="hidden sm:block h-4 w-px bg-(--border-default)" />
          <button onClick={selectAll} className="text-sm text-(--fg-muted) hover:text-(--fg) transition-colors whitespace-nowrap">
            {isAr ? 'تحديد الكل' : 'All'}
          </button>
          <button onClick={cancelSelect} disabled={bulkApproving} className="text-sm text-(--fg-muted) hover:text-(--fg) transition-colors disabled:opacity-40 whitespace-nowrap">
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          {/* Approve Selected */}
          <button
            onClick={handleBulkApprove}
            disabled={selected.size === 0 || bulkApproving}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition-all disabled:opacity-40 hover:bg-emerald-500 whitespace-nowrap"
          >
            {bulkApproving ? (
              <Spinner />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {isAr
              ? (bulkApproving ? 'جارٍ…' : `موافقة (${selected.size})`)
              : (bulkApproving ? 'Approving…' : `Approve (${selected.size})`)}
          </button>
          {/* Download Selected */}
          {downloadMeta && (
            <button
              onClick={downloadSelected}
              disabled={selected.size === 0 || bulkApproving}
              className="flex items-center gap-1.5 rounded-xl border border-(--border-default) bg-(--surface-3) px-3 py-1.5 text-sm font-semibold text-(--fg-muted) transition-all disabled:opacity-40 hover:bg-(--surface-2) hover:text-(--fg) whitespace-nowrap"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {isAr ? `تنزيل (${selected.size})` : `Download (${selected.size})`}
            </button>
          )}
        </div>
      )}

      <SideDrawer
        post={selectedPost}
        isOpen={!!selectedPost}
        onClose={() => setSelectedPost(null)}
        onPrev={handlePrev}
        onNext={handleNext}
        hasPrev={selectedIndex > 0}
        hasNext={selectedIndex < navigablePosts.length - 1}
        dayInfo={(() => {
          // Posts sharing the selected post's calendar day — drawer shows a
          // "k/N this day" chip so multi-post days are visible while paging.
          if (!selectedPost?.posting_time) return null;
          const d = new Date(selectedPost.posting_time);
          const sameDay = navigablePosts.filter((p: any) => {
            const pd = new Date(p.posting_time);
            return pd.getDate() === d.getDate() && pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
          });
          if (sameDay.length < 2) return null;
          const idx = sameDay.findIndex((p: any) => p.post_id === selectedPost.post_id);
          return { index: idx + 1, count: sameDay.length };
        })()}
        slug={slug}
        locale={locale}
        brandNameAr={brandNameAr}
        brandLogoUrl={brandLogoUrl}
        channel={channel}
        strings={strings}
        isHeld={selectedPost ? (heldPostIds?.has(selectedPost.post_id) ?? false) : false}
        onRegenStart={handleRegenStart}
        onRegenEnd={handleRegenEnd}
      />
    </>
  );
}
