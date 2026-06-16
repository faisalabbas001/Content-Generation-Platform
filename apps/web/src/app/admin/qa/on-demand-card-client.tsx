'use client'

import { useState } from 'react'
import { Badge } from '@repo/ui/badge'
import type { QaQueueItem, QaQueueChain } from '@repo/db'
import { scoreBand } from '@repo/core'
import { formatDate, qaStatusTone } from '@/lib/format'
import { QaActionButtons } from './qa-actions'
import { CopyChip } from './copy-chip'
import { ImagePreviewToggle } from './image-preview-toggle'
import { AdminRegenerateButton } from './admin-regenerate-button'
import { AdminRegenHistory } from './admin-regen-history'

// Helpers (from original on-demand-queue-cards.tsx)
function useCopy(text: string | null) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!text) return
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return { copy, copied }
}

function PromptCopyButton({ text }: { text: string }) {
  const { copy, copied } = useCopy(text)
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest transition text-(--fg-faint) hover:bg-(--surface-4) hover:text-(--fg-subtle)"
      title={copied ? 'Copied!' : 'Copy prompt'}
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function playableVideoUrl(url: string | null): string | null {
  if (!url) return null
  return /\.mp4([?#]|$)/i.test(url) || /\/video\//.test(url) ? url : null
}

function statusAccentClass(status: string): string {
  if (status === 'pending')  return 'bg-amber-500'
  if (status === 'approved') return 'bg-emerald-500'
  if (status === 'rejected') return 'bg-rose-500'
  return 'bg-sky-500'
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d ago`
  return ''
}

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.min(Math.max(score, 0), 100)
  const r = 16
  const circ = 2 * Math.PI * r
  const dash = clamped > 0 ? (clamped / 100) * circ : 0
  const band = scoreBand(clamped)
  const color = band === 'clean' ? '#22c55e' : band === 'mark' ? '#f59e0b' : '#f43f5e'
  const tone: 'success' | 'warning' | 'danger' =
    band === 'clean' ? 'success' : band === 'mark' ? 'warning' : 'danger'

  return (
    <div className="flex flex-col items-center gap-1.5" aria-label={`CCO score ${clamped}`}>
      <div className="relative flex h-11 w-11 items-center justify-center">
        <svg
          viewBox="0 0 40 40"
          className="absolute inset-0 h-full w-full -rotate-90"
          aria-hidden
        >
          <circle
            cx="20" cy="20" r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-(--surface-4)"
          />
          <circle
            cx="20" cy="20" r={r}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <span
          className="relative z-10 text-[11px] font-bold tabular-nums leading-none"
          style={{ color }}
        >
          {clamped.toFixed(0)}
        </span>
      </div>
      <Badge tone={tone} size="sm">{band}</Badge>
    </div>
  )
}

function MediaPanel({ media }: { media: NonNullable<QaQueueItem['media']> }) {
  const isVideo = media.media_type === 'video'
  const videoSrc   = isVideo  ? playableVideoUrl(media.storage_url) : null
  const finalSrc   = !isVideo ? media.storage_url                   : null
  const cleanSrc   = !isVideo ? media.clean_storage_url             : null

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2">
        <div className="flex items-center gap-1.5">
          {isVideo ? (
            <svg className="h-3.5 w-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          )}
          <span className="text-[9px] font-semibold uppercase tracking-widest text-white/40">
            Generated {isVideo ? 'Video' : 'Image'}
          </span>
        </div>
        {media.watermark && (
          <span className="rounded-sm bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
            Watermark
          </span>
        )}
      </div>

      {/* Fills all remaining height — object-cover, no dead space. */}
      <div className="relative flex-1 overflow-hidden bg-[#0a0a0a]">
        {videoSrc ? (
          <video
            src={videoSrc}
            controls
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (finalSrc || cleanSrc) ? (
          <ImagePreviewToggle finalSrc={finalSrc} cleanSrc={cleanSrc} fill />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]">
              {isVideo ? (
                <svg className="h-7 w-7 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
              ) : (
                <svg className="h-7 w-7 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-white/25">
                {isVideo ? 'Video still processing' : 'No preview available'}
              </p>
              <p className="mt-0.5 text-[10px] text-white/15">Media not ready for review</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">
      {children}
    </p>
  )
}

function ChannelBadge({ channel }: { channel: string }) {
  const cls: Record<string, string> = {
    Instagram: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    TikTok:    'bg-white/5 text-(--fg-subtle) border-(--border-default)',
    Snapchat:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    Twitter:   'bg-sky-500/10 text-sky-400 border-sky-500/20',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide ${cls[channel] ?? 'bg-(--surface-4) text-(--fg-muted) border-(--border-default)'}`}
    >
      {channel}
    </span>
  )
}

function StepBadge({ step }: { step: string }) {
  const label = step.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const isFailed  = /fail|error/i.test(step)
  const isActive  = /generat|process|encod/i.test(step)
  const tone: 'danger' | 'info' | 'neutral' = isFailed ? 'danger' : isActive ? 'info' : 'neutral'

  return (
    <span className="inline-flex items-center gap-1">
      <svg className="h-3 w-3 text-(--fg-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
      <Badge tone={tone} size="sm">{label}</Badge>
    </span>
  )
}

/**
 * Generation provenance for the displayed version: which chain (if any) was
 * selected, the path taken, and the model. On-demand posts almost always use
 * standard model routing (no chain) — this surfaces that honestly rather than
 * implying a chain was picked when chain_id is null.
 */
function GenInfoRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-(--fg-faint)">{k}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-(--fg-subtle)">{children}</dd>
    </div>
  )
}

