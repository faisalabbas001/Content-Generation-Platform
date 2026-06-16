'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@repo/ui/badge'
import { Spinner } from '@repo/ui/spinner'
import { approveQaItem, rejectQaItem } from '@/app/actions/qa'
import type { QaQueueItem } from '@repo/db'
import { scoreBand } from '@repo/core'
import { ScoreInsightPanel } from '../../score-insight'
import { AdminRegenerateButton } from '../../admin-regenerate-button'
import { AdminRegenHistory } from '../../admin-regen-history'

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  first_ever_client_output:             'First-ever output',
  brave_route_flagged:                  'CCO brave-route flag',
  healthcare_health_claim:              'Health claim',
  finance_investment_claim:             'Finance claim',
  government_sector:                    'Government sector',
  religious_reference_high_sensitivity: 'High religious sensitivity',
  dialect_unconfirmed_hero:             'Dialect unconfirmed',
  unresolved_conflict_record:           'Conflict record',
  revision_cycle_exceeded:              'Revision limit reached',
  cco_low_confidence:                   'CCO low score (<50)',
  hard_block_negative_pattern:          'Hard block',
  method_violation:                     'Method drift',
  ceo_hold:                             'CEO hold',
  human_gate_override:                  'Admin hold',
}

const TRIGGER_DETAILS: Record<string, string> = {
  first_ever_client_output:             "Brand's first output — held for initial quality audit.",
  brave_route_flagged:                  'CCO agent flagged content as culturally risky. Human sign-off required.',
  healthcare_health_claim:              'Healthcare post with health/testimonial claim. Compliance hold.',
  finance_investment_claim:             'Financial benefit claim. Must be verified before publication.',
  government_sector:                    'All government sector content held by policy (defence-in-depth).',
  religious_reference_high_sensitivity: 'Religious reference for a High-sensitivity brand.',
  dialect_unconfirmed_hero:             'COO could not confirm Arabic dialect. Manual check needed.',
  unresolved_conflict_record:           'Brand has an unresolved conflict record.',
  revision_cycle_exceeded:              'Max revision cycles reached. Final human decision required.',
  cco_low_confidence:                   'CCO score < 50 — quality below threshold.',
  hard_block_negative_pattern:          'Matches a prohibited negative-pattern rule. Cannot auto-approve.',
  method_violation:                     'Post deviated from the approved brand method contract.',
  ceo_hold:                             'CEO routing layer flagged based on brand risk profile.',
  human_gate_override:                  'Manually placed on hold by an admin.',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Hard Rule #3 (CLAUDE.md): Arabic text NEVER in image prompts.
const ARABIC_RE = /[؀-ۿ]/

function scoreTextColor(score: number | null | undefined): string {
  const b = scoreBand(score)
  return b === 'clean' ? 'text-emerald-400' : b === 'mark' ? 'text-amber-400' : 'text-red-400'
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1500) }}
      className="shrink-0 rounded-md p-1.5 text-(--fg-faint) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
      title={ok ? 'Copied!' : 'Copy'}
    >
      {ok
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-emerald-400"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      }
    </button>
  )
}

// ─── Action phase ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'confirm_approve' | 'confirm_reject' | 'submitting'

// ─── Main component ───────────────────────────────────────────────────────────

