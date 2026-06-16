'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { Input } from '@repo/ui/input'
import {
  addGlobalNegativePattern,
  toggleGlobalNegativePattern,
  deleteGlobalNegativePattern,
} from '../actions'

function StatusMsg({ state }: { state: { ok: boolean; error?: string } | null }) {
  if (!state) return null
  if (state.ok) return <span className="text-xs text-emerald-500">✓ Saved</span>
  return <span className="text-xs text-rose-500">{state.error ?? 'Error'}</span>
}

export function GlobalPatternAddForm() {
  const router = useRouter()
  const [pending, startT] = useTransition()
  const [state, setState] = useState<{ ok: boolean; error?: string } | null>(null)
  const [text, setText] = useState('')
  const [severity, setSeverity] = useState<'SOFT_WARN' | 'STRONG_WARN' | 'HARD_BLOCK'>('HARD_BLOCK')
  const [category, setCategory] = useState('general')
  const [description, setDescription] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (text.trim().length < 2) return
    startT(async () => {
      const r = await addGlobalNegativePattern({
        pattern_text: text.trim(),
        severity,
        category: category.trim() || 'general',
        description: description.trim() || undefined,
      })
      setState(r.ok ? { ok: true } : { ok: false, error: r.error })
      if (r.ok) { setText(''); setDescription(''); router.refresh() }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Pattern text *</label>
          <Input
            placeholder="e.g. alcohol, guaranteed cure, قمار"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Severity</label>
          <select
            className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-3 py-1.5 text-sm"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            disabled={pending}
          >
            <option value="HARD_BLOCK">HARD_BLOCK — absolute prohibition</option>
            <option value="STRONG_WARN">STRONG_WARN — strong warning</option>
            <option value="SOFT_WARN">SOFT_WARN — use with caution</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Category</label>
          <select
            className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-3 py-1.5 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={pending}
          >
            <option value="alcohol_substances">Alcohol & Substances</option>
            <option value="gambling">Gambling</option>
            <option value="adult_content">Adult Content</option>
            <option value="political">Political</option>
            <option value="religious">Religious</option>
            <option value="hate_speech">Hate Speech</option>
            <option value="false_claims">False Claims</option>
            <option value="financial">Financial</option>
            <option value="urgency_manipulation">Urgency Manipulation</option>
            <option value="general">General</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-(--fg-muted) mb-1">Description (optional)</label>
          <Input
            placeholder="Why this pattern is blocked"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || text.trim().length < 2}>
          {pending ? 'Adding…' : 'Add global pattern'}
        </Button>
        <StatusMsg state={state} />
      </div>
    </form>
  )
}

export function GlobalPatternRowActions({
  pattern_id,
  is_active,
}: {
  pattern_id: string
  is_active: boolean
}) {
  const router = useRouter()
  const [togglePending, startToggle] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="text-xs text-rose-500">{error}</span>}
      <Button
        size="sm"
        variant="ghost"
        disabled={togglePending}
        onClick={() =>
          startToggle(async () => {
            const r = await toggleGlobalNegativePattern({ pattern_id, is_active: !is_active })
            if (!r.ok) setError(r.error)
            else router.refresh()
          })
        }
        title={is_active ? 'Deactivate' : 'Activate'}
      >
        {togglePending ? '…' : is_active ? '⏸' : '▶'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={deletePending}
        onClick={() => {
          if (!window.confirm('Permanently delete this global pattern?')) return
          startDelete(async () => {
            const r = await deleteGlobalNegativePattern({ pattern_id })
            if (!r.ok) setError(r.error)
            else router.refresh()
          })
        }}
        title="Delete permanently"
      >
        {deletePending ? '…' : '✕'}
      </Button>
    </div>
  )
}
