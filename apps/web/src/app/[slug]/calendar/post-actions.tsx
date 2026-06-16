'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createClient } from '@supabase/supabase-js';
import { toast } from '@repo/ui/client/toast';
import {
  approvePost,
  publishPost,
  publishNowPost,
  pausePublishing,
  reschedulePost,
  reconcilePublish,
  requestChanges,
} from './actions';

type PublishStatus =
  | 'unscheduled'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'manual_required'
  | null;

export function PostActions({
  postId,
  slug,
  status,
  publishStatus,
  publishRequestedAt = null,
  postingTime = null,
  externalPostId = null,
  revisionCount = 0,
  storageUrl,
  strings,
  isAr = false,
}: {
  postId: string;
  slug: string;
  status: string;
  publishStatus?: PublishStatus;
  publishRequestedAt?: string | null;
  /** calendar_posts.posting_time — drives the live countdown for scheduled posts. */
  postingTime?: string | null;
  /** Instagram permalink (external_post_id) once published via Postiz reconcile. */
  externalPostId?: string | null;
  revisionCount?: number;
  storageUrl: string | null;
  strings: { approve: string; requestChanges: string; download: string; publish?: string };
  isAr?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  // Which button kicked off the in-flight action — all buttons disable while
  // pending, but ONLY the clicked one shows a spinner.
  const [activeAction, setActiveAction] = useState<
    'approve' | 'schedule' | 'publish_now' | 'pause' | 'reschedule' | 'revision' | null
  >(null);
  const busy = (a: typeof activeAction) => isPending && activeAction === a;
  const [localStatus, setLocalStatus] = useState(status);
  const [localPublishStatus, setLocalPublishStatus] = useState<PublishStatus>(publishStatus ?? null);
  const [localPostingTime, setLocalPostingTime] = useState<string | null>(postingTime);
  const [localExternalUrl, setLocalExternalUrl] = useState<string | null>(externalPostId);
  // Whether the client has clicked "Publish" yet. null = not requested → show the
  // Publish button; truthy = publishing started → show the live status badge.
  const [publishRequested, setPublishRequested] = useState<boolean>(!!publishRequestedAt);
  const [localRevisionCount, setLocalRevisionCount] = useState(revisionCount);
  const [error, setError] = useState<string | null>(null);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [showTimeInput, setShowTimeInput] = useState(false);
  const [newTime, setNewTime] = useState('');
  // Schedule-time picker for the pre-schedule panel: prefilled with the
  // recommended posting_time when it's still in the future, otherwise with
  // "in 1 hour" so a passed slot never dead-ends the user.
  const [scheduleTime, setScheduleTime] = useState<string>(() => {
    const base = postingTime ? new Date(postingTime) : null;
    const future = base && base.getTime() > Date.now()
      ? base
      : new Date(Date.now() + 60 * 60 * 1000);
    return toLocalInputValue(future.toISOString());
  });

  function handleApprove() {
    setError(null);
    setShowReasonInput(false);
    setActiveAction('approve');
    startTransition(async () => {
      const result = await approvePost(postId, slug);
      if (result.ok) {
        setLocalStatus('approved');
        // Soft warning: post is approved but the scheduling handshake failed
        if (result.error) {
          setError(result.error);
          toast.error(result.error);
        } else {
          toast.success(isAr ? 'تم اعتماد المنشور' : 'Post approved');
        }
      } else {
        const msg = result.error ?? (isAr ? 'حدث خطأ ما.' : 'Something went wrong.');
        setError(msg);
        toast.error(msg);
      }
    });
  }

  function handleSchedule() {
    if (!scheduleTime) {
      setError(isAr ? 'اختر وقت النشر أولاً' : 'Pick a publish time first.');
      return;
    }
    const chosen = new Date(scheduleTime);
    if (isNaN(chosen.getTime()) || chosen.getTime() <= Date.now()) {
      setError(isAr ? 'اختر وقتاً في المستقبل' : 'Pick a time in the future.');
      return;
    }
    const iso = chosen.toISOString();
    setError(null);
    setActiveAction('schedule');
    startTransition(async () => {
      const result = await publishPost(postId, slug, iso);
      if (result.ok) {
        setPublishRequested(true);
        setLocalPostingTime(iso);
        setLocalPublishStatus((result.publishStatus as PublishStatus) ?? 'scheduled');
        if (result.error) {
          setError(result.error);
          toast.error(result.error);
        } else {
          toast.success(isAr ? 'تمت الجدولة — سيُنشر تلقائياً في موعده' : 'Scheduled — will publish automatically on time');
        }
      } else {
        const msg = result.error ?? (isAr ? 'حدث خطأ ما.' : 'Something went wrong.');
        setError(msg);
        toast.error(msg);
      }
    });
  }

  function handlePublishNow() {
    if (!window.confirm(isAr ? 'نشر هذا المنشور على إنستغرام الآن؟' : 'Publish this post to Instagram right now?')) return;
    setError(null);
    setActiveAction('publish_now');
    startTransition(async () => {
      const result = await publishNowPost(postId, slug);
      if (result.ok) {
        setPublishRequested(true);
        setLocalPublishStatus((result.publishStatus as PublishStatus) ?? 'published');
        if (result.error) {
          setError(result.error);
          toast.error(result.error);
        } else {
          toast.success(isAr ? 'تم النشر على إنستغرام 🎉' : 'Published to Instagram 🎉');
        }
      } else {
        const msg = result.error ?? (isAr ? 'حدث خطأ ما.' : 'Something went wrong.');
        setError(msg);
        toast.error(msg);
      }
    });
  }

  function handlePause() {
    setError(null);
    setActiveAction('pause');
    startTransition(async () => {
      const result = await pausePublishing(postId, slug);
      if (result.ok) {
        setPublishRequested(false);
        setLocalPublishStatus('unscheduled');
        toast.success(isAr ? 'تم إيقاف النشر المجدول' : 'Scheduled publishing paused');
      } else {
        const msg = result.error ?? (isAr ? 'حدث خطأ ما.' : 'Something went wrong.');
        setError(msg);
        toast.error(msg);
      }
    });
  }

  function handleReschedule() {
    if (!newTime) return;
    const iso = new Date(newTime).toISOString();
    setError(null);
    setActiveAction('reschedule');
    startTransition(async () => {
      const result = await reschedulePost(postId, slug, iso);
      if (result.ok) {
        setLocalPostingTime(iso);
        setShowTimeInput(false);
        if (result.publishStatus) setLocalPublishStatus(result.publishStatus as PublishStatus);
        if (result.error) {
          setError(result.error);
          toast.error(result.error);
        } else {
          toast.success(isAr ? 'تم تغيير وقت النشر' : 'Posting time updated');
        }
      } else {
        const msg = result.error ?? (isAr ? 'حدث خطأ ما.' : 'Something went wrong.');
        setError(msg);
        toast.error(msg);
      }
    });
  }

  // Countdown-driven reconcile: once a scheduled post's time passes, ask the
  // server to check Postiz (state PUBLISHED → flip badge + store IG link).
  const reconcileTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (reconcileTimer.current) clearInterval(reconcileTimer.current); }, []);
  function startReconcilePolling() {
    if (reconcileTimer.current) return;
    const startedAt = Date.now();
    reconcileTimer.current = setInterval(async () => {
      try {
        const res = await reconcilePublish(postId, slug);
        if (res.publishStatus && res.publishStatus !== 'scheduled') {
          setLocalPublishStatus(res.publishStatus as PublishStatus);
          if (reconcileTimer.current) clearInterval(reconcileTimer.current);
          reconcileTimer.current = null;
          if (res.publishStatus === 'published') {
            toast.success(isAr ? 'تم النشر على إنستغرام 🎉' : 'Published to Instagram 🎉');
          }
        }
      } catch { /* transient — keep polling */ }
      if (Date.now() - startedAt > 10 * 60_000 && reconcileTimer.current) {
        clearInterval(reconcileTimer.current);
        reconcileTimer.current = null;
      }
    }, 20_000);
  }

  function handleConfirmRevision() {
    const reason = revisionReason.trim();
    if (reason.length < 5) {
      setError(isAr ? 'يرجى كتابة سبب واضح (5 أحرف على الأقل)' : 'Please enter a reason (at least 5 characters).');
      return;
    }
    setError(null);
    setActiveAction('revision');
    startTransition(async () => {
      const result = await requestChanges(postId, slug, reason);
      if (result.ok) {
        // 'revision_requested' is a UI-only state — DB holds 'pending'.
        // Keeps both buttons locked while B03 runs async (2-3 min).
        setLocalStatus('revision_requested');
        setLocalRevisionCount(c => c + 1);
        setShowReasonInput(false);
        setRevisionReason('');
        toast.success(isAr ? 'تم طلب التعديلات' : 'Changes requested');
      } else {
        const msg = result.error ?? (isAr ? 'حدث خطأ ما.' : 'Something went wrong.');
        setError(msg);
        toast.error(msg);
      }
    });
  }

  // Subscribe to publish_status changes after the client clicks Publish.
  // n8n updates the row asynchronously; this updates the badge in real-time.
  // Only subscribe once publishing has been requested and is not yet in a terminal
  // state — an approved-but-unpublished post needs no listener.
  useEffect(() => {
    if (localStatus !== 'approved') return;
    if (!publishRequested) return;
    // Keep listening while 'scheduled' too — a reconcile from another tab or
    // page load can flip the row to published/failed server-side.
    if (localPublishStatus === 'published') return;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const channel = supabase
      .channel(`post-publish-status-${postId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calendar_posts',
          filter: `post_id=eq.${postId}`,
        },
        (payload) => {
          const row = payload.new as { publish_status: PublishStatus; external_post_id?: string | null };
          if (row.publish_status) setLocalPublishStatus(row.publish_status);
          if (row.external_post_id) setLocalExternalUrl(row.external_post_id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, localStatus, localPublishStatus, publishRequested]);

  const isApproved = localStatus === 'approved';
  const isRevisionRequested = localStatus === 'revision_requested';
  // 'pending' + count > 0 means B03 is actively regenerating; count = 0 is just the initial generated state.
  const isRevisionInProgress = localStatus === 'pending' && localRevisionCount > 0;
  const revisionLimitReached = localRevisionCount >= 3;

  return (
    <div className="space-y-2.5">

      {/* Approve — full-width primary CTA */}
      {isRevisionRequested || isRevisionInProgress ? (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold bg-amber-600/20 border border-amber-500/30 text-amber-400">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {isAr ? 'جارٍ المراجعة…' : 'Revision in progress…'}
        </div>
      ) : (
        <button
          onClick={handleApprove}
          disabled={isPending || isApproved}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          {busy('approve') ? (
            <Spinner />
          ) : isApproved ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              تمت الموافقة
            </>
          ) : (
            strings.approve
          )}
        </button>
      )}

      {/* Publishing controls — explicit step AFTER approval.
          unscheduled/failed → Schedule (at posting_time) + Publish now buttons.
          scheduled → live countdown + Publish now / Pause / Change time.
          published → green badge with the Instagram permalink. */}
      {isApproved && localPublishStatus === 'published' ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/15 px-3 py-2.5 text-sm font-bold text-emerald-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {isAr ? 'تم النشر على إنستغرام' : 'Published to Instagram'}
          {localExternalUrl && (
            <a
              href={localExternalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 text-xs font-semibold hover:opacity-80"
            >
              {isAr ? 'عرض' : 'View'}
            </a>
          )}
        </div>
      ) : isApproved && localPublishStatus === 'scheduled' ? (
        <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-600/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-emerald-400">
              {isAr ? 'مجدول — ينشر تلقائياً خلال' : 'Scheduled — publishes in'}
            </span>
            <Countdown
              target={localPostingTime}
              isAr={isAr}
              onExpire={startReconcilePolling}
            />
          </div>
          {showTimeInput ? (
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="flex-1 rounded-lg border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 text-xs text-(--fg) focus:outline-none focus:ring-1 focus:ring-(--accent)"
              />
              <button
                onClick={handleReschedule}
                disabled={isPending || !newTime}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
              >
                {busy('reschedule') ? <Spinner /> : (isAr ? 'حفظ' : 'Save')}
              </button>
              <button
                onClick={() => setShowTimeInput(false)}
                disabled={isPending}
                className="rounded-lg border border-(--border-default) bg-(--surface-3) px-2.5 py-1.5 text-xs font-semibold text-(--fg-muted) hover:text-(--fg) transition-colors"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handlePublishNow}
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
              >
                {busy('publish_now') ? <Spinner /> : (isAr ? 'انشر الآن' : 'Publish now')}
              </button>
              <button
                onClick={() => {
                  setShowTimeInput(true);
                  setNewTime(localPostingTime ? toLocalInputValue(localPostingTime) : '');
                }}
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-(--border-default) bg-(--surface-2) py-1.5 text-xs font-semibold text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors disabled:opacity-50"
              >
                {isAr ? 'تغيير الوقت' : 'Change time'}
              </button>
              <button
                onClick={handlePause}
                disabled={isPending}
                title={isAr ? 'إيقاف النشر المجدول' : 'Pause scheduled publishing'}
                className="flex items-center justify-center rounded-lg border border-amber-500/40 bg-amber-600/10 px-2.5 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-600/20 transition-colors disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ) : isApproved ? (
        /* Ready to publish (unscheduled / failed / legacy manual_required):
           the user accepts the recommended time, edits it, or publishes now. */
        <div className="space-y-2">
          {localPublishStatus === 'failed' && <PublishStatusBadge status="failed" isAr={isAr} />}
          {(localPublishStatus === 'manual_required' ||
            (postingTime && new Date(postingTime).getTime() <= Date.now())) && (
            <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-400" dir={isAr ? 'rtl' : 'ltr'}>
              {isAr
                ? 'الوقت المقترح لهذا المنشور انتهى — اختر وقتاً جديداً للجدولة أو انشره الآن.'
                : 'This post\'s recommended time has passed — pick a new time to schedule, or publish now.'}
            </p>
          )}
          <div className="rounded-xl border border-(--border-subtle) bg-(--surface-2) p-2.5 space-y-2">
            <label className="flex items-center justify-between gap-2" dir={isAr ? 'rtl' : 'ltr'}>
              <span className="shrink-0 text-xs font-semibold text-(--fg-muted)">
                {isAr ? 'وقت النشر' : 'Publish time'}
              </span>
              <input
                type="datetime-local"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="rounded-lg border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 text-xs text-(--fg) focus:outline-none focus:ring-1 focus:ring-(--accent)"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={handleSchedule}
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 bg-blue-600 hover:bg-blue-500 text-white"
              >
                {busy('schedule') ? <Spinner /> : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="9" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
                    </svg>
                    {isAr ? 'جدولة النشر' : 'Schedule'}
                  </>
                )}
              </button>
              <button
                onClick={handlePublishNow}
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 bg-(--surface-2) border border-blue-500/40 text-blue-400 hover:bg-blue-600/10"
              >
                {busy('publish_now') ? <Spinner className="text-blue-400" /> : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                    </svg>
                    {isAr ? 'انشر الآن' : 'Publish now'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Revision reason input — shown after clicking Request Revision */}
      {showReasonInput && (
        <div className="rounded-xl border border-(--border-default) bg-(--surface-2) p-3 space-y-2">
          <p className="text-xs font-semibold text-(--fg-muted)" dir={isAr ? 'rtl' : 'ltr'}>
            {isAr ? 'ما سبب طلب المراجعة؟' : 'Why do you want to revise this post?'}
          </p>
          <textarea
            value={revisionReason}
            onChange={e => setRevisionReason(e.target.value)}
            placeholder={isAr ? 'مثال: النص طويل جداً، اللهجة غير مناسبة...' : 'e.g. Caption is too long, wrong tone...'}
            rows={3}
            dir={isAr ? 'rtl' : 'ltr'}
            className="w-full resize-none rounded-lg border border-(--border-subtle) bg-(--surface-1) px-3 py-2 text-xs text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-1 focus:ring-(--accent)"
          />
          <div className="flex gap-2">
            <button
              onClick={handleConfirmRevision}
              disabled={isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
            >
              {busy('revision') ? <Spinner /> : (isAr ? 'تأكيد الطلب' : 'Confirm Revision')}
            </button>
            <button
              onClick={() => { setShowReasonInput(false); setRevisionReason(''); setError(null); }}
              disabled={isPending}
              className="rounded-lg border border-(--border-default) bg-(--surface-3) px-3 py-1.5 text-xs font-semibold text-(--fg-muted) hover:text-(--fg) transition-colors disabled:opacity-50"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Secondary row: Request Revision + Download */}
      {!showReasonInput && (
        <div className="flex gap-2">
          {/* Revision limit badge — shown when limit reached and not yet approved */}
          {revisionLimitReached && !isApproved ? (
            <div className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700/50 bg-(--surface-2) py-2 text-xs font-semibold text-zinc-500 cursor-default select-none">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {isAr ? 'النسخة النهائية (3/3)' : 'Final version (3/3)'}
            </div>
          ) : !isApproved ? (
            <button
              onClick={() => { setShowReasonInput(true); setError(null); }}
              disabled={isPending || isRevisionInProgress || isRevisionRequested}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-(--border-default) bg-(--surface-2) py-2 text-xs font-semibold text-(--fg-muted) transition-colors hover:bg-(--surface-3) hover:text-(--fg) disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {isAr
                ? `طلب مراجعة (${localRevisionCount}/3)`
                : `Request Revision (${localRevisionCount}/3)`}
            </button>
          ) : null}

          {storageUrl && (
            <a
              href={storageUrl}
              download
              className="flex items-center justify-center gap-1.5 rounded-xl border border-(--border-default) bg-(--surface-2) px-3 py-2 text-xs font-semibold text-(--fg-muted) transition-colors hover:bg-(--surface-3) hover:text-(--fg)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {strings.download}
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="relative rounded-lg border border-red-500/40 bg-red-500/10 p-3 flex items-start gap-2.5">
          <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-300 mb-1">{isAr ? 'حدث خطأ' : 'Error'}</p>
            <p className="text-xs text-red-200 leading-relaxed" dir={isAr ? 'rtl' : 'ltr'}>{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-300 transition-colors shrink-0"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function PublishStatusBadge({ status, isAr }: { status: PublishStatus; isAr: boolean }) {
  if (!status || status === 'published') return null;

  const config: Record<NonNullable<Exclude<PublishStatus, 'published'>>, { label: string; classes: string; spinner: boolean }> = {
    unscheduled: {
      label: isAr ? 'جارٍ الجدولة…' : 'Scheduling…',
      classes: 'bg-amber-600/20 border-amber-500/30 text-amber-400',
      spinner: true,
    },
    scheduled: {
      label: isAr ? 'مجدول للنشر' : 'Scheduled',
      classes: 'bg-emerald-600/15 border-emerald-500/30 text-emerald-400',
      spinner: false,
    },
    failed: {
      label: isAr ? 'فشل النشر — تواصل مع الدعم' : 'Publishing failed — contact support',
      classes: 'bg-red-500/15 border-red-500/40 text-red-300',
      spinner: false,
    },
    manual_required: {
      label: isAr ? 'يتطلب النشر اليدوي' : 'Manual publish required',
      classes: 'bg-zinc-500/15 border-zinc-500/40 text-zinc-300',
      spinner: false,
    },
  };

  const c = config[status];
  if (!c) return null;

  return (
    <div className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${c.classes}`}>
      {c.spinner && (
        <svg className="h-3.5 w-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {c.label}
    </div>
  );
}

/**
 * Live ticking countdown to `target`. Once it reaches zero it shows
 * "Publishing…" and fires onExpire exactly once (the parent starts polling
 * the Postiz reconcile action). Pure client-side — no requests while ticking.
 */
function Countdown({
  target,
  isAr,
  onExpire,
}: {
  target: string | null;
  isAr: boolean;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = target ? new Date(target).getTime() - now : null;

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      onExpire();
    }
  }, [remaining, onExpire]);

  if (remaining === null) return null;

  if (remaining <= 0) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs font-bold text-emerald-300">
        <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {isAr ? 'جارٍ النشر…' : 'Publishing…'}
      </span>
    );
  }

  const totalSec = Math.floor(remaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = days > 0
    ? `${days}${isAr ? 'ي' : 'd'} ${pad(hours)}:${pad(mins)}:${pad(secs)}`
    : `${pad(hours)}:${pad(mins)}:${pad(secs)}`;

  return (
    <span dir="ltr" className="font-mono text-sm font-bold tabular-nums text-emerald-300">
      {text}
    </span>
  );
}

/** ISO string → value for <input type="datetime-local"> in the user's local TZ. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Spinner({ className = 'text-white' }: { className?: string }) {
  return (
    <svg className={`w-3.5 h-3.5 animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
