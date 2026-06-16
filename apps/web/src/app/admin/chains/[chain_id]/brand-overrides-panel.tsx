'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ChainBrandOverride } from '@repo/db'
import { Badge } from '@repo/ui/badge'

interface Props {
  chainId: string
  initialOverrides: ChainBrandOverride[]
}

const inputCls = 'w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-2) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-2 focus:ring-(--accent)/40 focus:border-(--accent) transition-colors'

export function BrandOverridesPanel({ chainId, initialOverrides }: Props) {
  const router = useRouter()
  const [overrides, setOverrides] = useState(initialOverrides)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newForm, setNewForm] = useState({
    brand_id:                 '',
    prompt_suffix:            '',
    negative_prompt_override: '',
    fal_model_override:       '',
    notes:                    '',
    is_active:                true,
  })

  function setNew(key: keyof typeof newForm, val: unknown) {
    setNewForm((f) => ({ ...f, [key]: val }))
  }

  async function handleAdd() {
    if (!newForm.brand_id.trim()) { setError('brand_id is required'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/admin/chains/${chainId}/overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_id:                 newForm.brand_id.trim(),
          prompt_suffix:            newForm.prompt_suffix || null,
          negative_prompt_override: newForm.negative_prompt_override || null,
          fal_model_override:       newForm.fal_model_override || null,
          notes:                    newForm.notes || null,
          is_active:                newForm.is_active,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError((d as { error?: string }).error ?? 'Save failed'); return }
      const created = await res.json() as ChainBrandOverride
      setOverrides((prev) => [created, ...prev.filter((o) => o.id !== created.id)])
      setAdding(false)
      setNewForm({ brand_id: '', prompt_suffix: '', negative_prompt_override: '', fal_model_override: '', notes: '', is_active: true })
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/admin/chains/${chainId}/overrides?id=${id}`, { method: 'DELETE' })
      if (!res.ok) return
      setOverrides((prev) => prev.filter((o) => o.id !== id))
      router.refresh()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      {overrides.length === 0 && !adding && (
        <p className="text-xs text-(--fg-faint)">No brand overrides configured for this chain.</p>
      )}

      {overrides.map((o) => (
        <div key={o.id} className="rounded-lg border border-(--border-subtle) bg-(--surface-2) px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-(--fg-muted)">{o.brand_id}</span>
            <Badge tone={o.is_active ? 'success' : 'outline'} size="sm">{o.is_active ? 'active' : 'inactive'}</Badge>
            <button
              onClick={() => handleDelete(o.id)}
              className="ms-auto text-xs text-(--fg-faint) hover:text-red-500 transition-colors"
            >
              Remove
            </button>
          </div>
          {o.prompt_suffix && (
            <div>
              <p className="text-[10px] text-(--fg-faint) uppercase tracking-widest mb-1">Prompt suffix</p>
              <pre className="text-xs text-(--fg-muted) bg-(--surface-3) rounded p-2 whitespace-pre-wrap break-all">{o.prompt_suffix}</pre>
            </div>
          )}
          {o.negative_prompt_override && (
            <div>
              <p className="text-[10px] text-(--fg-faint) uppercase tracking-widest mb-1">Negative prompt override</p>
              <pre className="text-xs text-(--fg-muted) bg-(--surface-3) rounded p-2 whitespace-pre-wrap break-all">{o.negative_prompt_override}</pre>
            </div>
          )}
          {o.fal_model_override && (
            <div>
              <p className="text-[10px] text-(--fg-faint) uppercase tracking-widest mb-1">Model override</p>
              <span className="font-mono text-xs text-(--fg-muted)">{o.fal_model_override}</span>
            </div>
          )}
          {o.notes && <p className="text-xs text-(--fg-faint)">{o.notes}</p>}
        </div>
      ))}

      {adding ? (
        <div className="rounded-lg border border-(--border-default) bg-(--surface-1) p-4 space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-(--fg-faint)">New brand override</h4>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-(--fg-muted)">Brand ID <span className="text-red-400">*</span></label>
            <input value={newForm.brand_id} onChange={(e) => setNew('brand_id', e.target.value)} placeholder="UUID of the brand" className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-(--fg-muted)">Prompt suffix <span className="text-(--fg-faint)">(appended to rendered template)</span></label>
            <textarea value={newForm.prompt_suffix} onChange={(e) => setNew('prompt_suffix', e.target.value)} rows={3} className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-(--fg-muted)">Negative prompt override</label>
            <textarea value={newForm.negative_prompt_override} onChange={(e) => setNew('negative_prompt_override', e.target.value)} rows={2} className={inputCls + ' font-mono text-xs'} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-(--fg-muted)">fal.ai model override <span className="text-(--fg-faint)">(e.g. downgrade for cost)</span></label>
            <input value={newForm.fal_model_override} onChange={(e) => setNew('fal_model_override', e.target.value)} placeholder="fal-ai/flux-pro/v1.1" className={inputCls + ' font-mono text-xs'} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-(--fg-muted)">Notes</label>
            <input value={newForm.notes} onChange={(e) => setNew('notes', e.target.value)} className={inputCls} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={newForm.is_active} onChange={(e) => setNew('is_active', e.target.checked)} className="rounded accent-(--accent)" />
            <span className="text-sm text-(--fg-muted)">Active</span>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="rounded-(--r-md) bg-(--accent) px-3.5 py-2 text-sm font-medium text-(--accent-fg) hover:bg-(--accent-strong) transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add override'}
            </button>
            <button onClick={() => { setAdding(false); setError(null) }} className="rounded-(--r-md) border border-(--border-default) px-3.5 py-2 text-sm text-(--fg-muted) hover:text-(--fg) transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-(--r-md) border border-(--border-subtle) px-3.5 py-2 text-sm text-(--fg-muted) hover:bg-(--surface-2) hover:border-(--border-default) transition-colors"
        >
          + Add brand override
        </button>
      )}
    </div>
  )
}
