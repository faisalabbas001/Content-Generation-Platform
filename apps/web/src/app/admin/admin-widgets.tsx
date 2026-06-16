'use client'


import { useState, useEffect, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { Input } from '@repo/ui/input'
import { Badge } from '@repo/ui/badge'
import {
  resolveAnomaly,
  bulkResolveAnomalies,
  queueDecision,
  forceMemoryDrain,
  addOverrideRule,
  addNegativePattern,
  deleteNegativePattern,
  deleteOverrideRule,
  relinkSectorBaseline,
  recomputeCompleteness,
  updateVisualStyle,
} from './actions'

function ErrorOrOk({ state }: { state: { ok: boolean; error?: string } | null }) {
  if (!state) return null
  return state.ok ? (
    <span className="text-xs text-(--success-fg) ms-2">✓ saved</span>
  ) : (
    <span className="text-xs text-(--danger-fg) ms-2">✗ {state.error}</span>
  )
}

// ─────────────────────────────────────────────────────────────────
// Shared confirmation modal (module-scope, not exported)
// ─────────────────────────────────────────────────────────────────
function ConfirmModal({
  title,
  body,
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
  pending,
}: {
  title: string
  body: string
  confirmLabel: string
  confirmVariant?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, pending])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onCancel() }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-1) shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-(--border-subtle) px-5 py-4">
          <h3 className="text-sm font-semibold leading-snug text-(--fg)">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label="Close"
            className="mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--fg-faint) transition-colors hover:bg-(--surface-3) hover:text-(--fg) disabled:opacity-40"
          >
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-sm leading-relaxed text-(--fg-muted)">{body}</p>
        </div>
        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-(--border-subtle) bg-(--surface-2)/40 px-5 py-3">
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant={confirmVariant} disabled={pending} onClick={onConfirm}>
            {pending ? '…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 1. Resolve / un-resolve a single anomaly row
// ─────────────────────────────────────────────────────────────────
export function ResolveAnomalyButton({ anomaly_id, currentlyResolved }: { anomaly_id: string; currentlyResolved: boolean }) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  function doResolve() {
    startTransition(async () => {
      const r = await resolveAnomaly({ anomaly_id, resolved: !currentlyResolved })
      setState(r.ok ? { ok: true } : { ok: false, error: r.error })
      setShowConfirm(false)
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant={currentlyResolved ? 'ghost' : 'primary'}
        disabled={pending}
        onClick={() => setShowConfirm(true)}
      >
        {currentlyResolved ? 'Re-open' : 'Resolve'}
      </Button>
      <ErrorOrOk state={state} />
      {showConfirm && (
        <ConfirmModal
          title={currentlyResolved ? 'Re-open this anomaly?' : 'Mark anomaly as resolved?'}
          body={
            currentlyResolved
              ? 'This will flag the anomaly as open again and return it to the active queue. Notifications may be re-triggered if escalation rules apply.'
              : 'This marks the anomaly as resolved and removes it from the open queue. It remains in the log for auditing. You can re-open it at any time.'
          }
          confirmLabel={currentlyResolved ? 'Re-open' : 'Mark Resolved'}
          onConfirm={doResolve}
          onCancel={() => setShowConfirm(false)}
          pending={pending}
        />
      )}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────
// 2. Bulk-resolve all open anomalies (page header)
// ─────────────────────────────────────────────────────────────────
export function BulkResolveAnomaliesButton({ brand_id, anomaly_type }: { brand_id?: string; anomaly_type?: string }) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  function doBulkResolve() {
    startTransition(async () => {
      const r = await bulkResolveAnomalies({ brand_id, anomaly_type })
      setState(r.ok ? { ok: true } : { ok: false, error: r.error })
      setShowConfirm(false)
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => setShowConfirm(true)}
      >
        Resolve all open
      </Button>
      <ErrorOrOk state={state} />
      {showConfirm && (
        <ConfirmModal
          title="Resolve all open anomalies?"
          body="Every open anomaly matching the current filters will be marked as resolved. This affects all pages, not just the current view. You can re-open individual anomalies afterwards, but there is no bulk undo."
          confirmLabel="Resolve All Open"
          confirmVariant="danger"
          onConfirm={doBulkResolve}
          onCancel={() => setShowConfirm(false)}
          pending={pending}
        />
      )}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────
// 3. Memory queue row decision (retry / approve-with-override / reject)
// ─────────────────────────────────────────────────────────────────
export function QueueRowActions({
  nomination_id,
  status,
  brand_id,
  nomination_data,
}: {
  nomination_id: string
  status: string
  brand_id: string
  nomination_data?: Record<string, unknown>
}) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  // null = closed, 'retry' = approve panel, 'reject' = reject panel
  const [panel, setPanel] = useState<'retry' | 'reject' | null>(null)
  const [overrideValue, setOverrideValue] = useState<string>('')
  const [rejectReason, setRejectReason] = useState<string>('')

  const canRetry = status === 'rejected'
  const canReject = status === 'pending'

  if (!canRetry && !canReject) return <span className="text-xs text-(--fg-faint)">—</span>

  // Pre-fill override with current proposed value when panel opens.
  // proposed_value can be a plain scalar OR an object like { value: "budget" } —
  // unwrap one level so the input always gets a plain string.
  function openRetryPanel() {
    const raw = nomination_data?.proposed_value
    let display = ''
    if (raw !== undefined && raw !== null) {
      if (typeof raw === 'object') {
        // Try common wrapper shapes: { value }, { proposed_value }, first string property
        const obj = raw as Record<string, unknown>
        const inner = obj.value ?? obj.proposed_value ?? obj.new_value ?? Object.values(obj).find((v) => typeof v === 'string')
        display = inner !== undefined && inner !== null ? String(inner) : JSON.stringify(raw)
      } else {
        display = String(raw)
      }
    }
    setOverrideValue(display)
    setState(null)
    setPanel('retry')
  }

  function openRejectPanel() {
    setRejectReason('')
    setState(null)
    setPanel('reject')
  }

  if (panel === 'retry') {
    return (
      <div className="flex flex-col gap-2 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-3 min-w-[260px]">
        <div className="text-xs font-medium text-(--fg)">Approve & write to BrandDNA</div>
        <div className="text-xs text-(--fg-muted)">
          Field: <span className="font-mono">{String(nomination_data?.field_path ?? '—')}</span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--fg-muted)">Value to write</span>
          <Input
            value={overrideValue}
            onChange={(e) => setOverrideValue(e.target.value)}
            placeholder="proposed value"
            className="font-mono text-xs"
          />
        </label>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="primary"
            disabled={pending || overrideValue.trim() === ''}
            onClick={() => startTransition(async () => {
              // Always send override_value — the action only patches if it differs from
              // existing proposed_value, and we want the plain string regardless of original shape.
              const r = await queueDecision({
                nomination_id,
                decision: 'approve_retry',
                override_value: overrideValue.trim(),
              })
              if (r.ok) {
                await forceMemoryDrain({ brand_id, batch_size: 10 })
                setState({ ok: true })
                setPanel(null)
              } else {
                setState({ ok: false, error: r.error })
              }
            })}
          >
            {pending ? 'Writing…' : 'Approve & write'}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPanel(null)}>Cancel</Button>
          <ErrorOrOk state={state} />
        </div>
      </div>
    )
  }

  if (panel === 'reject') {
    return (
      <div className="flex flex-col gap-2 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-3 min-w-[260px]">
        <div className="text-xs font-medium text-(--fg)">Reject nomination</div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--fg-muted)">Reason (optional)</span>
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. value conflicts with confirmed brand archetype"
            className="text-xs"
          />
        </label>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => startTransition(async () => {
              const r = await queueDecision({
                nomination_id,
                decision: 'reject',
                reason: rejectReason.trim() || undefined,
              })
              setState(r.ok ? { ok: true } : { ok: false, error: r.error })
              if (r.ok) setPanel(null)
            })}
          >
            {pending ? 'Rejecting…' : 'Confirm reject'}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPanel(null)}>Cancel</Button>
          <ErrorOrOk state={state} />
        </div>
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      {canRetry && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={openRetryPanel}>
          Approve
        </Button>
      )}
      {canReject && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={openRejectPanel}>
          Reject
        </Button>
      )}
      <ErrorOrOk state={state} />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────
// 4a. Refresh button — calls router.refresh() to re-fetch RSC data
// ─────────────────────────────────────────────────────────────────
export function RefreshButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(() => { router.refresh() })}
    >
      {pending ? 'Refreshing…' : '↺ Refresh'}
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────
// 4b. Brand-level toolbox (force drain, recompute, relink baseline)
// ─────────────────────────────────────────────────────────────────
export function BrandToolbox({ brand_id }: { brand_id: string }) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string; tag?: string } | null>(null)

  const fire = (tag: string, fn: () => Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }>) =>
    startTransition(async () => {
      const r = await fn()
      setState({ ...r, tag })
    })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => fire('drain', () => forceMemoryDrain({ brand_id, batch_size: 100 }))}>
        Drain queue
      </Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => fire('recompute', () => recomputeCompleteness({ brand_id }))}>
        Recompute completeness
      </Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => fire('relink', () => relinkSectorBaseline({ brand_id }))}>
        Re-link baseline
      </Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => fire('layer4-backfill', async () => {
          const r = await fetch('/api/admin/maintenance/branddna-backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brand_id }),
          })
          const j = await r.json() as { ok?: boolean; error?: string; updated?: number }
          return { ok: j.ok ?? false, error: j.error }
        })}>
        Backfill Layer 4
      </Button>
      {state && (
        <Badge size="sm" tone={state.ok ? 'success' : 'danger'}>
          {state.ok ? `✓ ${state.tag}` : `✗ ${state.tag}: ${state.error}`}
        </Badge>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// 5. Add negative_pattern (inline form)
// ─────────────────────────────────────────────────────────────────
export function AddNegativePatternForm({ brand_id }: { brand_id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  const [text, setText] = useState('')
  const [severity, setSeverity] = useState<'SOFT_WARN' | 'STRONG_WARN' | 'HARD_BLOCK'>('STRONG_WARN')

  return (
    <form
      className="flex flex-col gap-2 pt-3 border-t border-(--border-subtle) mt-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim().length < 2) return
        startTransition(async () => {
          const r = await addNegativePattern({ brand_id, pattern_text: text, severity })
          setState(r.ok ? { ok: true } : { ok: false, error: r.error })
          if (r.ok) { setText(''); router.refresh() }
        })
      }}
    >
      <Input
        placeholder="Pattern to block (e.g. avoid 'limited time only' urgency)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
      />
      <div className="flex items-center gap-2">
        <select
          className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1 text-xs"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as typeof severity)}
          disabled={pending}
        >
          <option value="SOFT_WARN">SOFT_WARN</option>
          <option value="STRONG_WARN">STRONG_WARN</option>
          <option value="HARD_BLOCK">HARD_BLOCK</option>
        </select>
        <Button type="submit" size="sm" disabled={pending || text.trim().length < 2}>
          {pending ? 'Adding…' : 'Add pattern'}
        </Button>
        <ErrorOrOk state={state} />
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────
// 6. Add override_rule (inline form)
// ─────────────────────────────────────────────────────────────────
export function AddOverrideRuleForm({ brand_id }: { brand_id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  const [ruleType, setRuleType] = useState<'preset' | 'custom'>('preset')
  const [presetKey, setPresetKey] = useState('force_hashtags')
  const [customKey, setCustomKey] = useState('')
  const [valueType, setValueType] = useState<'list' | 'text' | 'boolean'>('list')
  const [listVal, setListVal] = useState('')
  const [textVal, setTextVal] = useState('')
  const [boolVal, setBoolVal] = useState('true')
  const [description, setDescription] = useState('')
  const [reasoning, setReasoning] = useState('')

  const PRESET_KEYS = [
    { key: 'force_hashtags', label: 'Force hashtags', hint: 'Hashtags the AI must always include', type: 'list' as const },
    { key: 'force_mention', label: 'Force mention', hint: 'Accounts to always mention (@username)', type: 'list' as const },
    { key: 'always_include_location', label: 'Always include location', hint: 'e.g. الرياض or Riyadh', type: 'text' as const },
    { key: 'tone_override', label: 'Tone override', hint: 'e.g. "ultra-formal" or "playful"', type: 'text' as const },
    { key: 'language_lock', label: 'Language lock', hint: 'e.g. "arabic_only" or "bilingual"', type: 'text' as const },
    { key: 'disable_emojis', label: 'Disable emojis', hint: 'Set to true to remove all emojis', type: 'boolean' as const },
    { key: 'ramadan_mode', label: 'Ramadan mode', hint: 'Switches to Ramadan-appropriate tone', type: 'boolean' as const },
    { key: 'watermark_text', label: 'Watermark text', hint: 'Text appended to every caption', type: 'text' as const },
  ]

  const activeKey = ruleType === 'preset' ? presetKey : customKey
  const preset = PRESET_KEYS.find((p) => p.key === presetKey)

  // Auto-set value type when switching preset
  const handlePresetChange = (k: string) => {
    setPresetKey(k)
    const found = PRESET_KEYS.find((p) => p.key === k)
    if (found) setValueType(found.type)
  }

  const buildRuleValue = (): string => {
    if (valueType === 'list') {
      const items = listVal.split(',').map((s) => s.trim()).filter(Boolean)
      return JSON.stringify(items)
    }
    if (valueType === 'boolean') return boolVal
    return JSON.stringify(textVal)
  }

  const canSubmit = activeKey.trim().length >= 2 &&
    (valueType === 'list' ? listVal.trim().length > 0 :
     valueType === 'text' ? textVal.trim().length > 0 : true)

  return (
    <form
      className="flex flex-col gap-3 pt-3 border-t border-(--border-subtle) mt-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit) return
        const rv = buildRuleValue()
        startTransition(async () => {
          const r = await addOverrideRule({
            brand_id,
            rule_key: activeKey.trim(),
            rule_value: rv,
            reasoning: reasoning.trim() || undefined,
          })
          setState(r.ok ? { ok: true } : { ok: false, error: r.error })
          if (r.ok) { setListVal(''); setTextVal(''); setDescription(''); setReasoning(''); router.refresh() }
        })
      }}
    >
      {/* Rule type toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setRuleType('preset')}
          className={`rounded-(--r-sm) border px-3 py-1 text-xs font-medium transition-colors ${ruleType === 'preset' ? 'border-(--accent) bg-(--accent)/10 text-(--accent)' : 'border-(--border-subtle) text-(--fg-muted) hover:bg-(--surface-2)'}`}
        >
          Common rules
        </button>
        <button
          type="button"
          onClick={() => setRuleType('custom')}
          className={`rounded-(--r-sm) border px-3 py-1 text-xs font-medium transition-colors ${ruleType === 'custom' ? 'border-(--accent) bg-(--accent)/10 text-(--accent)' : 'border-(--border-subtle) text-(--fg-muted) hover:bg-(--surface-2)'}`}
        >
          Custom rule
        </button>
      </div>

      {/* Rule key */}
      {ruleType === 'preset' ? (
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Rule type</label>
          <select
            className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 text-sm"
            value={presetKey}
            onChange={(e) => handlePresetChange(e.target.value)}
            disabled={pending}
          >
            {PRESET_KEYS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          {preset?.hint && <p className="mt-0.5 text-xs text-(--fg-faint)">{preset.hint}</p>}
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Rule key (snake_case)</label>
          <Input
            placeholder="e.g. force_cta_button, max_caption_length"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            disabled={pending}
            className="font-mono text-sm"
          />
        </div>
      )}

      {/* Value type selector (for custom rules) */}
      {ruleType === 'custom' && (
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Value type</label>
          <div className="flex gap-2">
            {(['list', 'text', 'boolean'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setValueType(t)}
                className={`rounded-(--r-sm) border px-2.5 py-1 text-xs capitalize transition-colors ${valueType === t ? 'border-(--accent) bg-(--accent)/10 text-(--accent)' : 'border-(--border-subtle) text-(--fg-muted) hover:bg-(--surface-2)'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Value input */}
      {valueType === 'list' && (
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">
            {presetKey === 'force_hashtags' ? 'Hashtags' : presetKey === 'force_mention' ? 'Mentions' : 'Items'} (comma-separated)
          </label>
          <Input
            placeholder={presetKey === 'force_hashtags' ? '#riyadh, #saudi, #الرياض' : presetKey === 'force_mention' ? '@brand_account' : 'item1, item2'}
            value={listVal}
            onChange={(e) => setListVal(e.target.value)}
            disabled={pending}
          />
        </div>
      )}
      {valueType === 'text' && (
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Value</label>
          <Input
            placeholder={preset?.hint ?? 'Enter value'}
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            disabled={pending}
          />
        </div>
      )}
      {valueType === 'boolean' && (
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Value</label>
          <select
            className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2 py-1.5 text-sm"
            value={boolVal}
            onChange={(e) => setBoolVal(e.target.value)}
            disabled={pending}
          >
            <option value="true">true — enabled</option>
            <option value="false">false — disabled</option>
          </select>
        </div>
      )}

      {/* Reasoning (optional) */}
      <div>
        <label className="block text-xs font-medium text-(--fg-muted) mb-1">Reason (optional)</label>
        <Input
          placeholder="Why this rule is needed"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !canSubmit}>
          {pending ? 'Saving…' : 'Add rule'}
        </Button>
        <ErrorOrOk state={state} />
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────
// 7. Delete buttons for patterns + rules
// ─────────────────────────────────────────────────────────────────
export function DeleteNegativePatternButton({ brand_id, pattern_id }: { brand_id: string; pattern_id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(async () => {
        if (!window.confirm('Delete this pattern?')) return
        await deleteNegativePattern({ brand_id, pattern_id })
        router.refresh()
      })}
    >
      {pending ? '…' : '✕'}
    </Button>
  )
}

export function DeleteOverrideRuleButton({ brand_id, rule_id }: { brand_id: string; rule_id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(async () => {
        if (!window.confirm('Delete this rule?')) return
        await deleteOverrideRule({ brand_id, rule_id })
        router.refresh()
      })}
    >
      {pending ? '…' : '✕'}
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────
// 8. Filter bar — uses router.push() so navigation is a soft
//    Next.js re-render (no full page reload). The form key changes
//    whenever applied URL params change, which remounts inputs and
//    resets them to the fresh defaultValue from the server.
// ─────────────────────────────────────────────────────────────────
export function FilterBar({
  filters,
  clearHref,
}: {
  filters: Array<{ key: string; placeholder: string; type?: 'text' | 'select'; options?: string[]; current?: string }>
  clearHref?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  // When the server re-renders with new active params, this key changes →
  // form remounts → inputs re-initialize to the correct defaultValue.
  const formKey = filters.map((f) => `${f.key}:${f.current ?? ''}`).join(',')
  const hasActiveUrlFilter = filters.some((f) => f.current && f.current !== '')
  const base = clearHref ?? pathname

  return (
    <form
      key={formKey}
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        const params = new URLSearchParams()
        for (const f of filters) {
          const v = ((data.get(f.key) as string) ?? '').trim()
          if (v) params.set(f.key, v)
        }
        const qs = params.toString()
        router.push(qs ? `${base}?${qs}` : base)
      }}
      className="flex flex-col gap-2 pb-2 sm:flex-row sm:flex-wrap sm:items-center"
    >
      {filters.map((f) =>
        f.type === 'select' && f.options ? (
          <select
            key={f.key}
            name={f.key}
            defaultValue={f.current ?? ''}
            className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-2.5 py-1.5 text-xs text-(--fg) sm:w-auto"
          >
            <option value="">{f.placeholder}</option>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <Input
            key={f.key}
            name={f.key}
            defaultValue={f.current ?? ''}
            placeholder={f.placeholder}
            className="w-full sm:w-52"
          />
        )
      )}
      <Button type="submit" size="sm" variant="ghost" className="w-full sm:w-auto">
        Apply filters
      </Button>
      {hasActiveUrlFilter && (
        <button
          type="button"
          onClick={() => router.push(base)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1.5 text-xs text-(--fg-muted) transition-colors hover:bg-(--surface-2) hover:text-(--fg) sm:w-auto"
        >
          <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Clear filters
        </button>
      )}
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────
// Visual style editor — color palette + style descriptor
// ─────────────────────────────────────────────────────────────────
export function VisualStyleEditor({
  brand_id,
  initial_palette,
  initial_descriptor,
}: {
  brand_id: string
  initial_palette: string[] | null
  initial_descriptor: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState<string[]>(initial_palette ?? [])
  const [descriptor, setDescriptor] = useState(initial_descriptor ?? '')
  // hex input for new colour
  const [newHex, setNewHex] = useState('#')
  const [hexError, setHexError] = useState('')

  function isValidHex(v: string) { return /^#[0-9A-Fa-f]{6}$/.test(v) }

  function addColour() {
    const h = newHex.trim().toUpperCase()
    if (!isValidHex(h)) { setHexError('Enter a valid 6-digit hex e.g. #FF5500'); return }
    if (palette.includes(h)) { setHexError('Already in palette'); return }
    if (palette.length >= 12) { setHexError('Maximum 12 colours'); return }
    setPalette((p) => [...p, h])
    setNewHex('#')
    setHexError('')
    setState(null)
  }

  function removeColour(hex: string) {
    setPalette((p) => p.filter((c) => c !== hex))
    setState(null)
  }

  function updateColour(idx: number, val: string) {
    const h = val.trim().toUpperCase()
    setPalette((p) => p.map((c, i) => (i === idx ? h : c)))
    setState(null)
  }

  function save() {
    const invalidIdx = palette.findIndex((c) => !isValidHex(c))
    if (invalidIdx >= 0) { setState({ ok: false, error: `Colour ${palette[invalidIdx]} is not valid hex` }); return }
    startTransition(async () => {
      const r = await updateVisualStyle({
        brand_id,
        color_palette: palette.length > 0 ? palette : undefined,
        style_descriptor: descriptor.trim() !== (initial_descriptor ?? '') ? descriptor.trim() || undefined : undefined,
      })
      setState(r.ok ? { ok: true } : { ok: false, error: (r as { ok: false; error: string }).error })
      if (r.ok) setOpen(false)
    })
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit visual style
      </Button>
    )
  }

  return (
    <div className="mt-3 rounded-(--r-md) border border-(--border-default) bg-(--surface-1) p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-(--fg)">Edit visual style</span>
        <button
          className="text-xs text-(--fg-muted) hover:text-(--fg)"
          onClick={() => { setOpen(false); setState(null) }}
        >
          ✕
        </button>
      </div>

      {/* Colour palette */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-(--fg-muted) uppercase tracking-wider">Colour palette</div>

        {/* Existing swatches */}
        <div className="flex flex-wrap gap-2">
          {palette.map((hex, idx) => (
            <div key={idx} className="group relative flex items-center gap-1.5 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-2) pl-1.5 pr-2 py-1">
              {/* Colour picker */}
              <label className="relative cursor-pointer">
                <span
                  className="block h-5 w-5 rounded-sm border border-(--border-subtle) cursor-pointer"
                  style={{ backgroundColor: hex }}
                />
                <input
                  type="color"
                  value={isValidHex(hex) ? hex : '#000000'}
                  onChange={(e) => updateColour(idx, e.target.value.toUpperCase())}
                  className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                  title="Pick colour"
                />
              </label>
              <span className="font-mono text-xs text-(--fg)">{hex}</span>
              <button
                onClick={() => removeColour(hex)}
                className="text-xs text-(--fg-faint) hover:text-red-400 ml-0.5"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Add new colour row */}
        <div className="flex items-center gap-2">
          {/* Native colour picker preview */}
          <label className="relative cursor-pointer">
            <span
              className="block h-8 w-8 rounded-(--r-sm) border border-(--border-subtle) cursor-pointer"
              style={{ backgroundColor: isValidHex(newHex) ? newHex : '#cccccc' }}
            />
            <input
              type="color"
              value={isValidHex(newHex) ? newHex : '#cccccc'}
              onChange={(e) => { setNewHex(e.target.value.toUpperCase()); setHexError('') }}
              className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
              title="Pick colour"
            />
          </label>
          <Input
            value={newHex}
            onChange={(e) => { setNewHex(e.target.value); setHexError('') }}
            placeholder="#FF5500"
            className="font-mono w-28 text-xs"
            maxLength={7}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColour() } }}
          />
          <Button size="sm" variant="secondary" onClick={addColour} disabled={pending}>
            + Add
          </Button>
        </div>
        {hexError && <p className="text-xs text-red-400">{hexError}</p>}
      </div>

      {/* Style descriptor */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-(--fg-muted) uppercase tracking-wider">Style descriptor</div>
        <textarea
          value={descriptor}
          onChange={(e) => { setDescriptor(e.target.value); setState(null) }}
          rows={3}
          className="w-full rounded-(--r-sm) border border-(--border-default) bg-(--surface-2) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-1 focus:ring-(--accent) resize-none"
          placeholder="Describe the visual style — photography style, mood, composition…"
        />
      </div>

      {/* Save row */}
      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" variant="primary" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save via Memory Controller'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setState(null) }} disabled={pending}>
          Cancel
        </Button>
        <ErrorOrOk state={state} />
      </div>
      <p className="text-xs text-(--fg-faint)">
        Changes go through the Memory Controller queue and are written immediately. The event log will record the update.
      </p>
    </div>
  )
}