export function OnDemandInspectionPage({
  item,
  backHref,
}: {
  item: QaQueueItem
  backHref: string
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState<'preview' | 'deepseek' | 'cco' | 'history'>('preview')
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)

  // Escape → dismiss confirm or navigate back
  useEffect(() => {
    function h(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (phase !== 'idle') { setPhase('idle'); return }
        router.push(backHref)
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [phase, backHref, router])

  // ── Data extraction ────────────────────────────────────────────────────────

  const flagTriggers = Array.isArray((item.flags as Record<string, unknown> | null)?.human_gate_triggers)
    ? ((item.flags as Record<string, unknown>).human_gate_triggers as Array<{ trigger?: number; reason?: string; detail?: string }>)
    : []
  const flagDetailByReason: Record<string, string> = {}
  for (const t of flagTriggers) if (t?.reason) flagDetailByReason[t.reason] = t.detail ?? ''
  const triggerKeys = flagTriggers.length > 0
    ? flagTriggers.map((t) => t.reason).filter((r): r is string => !!r)
    : (item.trigger_reason ?? '').split(/[|,]/).map((s) => s.trim()).filter(Boolean)

  const isHardBlock = triggerKeys.includes('hard_block_negative_pattern')
  const isDecided = item.status === 'approved' || item.status === 'rejected'

  // Selected draft overlay (admin regenerations)
  const selectedDraft = selectedDraftId
    ? (item.admin_regenerations ?? []).find((d) => d.regen_id === selectedDraftId)
    : null
  const displayMedia = selectedDraft && item.media
    ? ({
        ...item.media,
        storage_url:       selectedDraft.storage_url,
        clean_storage_url: selectedDraft.clean_storage_url,
        confidence_score:  selectedDraft.confidence_score,
        watermark:         selectedDraft.watermark,
        media_type:        selectedDraft.media_type,
      })
    : item.media

  const isVideo =
    displayMedia?.media_type === 'video' ||
    /\.mp4(\?|$)/i.test(displayMedia?.storage_url ?? '')

  // When a revision is selected, its custom prompt overrides drive the detail
  // panels; a revision generated with "Use Existing Prompt" has no override, so
  // we fall back to the originating brief (the prompt it actually used).
  const draftOverride = selectedDraft?.prompt_override ?? null

  // Scores — on-demand CCO score is often a literal 0 (meaningless); treat as absent
  const hasCco = !selectedDraft && item.cco_score != null && item.cco_score > 0
  const confidenceScore = displayMedia?.confidence_score ?? null

  // Gate scores written by N8N-A02 into qa_review_queue.flags (real model output;
  // null = that gate did not run / vision failed — shown as '—', never invented).
  // These gates run on the original generation only, not on B03 regenerations, so
  // when a revision is selected they don't apply — show '—' rather than the
  // original's scores.
  const flagNum = (k: string): number | null => {
    if (selectedDraft) return null
    const v = (item.flags as Record<string, unknown> | null)?.[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  const brandRelevance   = flagNum('brand_relevance')
  const promptAdherence  = flagNum('prompt_adherence')
  const brandConsistency = flagNum('brand_consistency')

  // Prompts & generation data — revision-aware so a selected regeneration shows
  // the prompts that produced *it*, mirroring the original's detail layout.
  const visualPrompt    = displayMedia?.image_prompt_en ?? item.media?.image_prompt_en ?? null
  const userPrompt      = selectedDraft
    ? (draftOverride?.hero_concept ?? draftOverride?.style_descriptor ?? item.request?.hero_concept ?? item.request?.style_descriptor ?? null)
    : (item.request?.hero_concept ?? item.request?.style_descriptor ?? null)
  const negativePrompt  = selectedDraft
    ? (draftOverride?.negative_prompt ?? item.request?.negative_prompt ?? item.chain?.negative_prompt ?? null)
    : (item.request?.negative_prompt ?? item.chain?.negative_prompt ?? null)
  const negativeSource  = selectedDraft
    ? (draftOverride?.negative_prompt ? 'revision' : item.request?.negative_prompt ? 'brief' : item.chain?.negative_prompt ? 'chain' : null)
    : (item.request?.negative_prompt ? 'brief' : (item.chain?.negative_prompt ? 'chain' : null))
  const chainTemplate   = item.chain?.prompt_template ?? null
  const culturalGuidance = selectedDraft
    ? (draftOverride?.cultural_guidance ?? item.request?.cultural_guidance ?? null)
    : (item.request?.cultural_guidance ?? null)

  // Quick-meta values
  const routeDecision    = displayMedia?.route_decision ?? null
  const chainId          = item.media?.chain_id ?? item.chain?.chain_id ?? null
  const mediaFormat      = displayMedia?.media_type ?? item.request?.media_type ?? null
  const platform         = item.request?.platform ?? item.brand?.primary_channel ?? null
  const watermark        = displayMedia?.watermark ?? null
  const generationModel  = selectedDraft
    ? (selectedDraft.image_model ?? null)
    : (item.media?.generation_model ?? item.chain?.fal_model_primary ?? item.request?.image_model_pref ?? null)

  const caption   = selectedDraft ? (selectedDraft.caption_ar ?? null) : (item.caption_ar ?? item.media?.caption_ar ?? null)
  const hashtags  = selectedDraft ? (selectedDraft.hashtags ?? []) : (item.media?.hashtags ?? [])

  const brandDisplayName = item.brand?.brand_name_en ?? item.brand?.brand_name_ar ?? item.brand_id
  const shortId          = item.queue_id.slice(0, 8)
  const fullRequestId    = item.request?.request_id ?? null

  const flagEntries = Object.entries(item.flags ?? {}).filter(([, v]) => v && v !== 'NONE')

  // Open a revision's full detail: select it (so every panel reflects that
  // version) and switch to the Preview tab, where the media + caption + prompts
  // + scores all render exactly as they do for the original.
  function openRevision(regenId: string) {
    setSelectedDraftId(regenId)
    setActiveTab('preview')
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function doApprove() {
    setPhase('submitting')
    startTransition(async () => {
      const res = await approveQaItem(item.queue_id)
      if (res.ok) {
        setResult({ ok: true, msg: 'Post approved successfully.' })
        setTimeout(() => router.push(backHref), 1400)
      } else {
        setResult({ ok: false, msg: res.error ?? 'Approve failed.' })
        setPhase('idle')
      }
    })
  }

  function doReject() {
    setPhase('submitting')
    startTransition(async () => {
      const res = await rejectQaItem(item.queue_id)
      if (res.ok) {
        setResult({ ok: true, msg: 'Post rejected.' })
        setTimeout(() => router.push(backHref), 1400)
      } else {
        setResult({ ok: false, msg: res.error ?? 'Reject failed.' })
        setPhase('idle')
      }
    })
  }

  return (
    <div className="min-h-screen bg-(--surface-1)">

      {/* ── Sticky top nav ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-(--border-subtle) bg-(--surface-1)/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href={backHref}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {brandDisplayName}
          </Link>
          <span className="text-(--fg-faint)">/</span>
          <span className="text-sm font-semibold text-(--fg)">
            #{shortId}
            {item.request?.content_type && (
              <span className="ml-2 font-normal text-(--fg-muted) capitalize">{item.request.content_type}</span>
            )}
          </span>
          {mediaFormat && (
            <span className="hidden rounded bg-(--surface-3) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-(--fg-faint) sm:inline">
              {mediaFormat}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {triggerKeys.length > 0 && (
              <Badge tone={isHardBlock ? 'danger' : 'warning'} size="sm">
                {isHardBlock ? 'Hard Block' : `${triggerKeys.length} hold reason${triggerKeys.length > 1 ? 's' : ''}`}
              </Badge>
            )}
            {item.status === 'pending'  && <Badge tone="warning" dot>Pending review</Badge>}
            {item.status === 'approved' && <Badge tone="success" dot>Approved</Badge>}
            {item.status === 'rejected' && <Badge tone="danger"  dot>Rejected</Badge>}
          </div>
        </div>
      </div>

      {/* ── Result banner ─────────────────────────────────────────── */}
      {result && (
        <div className={`border-b px-6 py-3 text-sm font-medium text-center ${
          result.ok
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300'
        }`}>
          {result.ok ? '✓ ' : '✕ '}{result.msg}
        </div>
      )}

      {/* Hard-block banner */}
      {isHardBlock && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2.5 flex items-center gap-2.5">
          <span className="text-sm font-bold text-red-400">🔴 Hard Block</span>
          <span className="text-xs text-red-300">This post matched a prohibited negative pattern and cannot be approved.</span>
        </div>
      )}

      {/* ── Main content: two-column layout ──────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">

          {/* ── LEFT COL: media + tabbed content ─────────────────── */}
          <div className="lg:col-span-3 space-y-0 rounded-2xl border border-(--border-subtle) bg-(--surface-1) overflow-hidden">

            {/* Tab nav */}
            <div className="flex border-b border-(--border-subtle) bg-(--surface-2) px-1 pt-1">
              {([
                ['preview',  'Preview'],
                ['deepseek', 'DeepSeek Data'],
                ['cco',      'CCO / Flags'],
                ['history',  'Revision History'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={[
                    'px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
                    activeTab === key
                      ? 'border-(--accent) text-(--accent)'
                      : 'border-transparent text-(--fg-muted) hover:text-(--fg)',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── Tab: Preview ─────────────────────────────────────── */}
            {activeTab === 'preview' && (
              <div className="p-6 space-y-5">
                {/* Generated media */}
                {displayMedia?.storage_url ? (
                  isVideo ? (
                    <video
                      src={displayMedia.storage_url}
                      controls
                      className="w-full rounded-xl bg-black"
                      style={{ maxHeight: 420 }}
                    />
                  ) : (
                    <img
                      src={displayMedia.storage_url}
                      alt="Generated post"
                      className="w-full rounded-xl object-contain bg-(--surface-3)"
                      style={{ maxHeight: 420 }}
                    />
                  )
                ) : (
                  <div className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-(--border-subtle) bg-(--surface-2) text-sm text-(--fg-faint)">
                    <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <path d="M21 15l-5-5L5 21"/>
                    </svg>
                    No image generated yet
                  </div>
                )}

                {/* Clean version (no Arabic overlay) */}
                {displayMedia?.clean_storage_url && displayMedia.clean_storage_url !== displayMedia.storage_url && (
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">Clean version (no Arabic overlay)</p>
                    <img
                      src={displayMedia.clean_storage_url}
                      alt="Clean version"
                      className="w-full rounded-xl object-contain bg-(--surface-3)"
                      style={{ maxHeight: 260 }}
                    />
                  </div>
                )}

                {/* Arabic caption */}
                {caption && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">Arabic Caption</p>
                      <CopyBtn text={caption} />
                    </div>
                    <div className="rounded-xl bg-(--surface-2) border border-(--border-subtle) p-4">
                      <p dir="rtl" className="text-sm leading-relaxed text-(--fg) whitespace-pre-wrap">{caption}</p>
                    </div>
                  </div>
                )}

                {/* Hashtags */}
                {hashtags.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">Hashtags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {hashtags.map((tag) => (
                        <span key={tag} className="rounded-full border border-(--border-subtle) bg-(--surface-2) px-2.5 py-0.5 text-xs text-(--fg-muted)">
                          {tag.startsWith('#') ? tag : `#${tag}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin regen version strip */}
                <AdminRegenHistory
                  original={
                    item.media
                      ? {
                          storage_url:       item.media.storage_url,
                          clean_storage_url: item.media.clean_storage_url,
                          media_type:        item.media.media_type,
                        }
                      : null
                  }
                  regens={item.admin_regenerations}
                  selectedDraftId={selectedDraftId}
                  onSelectDraft={setSelectedDraftId}
                  labels={{
                    title:          'Version History',
                    approveVersion: 'Approve this version',
                    reject:         'Reject',
                  }}
                />
              </div>
            )}

            {/* ── Tab: DeepSeek Data ────────────────────────────────── */}
            {activeTab === 'deepseek' && (
              <div className="divide-y divide-(--border-subtle) p-6">
                <p className="pb-4 text-xs text-(--fg-muted)">All fields produced by the on-demand generation pipeline for this post.</p>

                {/* User prompt (client brief) */}
                {userPrompt && (
                  <div className="py-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-(--fg)">User Prompt</p>
                      <CopyBtn text={userPrompt} />
                    </div>
                    <p className="mb-1 text-[10px] text-(--fg-faint)">The concept / style the client submitted in their brief</p>
                    <div className="rounded-xl border border-(--accent)/30 bg-(--accent)/5 p-4">
                      <p className="text-sm leading-relaxed text-(--fg) whitespace-pre-wrap">{userPrompt}</p>
                    </div>
                  </div>
                )}

                {/* Image prompt (visual_brief / image_prompt_en) */}
                <div className="py-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-(--fg)">Image Prompt</p>
                      {visualPrompt && (
                        ARABIC_RE.test(visualPrompt) ? (
                          <Badge tone="danger" size="sm" title="Rule #3 violation: Arabic must never appear in image prompts">⚠ Arabic in prompt</Badge>
                        ) : (
                          <Badge tone="success" size="sm" title="Rule #3 satisfied: no Arabic in the image prompt (overlay applied after generation)">✓ Arabic-clean</Badge>
                        )
                      )}
                    </div>
                    {visualPrompt && <CopyBtn text={visualPrompt} />}
                  </div>
                  <p className="mb-1 text-[10px] text-(--fg-faint)">image_prompt_en — the positive English prompt sent to the image generation model</p>
                  {visualPrompt ? (
                    <div className="rounded-xl border border-(--border-subtle) bg-(--surface-2) p-4">
                      <p className="font-mono text-xs leading-relaxed text-(--fg) whitespace-pre-wrap break-all">{visualPrompt}</p>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-(--surface-2) border border-(--border-subtle) p-3 text-xs italic text-(--fg-faint)">
                      No image prompt stored for this post.
                    </p>
                  )}
                </div>

                {/* Negative prompt */}
                {negativePrompt && (
                  <div className="py-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-(--fg)">
                        Negative Prompt{negativeSource ? ` · ${negativeSource}` : ''}
                      </p>
                      <CopyBtn text={negativePrompt} />
                    </div>
                    <p className="mb-1 text-[10px] text-(--fg-faint)">What the model was told to avoid</p>
                    <div className="rounded-xl border border-rose-500/15 bg-rose-950/10 p-4">
                      <p className="font-mono text-xs leading-relaxed text-(--fg) whitespace-pre-wrap break-words">{negativePrompt}</p>
                    </div>
                  </div>
                )}

                {/* Chain template */}
                {chainTemplate && (
                  <div className="py-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-(--fg)">
                        Chain Template{item.chain?.chain_id ? ` · ${item.chain.chain_id}` : ''}
                      </p>
                      <CopyBtn text={chainTemplate} />
                    </div>
                    <div className="rounded-xl border border-(--border-subtle) bg-(--surface-2) p-4">
                      <p className="font-mono text-[11px] leading-relaxed text-(--fg) whitespace-pre-wrap break-words">{chainTemplate}</p>
                    </div>
                  </div>
                )}

                {/* Cultural guidance */}
                {culturalGuidance && (
                  <div className="py-5">
                    <p className="mb-2 text-sm font-bold text-(--fg)">Cultural Guidance</p>
                    <div className="rounded-xl border border-(--border-subtle) bg-(--surface-2) p-4">
                      <p className="text-sm leading-relaxed text-(--fg)">{culturalGuidance}</p>
                    </div>
                  </div>
                )}

                {/* Content metadata grid */}
                <div className="py-5 grid grid-cols-2 gap-x-8 gap-y-4">
                  {([
                    ['Content Type',    item.request?.content_type],
                    ['Format',          mediaFormat],
                    ['Platform',        platform],
                    ['Chain ID',        chainId],
                    ['Route Decision',  routeDecision?.toUpperCase()],
                    ['Watermark',       watermark !== null ? (watermark ? 'Yes' : 'No') : null],
                    ['Model',           generationModel],
                    ['Confidence Mode', item.request?.confidence_mode],
                    ['Occasion',        item.request?.occasion_name],
                  ] as [string, string | null | undefined][]).map(([label, value]) => value ? (
                    <div key={label}>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">{label}</p>
                      <p className="mt-0.5 text-xs font-mono text-(--fg)">{String(value)}</p>
                    </div>
                  ) : null)}
                </div>

                {/* Color palette */}
                {item.request?.color_palette && item.request.color_palette.length > 0 && (
                  <div className="py-5">
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">Color Palette</p>
                    <div className="flex flex-wrap gap-2">
                      {item.request.color_palette.map((c) => (
                        <div key={c} className="flex items-center gap-1.5">
                          <span className="h-4 w-4 rounded-sm border border-(--border-subtle)" style={{ backgroundColor: c }} />
                          <span className="font-mono text-xs text-(--fg-muted)">{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Request ID */}
                {fullRequestId && (
                  <div className="py-5">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">Request ID</p>
                    <code className="font-mono text-[11px] text-(--fg-muted) break-all">{fullRequestId}</code>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: CCO / Flags ──────────────────────────────────── */}
            {activeTab === 'cco' && (
              <div className="p-6 space-y-6">
                <ScoreInsightPanel
                  src={{
                    cco_score:         hasCco ? item.cco_score : null,
                    confidence_score:  confidenceScore,
                    route_decision:    routeDecision,
                    flags:             item.flags,
                    trigger_reason:    item.trigger_reason,
                  }}
                />

                {/* Hold reasons detail */}
                {triggerKeys.length > 0 && (
                  <div>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-(--fg-faint)">Hold Reasons</p>
                    <div className={`rounded-xl border p-5 space-y-4 ${isHardBlock ? 'border-red-500/30 bg-red-500/8' : 'border-amber-500/25 bg-amber-500/8'}`}>
                      {triggerKeys.map((k) => (
                        <div key={k} className="flex items-start gap-3">
                          <span className={`mt-0.5 text-sm ${isHardBlock ? 'text-red-400' : 'text-amber-400'}`}>▸</span>
                          <div>
                            <p className="text-sm font-bold text-(--fg)">{TRIGGER_LABELS[k] ?? k}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-(--fg-muted)">{flagDetailByReason[k] || TRIGGER_DETAILS[k] || ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw flag values */}
                {flagEntries.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-wider text-(--fg-faint) hover:text-(--fg-muted)">
                      <span className="inline-block transition-transform group-open:rotate-90">▸</span> Raw flag values ({flagEntries.length})
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface-2) border border-(--border-subtle) p-4">
                      {flagEntries.map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-(--fg-muted)">{k}</span>
                          <span className={`font-mono text-[10px] font-bold ${
                            String(v) === 'HARD_BLOCK'  ? 'text-red-400'    :
                            String(v) === 'STRONG_WARN' ? 'text-orange-400' :
                            String(v) === 'SOFT_WARN'   ? 'text-yellow-400' :
                            v === true ? 'text-amber-400' : 'text-(--fg-faint)'
                          }`}>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* ── Tab: Revision History ─────────────────────────────── */}
            {activeTab === 'history' && (
              <div className="p-6">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">
                  Admin Regenerations ({(item.admin_regenerations ?? []).length} versions)
                </p>
                {(item.admin_regenerations ?? []).length === 0 ? (
                  <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-(--border-subtle) text-sm text-(--fg-faint)">
                    No regenerations yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(item.admin_regenerations ?? []).map((regen) => {
                      const regenIsVideo = regen.media_type === 'video' || /\.mp4(\?|$)/i.test(regen.storage_url ?? '')
                      return (
                        <button
                          key={regen.regen_id}
                          type="button"
                          onClick={() => openRevision(regen.regen_id)}
                          aria-label={`Open revision v${regen.version} detail`}
                          className="block w-full text-left rounded-xl bg-(--surface-2) border border-(--border-subtle) p-4 transition-colors hover:border-(--accent)/50 hover:bg-(--accent)/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)/40"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-(--fg)">Version {regen.version}</span>
                            <span className="text-[10px] text-(--fg-faint)">
                              {new Date(regen.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                            </span>
                          </div>
                          {regen.storage_url && (
                            regenIsVideo ? (
                              <video
                                src={regen.storage_url}
                                className="w-full rounded-lg bg-black mb-2"
                                style={{ maxHeight: 200 }}
                                muted
                                playsInline
                                preload="metadata"
                              />
                            ) : (
                              <img
                                src={regen.storage_url}
                                alt={`Version ${regen.version}`}
                                className="w-full rounded-lg object-contain bg-(--surface-3) mb-2"
                                style={{ maxHeight: 200 }}
                              />
                            )
                          )}
                          {regen.caption_ar && (
                            <p dir="rtl" className="mb-2 line-clamp-2 text-xs leading-relaxed text-(--fg-muted)">{regen.caption_ar}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {regen.image_model && (
                              <span className="font-mono text-[10px] text-(--fg-faint)">Model: {regen.image_model}</span>
                            )}
                            {regen.confidence_score !== null && (
                              <span className="font-mono text-[10px] text-(--fg-faint)">Confidence: {regen.confidence_score?.toFixed(0)}</span>
                            )}
                            <Badge tone={
                              regen.status === 'approved'   ? 'success' :
                              regen.status === 'rejected'   ? 'danger'  :
                              regen.status === 'superseded' ? 'neutral' : 'info'
                            } size="sm">{regen.status}</Badge>
                            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-(--accent)">
                              View detail
                              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT COL: metadata + actions ────────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* IDs card */}
            <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) p-5 space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-(--fg-faint)">Post ID</p>
                <code className="mt-0.5 block font-mono text-[10px] text-(--fg-muted) break-all">{item.post_id || '—'}</code>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-(--fg-faint)">Queue ID</p>
                <code className="mt-0.5 block font-mono text-[10px] text-(--fg-muted) break-all">{item.queue_id}</code>
              </div>
              {fullRequestId && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-(--fg-faint)">Request ID</p>
                  <code className="mt-0.5 block font-mono text-[10px] text-(--fg-muted) break-all">{fullRequestId}</code>
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-(--fg-faint)">Created</p>
                <p className="mt-0.5 text-xs text-(--fg-muted)">
                  {new Date(item.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
            </div>

            {/* Score cards — '—' means that gate did not run; numbers are real model output */}
            <div className="grid grid-cols-2 gap-3">
              {([
                ['CCO Score',         hasCco ? item.cco_score : null],
                ['Visual QC',         confidenceScore],
                ['Brand Relevance',   brandRelevance],
                ['Prompt Match',      promptAdherence],
                ['Brand Consistency', brandConsistency],
              ] as [string, number | null][]).map(([label, score]) => (
                <div key={label} className="flex flex-col items-center rounded-2xl bg-(--surface-2) border border-(--border-subtle) py-4">
                  <p className={`text-2xl font-bold ${scoreTextColor(score)}`}>
                    {score != null ? score.toFixed(0) : '—'}
                  </p>
                  <p className="text-[10px] text-(--fg-faint) mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Quick meta */}
            <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) overflow-hidden divide-y divide-(--border-subtle)">
              {([
                ['Route',     routeDecision?.toUpperCase()],
                ['Chain',     chainId],
                ['Format',    mediaFormat],
                ['Platform',  platform],
                ['Watermark', watermark !== null ? (watermark ? 'Yes ⚠' : 'No') : null],
                ['Model',     generationModel],
              ] as [string, string | null | undefined][]).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span className="text-(--fg-muted)">{label}</span>
                  <span className={`font-medium ${
                    value === 'HOLD'      ? 'text-red-400'     :
                    value === 'WATERMARK' ? 'text-amber-400'   :
                    value === 'CLEAN'     ? 'text-emerald-400' : 'text-(--fg)'
                  }`}>
                    {value ?? '—'}
                  </span>
                </div>
              ))}
            </div>

            {/* Hold reasons summary */}
            {triggerKeys.length > 0 && (
              <div className={`rounded-2xl border p-4 ${isHardBlock ? 'border-red-500/30 bg-red-500/8' : 'border-amber-500/20 bg-amber-500/8'}`}>
                <p className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isHardBlock ? 'text-red-400' : 'text-amber-400'}`}>
                  Hold Reasons
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {triggerKeys.map((k) => (
                    <Badge key={k} tone={k === 'hard_block_negative_pattern' ? 'danger' : 'warning'} size="sm">
                      {TRIGGER_LABELS[k] ?? k}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* ── Action suite ─────────────────────────────────────── */}
            <div className="mt-auto rounded-2xl border border-(--border-subtle) bg-(--surface-2) overflow-hidden">

              {/* Regenerate button — pending + has a post to regenerate */}
              {item.status === 'pending' && item.media?.post_id && (
                <div className="border-b border-(--border-subtle) p-4">
                  <AdminRegenerateButton
                    postId={item.media.post_id}
                    requestId={fullRequestId}
                    brandId={item.brand_id}
                    mediaType={item.media?.media_type ?? item.request?.media_type ?? 'image'}
                    previousPrompt={item.request?.style_descriptor ?? item.request?.hero_concept ?? null}
                    currentImageUrl={item.media?.storage_url ?? null}
                    label="Regenerate"
                  />
                </div>
              )}

              {/* Confirm approve */}
              {phase === 'confirm_approve' && (
                <div className="border-b border-emerald-500/25 bg-emerald-500/8 p-4">
                  <p className="text-sm font-medium text-emerald-300 mb-2">Approve this post?</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPhase('idle')} className="rounded-lg px-3 py-1.5 text-xs text-(--fg-muted) hover:bg-(--surface-3) transition-colors">Cancel</button>
                    <button type="button" disabled={isPending} onClick={doApprove} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors">
                      {isPending ? <Spinner size={11} className="text-white" /> : null}
                      Confirm Approve
                    </button>
                  </div>
                </div>
              )}

              {/* Confirm reject */}
              {phase === 'confirm_reject' && (
                <div className="border-b border-red-500/25 bg-red-500/8 p-4">
                  <p className="text-sm font-medium text-red-300 mb-2">Reject this post?</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPhase('idle')} className="rounded-lg px-3 py-1.5 text-xs text-(--fg-muted) hover:bg-(--surface-3) transition-colors">Cancel</button>
                    <button type="button" disabled={isPending} onClick={doReject} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40 transition-colors">
                      {isPending ? <Spinner size={11} className="text-white" /> : null}
                      Confirm Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Submitting spinner */}
              {phase === 'submitting' && (
                <div className="flex items-center justify-center gap-2 p-4">
                  <Spinner size={16} className="text-(--accent)" />
                  <span className="text-sm text-(--fg-muted)">Processing…</span>
                </div>
              )}

              {/* Already-decided — show decision + optional change action */}
              {phase === 'idle' && isDecided && (
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-2 text-sm">
                    {item.status === 'approved' ? (
                      <>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                        </span>
                        <span className="font-semibold text-emerald-400">Approved</span>
                      </>
                    ) : (
                      <>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white">
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </span>
                        <span className="font-semibold text-red-400">Rejected</span>
                      </>
                    )}
                  </div>
                  {item.status === 'rejected' && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setPhase('confirm_approve')}
                      className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
                    >
                      Change to Approved
                    </button>
                  )}
                </div>
              )}

              {/* Main 2-button bar — pending, not yet decided */}
              {phase === 'idle' && !isDecided && (
                <div className="flex items-center gap-2 p-4">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setPhase('confirm_reject')}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/8 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/15 disabled:opacity-40 transition-colors"
                  >
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={isHardBlock || isPending}
                    onClick={() => setPhase('confirm_approve')}
                    title={isHardBlock ? 'Hard block — cannot approve' : 'Approve this post'}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors shadow-sm shadow-emerald-600/20"
                  >
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                    Approve
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
