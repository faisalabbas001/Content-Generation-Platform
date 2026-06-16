'use client'

import { useActionState, useState } from 'react'
import { saveSystemCostConfig, type CostConfigResult } from '@/app/actions/cost-config'

interface Props {
  current: {
    monthly_ceiling_usd: number
    alert_at_pct: number
    halt_at_pct: number
  }
  labels: {
    ceilingEditor: string
    ceilingLabel:  string
    alertPctLabel: string
    haltPctLabel:  string
    saveCeiling:   string
    savingCeiling: string
    ceilingSaved:  string
    ceilingError:  string
  }
}

const initial: CostConfigResult = { ok: false }

export function SystemCeilingEditor({ current, labels }: Props) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState(saveSystemCostConfig, initial)

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-(--r-md) border border-(--border-default) bg-(--surface-3) px-3 h-8 text-xs font-medium text-(--fg-subtle) hover:border-(--border-strong) hover:text-(--fg) transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        {labels.ceilingEditor}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="mt-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-4">
          <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-(--fg-muted)">{labels.ceilingLabel}</label>
              <div className="relative">
                <span className="absolute inset-y-0 start-3 flex items-center text-sm text-(--fg-muted)">$</span>
                <input type="number" name="monthly_ceiling_usd" defaultValue={current.monthly_ceiling_usd}
                  min={1} max={100000} step={1} required
                  className="w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-4) ps-7 pe-3 h-9 text-sm font-mono text-(--fg) focus:border-(--accent) focus:outline-none focus:ring-2 focus:ring-(--accent-soft)" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-(--fg-muted)">{labels.alertPctLabel}</label>
              <div className="relative">
                <input type="number" name="alert_at_pct" defaultValue={current.alert_at_pct}
                  min={1} max={99} required
                  className="w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-4) px-3 pe-7 h-9 text-sm font-mono text-(--fg) focus:border-(--accent) focus:outline-none focus:ring-2 focus:ring-(--accent-soft)" />
                <span className="absolute inset-y-0 end-3 flex items-center text-sm text-(--fg-muted)">%</span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs uppercase tracking-wide text-(--fg-muted)">{labels.haltPctLabel}</label>
              <div className="relative">
                <input type="number" name="halt_at_pct" defaultValue={current.halt_at_pct}
                  min={1} max={200} required
                  className="w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-4) px-3 pe-7 h-9 text-sm font-mono text-(--fg) focus:border-(--accent) focus:outline-none focus:ring-2 focus:ring-(--accent-soft)" />
                <span className="absolute inset-y-0 end-3 flex items-center text-sm text-(--fg-muted)">%</span>
              </div>
            </div>

            <div className="sm:col-span-3 flex items-center gap-3">
              <button type="submit" disabled={isPending}
                className="inline-flex items-center justify-center rounded-(--r-md) bg-(--accent) px-4 h-9 text-sm font-medium text-(--accent-fg) hover:bg-(--accent-strong) disabled:opacity-50 transition-colors">
                {isPending ? labels.savingCeiling : labels.saveCeiling}
              </button>
              {state.ok && !isPending && (
                <span className="text-xs font-medium text-(--success)">{labels.ceilingSaved} ✓</span>
              )}
              {!state.ok && state.error && !isPending && (
                <span className="text-xs text-(--danger)">{labels.ceilingError}: {state.error}</span>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