function GenerationInfo({
  chain,
  model,
  modelNote,
}: {
  chain: QaQueueChain | null
  model: string | null
  modelNote: string
}) {
  return (
    <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
      <dl className="space-y-1.5 text-xs">
        <GenInfoRow k="Selected chain">
          {chain ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden />
              {chain.name_en ?? chain.chain_id}
            </span>
          ) : (
            <span className="text-(--fg-muted)">None — standard routing</span>
          )}
        </GenInfoRow>
        {chain && (
          <GenInfoRow k="Chain ID">
            <span className="font-mono text-[11px]">{chain.chain_id}</span>
          </GenInfoRow>
        )}
        <GenInfoRow k="Generation path">
          {chain ? `Chain pipeline${chain.family ? ` · ${chain.family}` : ''}` : 'Standard model routing'}
        </GenInfoRow>
        <GenInfoRow k="Model">
          {model ? (
            <span className="font-mono text-[11px]">
              {model}
              {modelNote && <span className="ml-1 font-sans text-(--fg-faint)">({modelNote})</span>}
            </span>
          ) : (
            <span className="text-(--fg-muted)">—</span>
          )}
        </GenInfoRow>
      </dl>
    </div>
  )
}

const TRIGGER_LABELS: Record<string, string> = {
  first_ever_client_output:             '#1 First output',
  brave_route_flagged:                  '#2 Brave route',
  healthcare_health_claim:              '#3 Health claim',
  finance_investment_claim:             '#4 Finance claim',
  government_sector:                    '#5 Government',
  religious_reference_high_sensitivity: '#6 Religious ref',
  dialect_unconfirmed_hero:             '#7 Dialect gap',
  unresolved_conflict_record:           '#8 Conflict record',
  revision_cycle_exceeded:              '#9 Revision limit',
  cco_low_confidence:                   '#10 Low CCO score',
  hard_block_negative_pattern:          '#11 Hard block',
  method_violation:                     '#12 Method drift',
  ceo_hold:                             'CEO hold',
}

function parseTriggers(reason: string | null | undefined): string[] {
  if (!reason) return []
  return reason.split(/[|,]/).map((s) => s.trim()).filter(Boolean)
}

