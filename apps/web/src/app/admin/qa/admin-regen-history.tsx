'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import type { AdminRegenerationSummary, AdminRegenStatus } from '@repo/db'
import { approveAdminRegeneration, rejectAdminRegeneration } from '@/app/actions/admin-regenerate'
import { ImagePreviewToggle } from './image-preview-toggle'

export interface AdminHistoryOriginal {
  storage_url?: string | null
  clean_storage_url?: string | null
  media_type?: string | null
}

const STATUS_TONE: Record<AdminRegenStatus, 'info' | 'success' | 'danger' | 'neutral'> = {
  draft:      'info',
  approved:   'success',
  rejected:   'danger',
  superseded: 'neutral',
}

const STATUS_LABEL: Record<AdminRegenStatus, string> = {
  draft:      'Draft',
  approved:   'Approved (live)',
  rejected:   'Rejected',
  superseded: 'Superseded',
}

function playableVideoUrl(url: string | null): string | null {
  if (!url) return null
  return /\.mp4([?#]|$)/i.test(url) || /\/video\//.test(url) ? url : null
}

function DraftCard({
  draft,
  labels,
}: {
  draft: AdminRegenerationSummary
  labels: { approveVersion: string; reject: string }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isVideo = draft.media_type === 'video'
  const videoSrc = isVideo ? playableVideoUrl(draft.storage_url) : null

  function run(kind: 'approve' | 'reject') {
    const fn = kind === 'approve' ? approveAdminRegeneration : rejectAdminRegeneration
    startTransition(async () => {
      const res = await fn(draft.regen_id)
      setConfirm(null)
      if (res.ok) {
        router.refresh()
      } else {
        setError(res.error ?? res.message ?? 'Action failed.')
      }
    })
  }

  if (draft.status !== 'draft') return null

  return (
    <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-(--r-md) border border-(--border-subtle) bg-(--surface-1)">
      {/* Preview */}
      <div className="bg-[#0a0a0a]">
        {videoSrc ? (
          <video src={videoSrc} controls preload="metadata" className="block w-full" />
        ) : (draft.storage_url || draft.clean_storage_url) ? (
          <ImagePreviewToggle finalSrc={draft.storage_url} cleanSrc={draft.clean_storage_url} />
        ) : (
          <div className="flex items-center justify-center p-8 text-[10px] text-white/30">No preview</div>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-(--fg)">v{draft.version}</span>
          <Badge tone={STATUS_TONE[draft.status]} size="sm">{STATUS_LABEL[draft.status]}</Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          {draft.image_model && <Badge tone="outline" size="sm">{draft.image_model}</Badge>}
          {draft.confidence_score !== null && (
            <Badge tone="neutral" size="sm">{draft.confidence_score.toFixed(0)}%</Badge>
          )}
        </div>
        {draft.created_by && (
          <p className="truncate text-[10px] text-(--fg-faint)" title={draft.created_by}>{draft.created_by}</p>
        )}

        {error && <p className="text-[10px] text-red-400">{error}</p>}

        {draft.status === 'draft' && (
          confirm ? (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant={confirm === 'reject' ? 'danger' : 'primary'} disabled={pending} onClick={() => run(confirm)}>
                {pending ? '…' : 'Confirm'}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirm('reject')}>{labels.reject}</Button>
              <Button size="sm" disabled={pending} onClick={() => setConfirm('approve')}>{labels.approveVersion}</Button>
            </div>
          )
        )}
      </div>
    </div>
  )
}

function DraftActions({
  draft,
  labels,
}: {
  draft: AdminRegenerationSummary
  labels: { approveVersion: string; reject: string }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run(kind: 'approve' | 'reject') {
    const fn = kind === 'approve' ? approveAdminRegeneration : rejectAdminRegeneration
    startTransition(async () => {
      const res = await fn(draft.regen_id)
      setConfirm(null)
      if (res.ok) router.refresh()
      else setError(res.error ?? res.message ?? 'Action failed.')
    })
  }

  if (draft.status !== 'draft') return null

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {confirm ? (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={confirm === 'reject' ? 'danger' : 'primary'} disabled={pending} onClick={() => run(confirm)}>
            {pending ? '…' : 'Confirm'}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirm('reject')}>{labels.reject}</Button>
          <Button size="sm" disabled={pending} onClick={() => setConfirm('approve')}>{labels.approveVersion}</Button>
        </div>
      )}
    </div>
  )
}

/**
 * Admin-only draft regeneration strip. Renders below the QA card. These drafts
 * live in admin_regenerations (service-role only) and never reach the client.
 * Approving a draft promotes it into the live calendar_posts row.
 */
export function AdminRegenHistory({
  original = null,
  regens,
  labels,
  selectedDraftId = null,
  onSelectDraft,
}: {
  original?: AdminHistoryOriginal | null
  regens: AdminRegenerationSummary[] | null | undefined
  labels: { title: string; approveVersion: string; reject: string }
  /** regen_id of the selected draft, or null when the original is selected. */
  selectedDraftId?: string | null
  onSelectDraft?: (regenId: string | null) => void
}) {
  if (!regens || regens.length === 0) return null

  // Oldest → newest, matching the user-side viewer ordering.
  const drafts = [...regens].sort((a, b) => a.version - b.version)
  const selectedDraft = selectedDraftId
    ? drafts.find((d) => d.regen_id === selectedDraftId) ?? null
    : null

  const totalVersions = drafts.length + (original ? 1 : 0)
  const selectedLabel = selectedDraft ? `v${selectedDraft.version}` : 'Original'

  return (
    <div className="border-t border-(--border-subtle) px-5 py-4">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">
        {labels.title} ({regens.length})
      </p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {regens.map((d) => (
          <DraftCard key={d.regen_id} draft={d} labels={labels} />
        ))}
      </div>

      {/* Metadata + actions for the selected draft. */}
      {selectedDraft && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-1) px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-(--fg)">v{selectedDraft.version}</span>
            <Badge tone={STATUS_TONE[selectedDraft.status]} size="sm">{STATUS_LABEL[selectedDraft.status]}</Badge>
            {selectedDraft.image_model && <Badge tone="outline" size="sm">{selectedDraft.image_model}</Badge>}
            {selectedDraft.confidence_score !== null && (
              <Badge tone="neutral" size="sm">{selectedDraft.confidence_score.toFixed(0)}%</Badge>
            )}
            {selectedDraft.created_by && (
              <span className="truncate text-[10px] text-(--fg-faint)" title={selectedDraft.created_by}>
                {selectedDraft.created_by}
              </span>
            )}
          </div>
          <DraftActions key={selectedDraft.regen_id} draft={selectedDraft} labels={labels} />
        </div>
      )}
    </div>
  )
}