function parseFlags(raw: Record<string, unknown> | null | undefined): {
  negpat: string | null
  requestId: string | null
  others: Array<{ key: string; label: string; value: string }>
} {
  let f: Record<string, unknown> = {}
  if (typeof raw === 'string') {
    try { f = JSON.parse(raw) } catch { /* noop */ }
  } else if (raw && typeof raw === 'object') {
    f = raw
  }

  const negpat =
    typeof f.negpat_flag === 'string' && f.negpat_flag !== 'NONE' ? f.negpat_flag : null
  const requestId =
    typeof f.request_id === 'string' && f.request_id ? f.request_id : null

  const others = Object.entries(f)
    .filter(([k, v]) => k !== 'negpat_flag' && k !== 'request_id' && v && v !== 'NONE')
    .map(([k, v]) => {
      const bare = k.replace('_flag', '')
      return { key: bare, label: bare, value: String(v) }
    })

  return { negpat, requestId, others }
}

export function OnDemandCardClient({
  row,
  locale,
  statusLabel,
  labels,
}: {
  row: QaQueueItem
  locale: 'ar' | 'en'
  statusLabel: string
  labels: {
    approveLabel: string
    rejectLabel: string
    regenerateLabel: string
    regenHistoryTitle: string
    regenApproveVersion: string
    regenReject: string
    confirmApprove: { title: string; body: string; confirm: string; cancel: string }
    confirmReject: { title: string; body: string; confirm: string; cancel: string }
  }
}) {
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)

  const { negpat, requestId, others } = parseFlags(row.flags)
  const triggers = parseTriggers(row.trigger_reason)
  const isHardBlock = negpat === 'HARD_BLOCK'
  const shortId = row.queue_id.slice(0, 8)

  const currentStep     = row.request?.current_step   ?? null
  const fullRequestId   = row.request?.request_id     ?? requestId
  const relTime         = relativeTime(row.created_at)

  const brand        = row.brand ?? null
  const brandName    = brand?.brand_name_ar    ?? null
  const brandNameEn  = brand?.brand_name_en    ?? null
  const sector       = brand?.sector           ?? null
  const pipelineTier = brand?.pipeline_tier    ?? null
  const channel      = brand?.primary_channel  ?? null
  const dialect      = brand?.arabic_dialect   ?? null
  const clientSlug   = brand?.client_slug      ?? null

  const hasFlags = (negpat && !isHardBlock) || others.length > 0
  const hasTriggers = triggers.length > 0

  const promptText = row.request?.hero_concept || row.request?.style_descriptor || null
  const caption = row.media?.caption_ar ?? row.caption_ar
  const hashtags = row.media?.hashtags ?? []
  const metaChips = [
    row.request?.content_type ?? null,
    row.request?.platform ?? null,
    (row.media?.media_type ?? row.request?.media_type) ?? null,
  ].filter((v): v is string => !!v)

  const hasMedia = !!row.media

  const selectedDraft = selectedDraftId
    ? (row.admin_regenerations ?? []).find((d) => d.regen_id === selectedDraftId)
    : null

  // The media shown in the main panel — the selected draft's asset when a version
  // is picked, otherwise the original held image. Carries the version's own
  // confidence/watermark so the scores below track what's actually on screen.
  const displayMedia = selectedDraft && row.media
    ? ({
        ...row.media,
        storage_url:       selectedDraft.storage_url,
        clean_storage_url: selectedDraft.clean_storage_url,
        confidence_score:  selectedDraft.confidence_score,
        watermark:         selectedDraft.watermark,
        media_type:        selectedDraft.media_type,
      })
    : row.media

  // Score rendering. On-demand human-gate holds never run CCO scoring, so
  // qa_review_queue.cco_score is a literal 0 — meaningless here. Treat 0/absent
  // (and any selected draft, whose score is the visual confidence) as "no CCO":
  // fall back to the displayed version's visual confidence_score instead.
  const hasCco = !selectedDraft && row.cco_score != null && row.cco_score > 0
  const displayConfidence = displayMedia?.confidence_score ?? null
  const score = hasCco ? row.cco_score! : (displayConfidence ?? 0)
  const scoreLabel = hasCco ? 'CCO Score' : 'Visual Score'
  // Only show the secondary "Visual QC" tile when the ring is showing the CCO
  // score (otherwise the ring already shows the visual score — no duplicate).
  const showVisualQc = hasCco && displayConfidence !== null

  // Generation provenance for the displayed version. `generationModel` prefers
  // the model actually recorded for the asset, then the chain's default, then the
  // brief's requested preference — `modelNote` tells the admin which it is.
  const chain = row.chain ?? null
  const generationModel = selectedDraft
    ? (selectedDraft.image_model ?? null)
    : (row.media?.generation_model ?? chain?.fal_model_primary ?? row.request?.image_model_pref ?? null)
  const modelNote = selectedDraft
    ? 'requested'
    : row.media?.generation_model ? 'used'
    : chain?.fal_model_primary ? 'chain default'
    : row.request?.image_model_pref ? 'preference'
    : ''

  // Generation detail surfaced for admin clarity — all real, persisted data.
  // Visual prompt = the final English prompt sent to fal.ai (calendar_posts.image_prompt_en).
  // Negative prompt prefers the brief's, falling back to the selected chain's.
  const visualPrompt    = displayMedia?.image_prompt_en ?? row.media?.image_prompt_en ?? null
  const negativePrompt  = row.request?.negative_prompt ?? chain?.negative_prompt ?? null
  const negativeSource  = row.request?.negative_prompt ? 'brief' : (chain?.negative_prompt ? 'chain' : null)
  const chainTemplate   = chain?.prompt_template ?? null
  const confidenceMode  = row.request?.confidence_mode ?? null
  const culturalGuidance = row.request?.cultural_guidance ?? null
  const routeDecision   = displayMedia?.route_decision ?? row.media?.route_decision ?? null

  return (
    <article
      className={[
        'relative overflow-hidden rounded-(--r-xl) border bg-(--surface-2) shadow-(--shadow-1) transition-shadow hover:shadow-lg',
        isHardBlock
          ? 'border-rose-500/40 ring-1 ring-rose-500/20'
          : 'border-(--border-subtle)',
      ].join(' ')}
    >
      <div
        className={`absolute inset-y-0 left-0 z-10 w-1 ${statusAccentClass(row.status)}`}
        aria-hidden
      />

      {isHardBlock && (
        <div className="ml-1 flex items-center gap-2.5 border-b border-rose-500/20 bg-rose-950/50 px-5 py-2.5">
          <svg className="h-4 w-4 shrink-0 text-rose-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path fillRule="evenodd" clipRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" />
          </svg>
          <span className="flex-1 text-xs font-bold uppercase tracking-wider text-rose-300">
            Hard Block — Requires Immediate QA Review
          </span>
          <Badge tone="danger" size="sm">NEGPAT: HARD_BLOCK</Badge>
        </div>
      )}

      <div className={`ml-1 ${hasMedia ? 'flex flex-col md:flex-row' : ''}`}>
        {hasMedia && displayMedia && (
          <div className="shrink-0 border-b border-(--border-subtle) md:w-[42%] md:border-b-0 md:border-r">
            <MediaPanel media={displayMedia} />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-(--border-subtle) px-5 py-4">
            <div className="min-w-0 space-y-2.5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {brandName ? (
                    <span className="text-base font-bold leading-tight text-(--fg)" dir="rtl" lang="ar">
                      {brandName}
                    </span>
                  ) : (
                    <span
                      className="max-w-[240px] truncate font-mono text-[11px] text-(--fg-faint)"
                      title={row.brand_id}
                    >
                      {row.brand_id}
                    </span>
                  )}
                  {brandNameEn && (
                    <span className="text-sm text-(--fg-muted)">({brandNameEn})</span>
                  )}
                  {clientSlug && (
                    <CopyChip
                      value={clientSlug}
                      display={`/${clientSlug}`}
                      title={`Copy slug: ${clientSlug}`}
                    />
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {sector && (
                    <Badge tone="neutral" size="sm">
                      {sector.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {pipelineTier && (
                    <Badge tone={pipelineTier === 'Pro' ? 'accent' : 'info'} size="sm">
                      {pipelineTier} Pipeline
                    </Badge>
                  )}
                  {channel && <ChannelBadge channel={channel} />}
                  {dialect && (
                    <Badge tone="neutral" size="sm">
                      {dialect.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">
                  On-Demand
                </span>
                <span className="select-none text-(--border-default)">·</span>
                <CopyChip
                  value={row.queue_id}
                  display={`#${shortId}`}
                  title={`Copy queue ID: ${row.queue_id}`}
                />
                {fullRequestId && (
                  <CopyChip
                    value={fullRequestId}
                    display={`Req #${fullRequestId.slice(0, 8)}`}
                    title={`Copy request ID: ${fullRequestId}`}
                  />
                )}
                {currentStep && <StepBadge step={currentStep} />}
                {confidenceMode && (
                  <Badge tone="info" size="sm" title="CEO confidence mode at routing">
                    CEO: {confidenceMode}
                  </Badge>
                )}
                {routeDecision && (
                  <Badge tone="outline" size="sm" title="Route decided by the confidence gate">
                    Route: {routeDecision}
                  </Badge>
                )}
                {metaChips.map((c) => (
                  <Badge key={c} tone="outline" size="sm">{c}</Badge>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <Badge tone={qaStatusTone(row.status)} dot>{statusLabel}</Badge>
              <div className="w-24 rounded-(--r-md) bg-(--surface-3) p-2.5 flex flex-col items-center gap-1">
                <span className="text-[8px] uppercase tracking-widest font-semibold text-(--fg-faint)">
                  {scoreLabel}
                </span>
                <ScoreRing score={score} />
              </div>
              {showVisualQc && displayConfidence !== null && (
                <div className="w-24 rounded-(--r-md) bg-(--surface-3) p-2 flex flex-col items-center gap-0.5">
                  <span className="text-[8px] uppercase tracking-widest font-semibold text-(--fg-faint)">Visual QC</span>
                  <span
                    className="text-xs font-bold tabular-nums"
                    style={{ color: displayConfidence >= 70 ? '#22c55e' : '#f43f5e' }}
                  >
                    {displayConfidence.toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-4 px-5 py-4">
            {(promptText !== null || metaChips.length > 0) && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <FieldLabel>User Prompt</FieldLabel>
                  {promptText && <PromptCopyButton text={promptText} />}
                </div>
                <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                  {promptText ? (
                    <p className="line-clamp-3 text-sm leading-relaxed text-(--fg-subtle)">
                      {promptText}
                    </p>
                  ) : (
                    <p className="text-xs italic text-(--fg-faint)">No prompt recorded</p>
                  )}
                </div>
              </div>
            )}

            <div>
              <FieldLabel>Generation</FieldLabel>
              <GenerationInfo chain={chain} model={generationModel} modelNote={modelNote} />
            </div>

            {visualPrompt && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <FieldLabel>Visual Prompt (sent to fal.ai)</FieldLabel>
                  <PromptCopyButton text={visualPrompt} />
                </div>
                <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                  <p className="line-clamp-4 text-sm leading-relaxed text-(--fg-subtle)">
                    {visualPrompt}
                  </p>
                </div>
              </div>
            )}

            {negativePrompt && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <FieldLabel>Negative Prompt{negativeSource ? ` · ${negativeSource}` : ''}</FieldLabel>
                  <PromptCopyButton text={negativePrompt} />
                </div>
                <div className="rounded-(--r-md) border border-rose-500/15 bg-rose-950/10 px-3 py-2.5">
                  <p className="line-clamp-3 text-sm leading-relaxed text-(--fg-subtle)">
                    {negativePrompt}
                  </p>
                </div>
              </div>
            )}

            {chainTemplate && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <FieldLabel>Chain Template{chain?.chain_id ? ` · ${chain.chain_id}` : ''}</FieldLabel>
                  <PromptCopyButton text={chainTemplate} />
                </div>
                <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                  <p className="line-clamp-3 font-mono text-[11px] leading-relaxed text-(--fg-muted)">
                    {chainTemplate}
                  </p>
                </div>
              </div>
            )}

            {culturalGuidance && (
              <div>
                <FieldLabel>Cultural Guidance</FieldLabel>
                <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                  <p className="line-clamp-2 text-sm leading-relaxed text-(--fg-subtle)">
                    {culturalGuidance}
                  </p>
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <FieldLabel>Arabic Caption</FieldLabel>
                {caption && <PromptCopyButton text={caption} />}
              </div>
              <div className="min-h-[52px] rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                {caption ? (
                  <p dir="rtl" lang="ar" className="line-clamp-4 text-sm leading-relaxed text-(--fg)">
                    {caption}
                  </p>
                ) : (
                  <p className="text-xs italic text-(--fg-faint)">No caption available</p>
                )}
              </div>
            </div>

            {hashtags.length > 0 && (
              <div>
                <FieldLabel>Hashtags</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {hashtags.map((h) => (
                    <Badge key={h} tone="neutral" size="sm">{h}</Badge>
                  ))}
                </div>
              </div>
            )}

            {(hasTriggers || hasFlags) && (
              <div>
                <FieldLabel>QA Signals</FieldLabel>
                <div className="space-y-2">
                  {hasTriggers && (
                    <div className="flex flex-wrap gap-1.5">
                      {triggers.map((part) => (
                        <Badge
                          key={part}
                          tone={part === 'hard_block_negative_pattern' ? 'danger' : 'neutral'}
                          size="sm"
                        >
                          {TRIGGER_LABELS[part] ?? part}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {hasFlags && (
                    <div className="flex flex-wrap gap-1.5">
                      {negpat && !isHardBlock && (
                        <Badge tone="warning" size="sm">NegPat: {negpat}</Badge>
                      )}
                      {others.map(({ key, label, value }) => (
                        <Badge key={key} tone="neutral" size="sm">
                          {label}: {value}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <AdminRegenHistory
            original={
              row.media
                ? {
                    storage_url: row.media.storage_url,
                    clean_storage_url: row.media.clean_storage_url,
                    media_type: row.media.media_type,
                  }
                : null
            }
            regens={row.admin_regenerations}
            selectedDraftId={selectedDraftId}
            onSelectDraft={setSelectedDraftId}
            labels={{
              title:          labels.regenHistoryTitle,
              approveVersion: labels.regenApproveVersion,
              reject:         labels.regenReject,
            }}
          />

          <div className="border-t border-(--border-subtle) bg-(--surface-3)">
            {row.status === 'pending' && row.media?.post_id && (
              <div className="border-b border-(--border-subtle) px-5 py-3">
                <AdminRegenerateButton
                  postId={row.media.post_id}
                  requestId={fullRequestId}
                  brandId={row.brand_id}
                  mediaType={row.media?.media_type ?? row.request?.media_type ?? 'image'}
                  previousPrompt={row.request?.style_descriptor ?? null}
                  currentImageUrl={row.media?.storage_url ?? null}
                  label={labels.regenerateLabel}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="flex items-center gap-1.5 text-xs text-(--fg-faint)">
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                </svg>
                {formatDate(row.created_at, locale)}
                {relTime && (
                  <span className="text-(--fg-faint) opacity-60">· {relTime}</span>
                )}
              </div>

              {row.status === 'pending' ? (
                <QaActionButtons
                  queueId={row.queue_id}
                  approveLabel={labels.approveLabel}
                  rejectLabel={labels.rejectLabel}
                  confirmApprove={labels.confirmApprove}
                  confirmReject={labels.confirmReject}
                />
              ) : (
                <span className="text-xs text-(--fg-faint)">—</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
