'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ChainRow } from '@repo/db'

interface Props {
  chain: ChainRow
}

const FAMILIES = [
  'TF01','TF02','TF03','TF04','TF05','TF06','TF07','TF08','TF09','TF10',
  'TF11','TF12','TF13','TF14','TF15','TF16','TF17','TF18','TF19','TF20',
  'TF21','TF22','TF23',
]

const OUTPUT_TYPES = ['image','video','carousel','audio','mixed']
const QUALITY_TIERS = ['starter','growth','enterprise']
const CONFIDENCE_LEVELS = ['experimental','inferred','confirmed']

export function ChainEditForm({ chain }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [form, setForm] = useState({
    name_en:              chain.name_en,
    name_ar:              chain.name_ar,
    family:               chain.family,
    purpose:              chain.purpose ?? '',
    fal_model_primary:    chain.fal_model_primary,
    fal_model_secondary:  chain.fal_model_secondary ?? '',
    prompt_template:      chain.prompt_template,
    negative_prompt:      chain.negative_prompt ?? '',
    video_motion_prompt:  chain.video_motion_prompt ?? '',
    input_schema:         JSON.stringify(chain.input_schema ?? {}, null, 2),
    output_type:          chain.output_type,
    output_width:         String(chain.output_width ?? ''),
    output_height:        String(chain.output_height ?? ''),
    output_duration_s:    String(chain.output_duration_s ?? ''),
    aspect_ratio:         chain.aspect_ratio ?? '',
    eligible_sectors:     (chain.eligible_sectors ?? []).join(', '),
    excluded_sectors:     (chain.excluded_sectors ?? []).join(', '),
    eligible_occasions:   (chain.eligible_occasions ?? []).join(', '),
    excluded_occasions:   (chain.excluded_occasions ?? []).join(', '),
    quality_tiers:        (chain.quality_tiers ?? ['starter','growth','enterprise']) as string[],
    min_maturity_days:    String(chain.min_maturity_days ?? 0),
    // ── Chain-SELECTION signals (read by the selector) — editable so admin-added
    //    chains are first-class: style-ranked, platform-scoped, intent-matched, capped.
    style_affinity:       (chain as { style_affinity?: string | null }).style_affinity ?? '',
    platform_tags:        ((chain as { platform_tags?: string[] | null }).platform_tags ?? []).join(', '),
    intent:               (chain.intent ?? []).join(', '),
    frequency:            chain.frequency ?? '',
    cultural_constraints: JSON.stringify(chain.cultural_constraints ?? {}, null, 2),
    anti_patterns:        (chain.anti_patterns ?? []).join('\n'),
    cost_estimate_usd:    String(chain.cost_estimate_usd ?? ''),
    latency_estimate_s:   String(chain.latency_estimate_s ?? ''),
    best_for_cd_brains:   (chain.best_for_cd_brains ?? []).join(', '),
    saudi_adaptation:     chain.saudi_adaptation ?? '',
    provenance_source:    chain.provenance_source ?? '',
    provenance_confirmer: chain.provenance_confirmer ?? '',
    provenance_confidence: chain.provenance_confidence ?? 'experimental',
    provenance_scope:     chain.provenance_scope ?? 'universal',
    is_active:            chain.is_active,
    notes:                chain.notes ?? '',
  })

  function set(key: keyof typeof form, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
    setError(null)
  }

  function toggleTier(tier: string) {
    const tiers = form.quality_tiers as string[]
    set('quality_tiers', tiers.includes(tier) ? tiers.filter((t) => t !== tier) : [...tiers, tier])
  }

  function splitCsv(val: string): string[] | null {
    const arr = val.split(',').map((s) => s.trim()).filter(Boolean)
    return arr.length > 0 ? arr : null
  }

  function handleSave() {
    setError(null)
    setSaved(false)

    let input_schema: Record<string, unknown>
    let cultural_constraints: Record<string, unknown>
    try { input_schema = JSON.parse(form.input_schema) } catch {
      setError('Input schema is not valid JSON'); return
    }
    try { cultural_constraints = JSON.parse(form.cultural_constraints) } catch {
      setError('Cultural constraints is not valid JSON'); return
    }

    const patch = {
      name_en:              form.name_en,
      name_ar:              form.name_ar,
      family:               form.family,
      purpose:              form.purpose || null,
      fal_model_primary:    form.fal_model_primary,
      fal_model_secondary:  form.fal_model_secondary || null,
      prompt_template:      form.prompt_template,
      negative_prompt:      form.negative_prompt || null,
      video_motion_prompt:  form.video_motion_prompt || null,
      input_schema,
      output_type:          form.output_type,
      output_width:         form.output_width  ? parseInt(form.output_width, 10)  : null,
      output_height:        form.output_height ? parseInt(form.output_height, 10) : null,
      output_duration_s:    form.output_duration_s ? parseInt(form.output_duration_s, 10) : null,
      aspect_ratio:         form.aspect_ratio || null,
      eligible_sectors:     splitCsv(form.eligible_sectors),
      excluded_sectors:     splitCsv(form.excluded_sectors),
      eligible_occasions:   splitCsv(form.eligible_occasions),
      excluded_occasions:   splitCsv(form.excluded_occasions),
      quality_tiers:        form.quality_tiers as string[],
      min_maturity_days:    parseInt(form.min_maturity_days, 10) || 0,
      // Selection signals → same columns the selector reads.
      style_affinity:       form.style_affinity || null,
      platform_tags:        splitCsv(form.platform_tags),
      intent:               splitCsv(form.intent),
      frequency:            form.frequency || null,
      cultural_constraints,
      anti_patterns:        form.anti_patterns.split('\n').map((s) => s.trim()).filter(Boolean),
      cost_estimate_usd:    form.cost_estimate_usd ? parseFloat(form.cost_estimate_usd) : null,
      latency_estimate_s:   form.latency_estimate_s ? parseInt(form.latency_estimate_s, 10) : null,
      best_for_cd_brains:   splitCsv(form.best_for_cd_brains),
      saudi_adaptation:     form.saudi_adaptation || null,
      provenance_source:    form.provenance_source || null,
      provenance_confirmer: form.provenance_confirmer || null,
      provenance_confidence: form.provenance_confidence as ChainRow['provenance_confidence'],
      provenance_scope:     form.provenance_scope || 'universal',
      is_active:            form.is_active,
      notes:                form.notes || null,
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/chains/${chain.chain_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError((data as { error?: string }).error ?? `HTTP ${res.status}`)
          return
        }
        setSaved(true)
        router.refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    fetch(`/api/admin/chains/${chain.chain_id}`, { method: 'DELETE' })
      .then((r) => {
        if (r.ok) router.push('/admin/chains')
        else r.json().then((d) => setError((d as { error?: string }).error ?? 'Delete failed'))
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setDeleting(false))
  }

  return (
    <div className="space-y-6">

      {/* Identity */}
      <FieldSet title="Identity">
        <Field label="Chain ID" hint="Read-only — primary key">
          <input value={chain.chain_id} disabled className={inputCls + ' opacity-50 cursor-not-allowed'} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (English)" required>
            <input value={form.name_en} onChange={(e) => set('name_en', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Name (Arabic)" required>
            <input value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} dir="rtl" className={inputCls} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Family" required>
            <select value={form.family} onChange={(e) => set('family', e.target.value)} className={inputCls}>
              {FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Output type" required>
            <select value={form.output_type} onChange={(e) => set('output_type', e.target.value)} className={inputCls}>
              {OUTPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Purpose">
          <textarea value={form.purpose} onChange={(e) => set('purpose', e.target.value)} rows={2} className={inputCls} />
        </Field>
      </FieldSet>

      {/* Models */}
      <FieldSet title="fal.ai Models">
        <Field label="Primary model" required hint="e.g. fal-ai/flux-pro/v1.1-ultra">
          <input value={form.fal_model_primary} onChange={(e) => set('fal_model_primary', e.target.value)} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Secondary model" hint="Kling for video chains — leave blank for image-only">
          <input value={form.fal_model_secondary} onChange={(e) => set('fal_model_secondary', e.target.value)} className={inputCls + ' font-mono text-xs'} />
        </Field>
      </FieldSet>

      {/* Output spec */}
      <FieldSet title="Output Specification">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Width (px)"><input type="number" value={form.output_width} onChange={(e) => set('output_width', e.target.value)} className={inputCls} /></Field>
          <Field label="Height (px)"><input type="number" value={form.output_height} onChange={(e) => set('output_height', e.target.value)} className={inputCls} /></Field>
          <Field label="Duration (s)" hint="Video only"><input type="number" value={form.output_duration_s} onChange={(e) => set('output_duration_s', e.target.value)} className={inputCls} /></Field>
          <Field label="Aspect ratio" hint="e.g. 9:16"><input value={form.aspect_ratio} onChange={(e) => set('aspect_ratio', e.target.value)} className={inputCls} /></Field>
        </div>
      </FieldSet>

      {/* Prompt */}
      <FieldSet title="Prompt Templates">
        <Field label="Prompt template" required hint="Use {{variable_name}} for dynamic slots">
          <textarea value={form.prompt_template} onChange={(e) => set('prompt_template', e.target.value)} rows={6} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Negative prompt" hint="Overrides global negative prompt for this chain">
          <textarea value={form.negative_prompt} onChange={(e) => set('negative_prompt', e.target.value)} rows={3} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Video motion prompt" hint="Animation instruction sent to the image-to-video model (Kling/Seedance). Used when format_tier=video.">
          <textarea value={form.video_motion_prompt} onChange={(e) => set('video_motion_prompt', e.target.value)} rows={3} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Input schema (JSON)" hint='{"required":["var1"],"optional":["var2"]}'>
          <textarea value={form.input_schema} onChange={(e) => set('input_schema', e.target.value)} rows={8} className={inputCls + ' font-mono text-xs'} />
        </Field>
      </FieldSet>

      {/* Eligibility */}
      <FieldSet title="Eligibility">
        <Field label="Quality tiers" required>
          <div className="flex gap-3 flex-wrap">
            {QUALITY_TIERS.map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(form.quality_tiers as string[]).includes(t)}
                  onChange={() => toggleTier(t)}
                  className="rounded border-(--border-default) accent-(--accent)"
                />
                <span className="text-sm text-(--fg-muted)">{t}</span>
              </label>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Eligible sectors" hint="Comma-separated. Empty = all sectors.">
            <input value={form.eligible_sectors} onChange={(e) => set('eligible_sectors', e.target.value)} placeholder="f_and_b, retail, beauty" className={inputCls} />
          </Field>
          <Field label="Excluded sectors" hint="Comma-separated.">
            <input value={form.excluded_sectors} onChange={(e) => set('excluded_sectors', e.target.value)} placeholder="healthcare_emergency" className={inputCls} />
          </Field>
          <Field label="Eligible occasions" hint="Comma-separated. Empty = all.">
            <input value={form.eligible_occasions} onChange={(e) => set('eligible_occasions', e.target.value)} placeholder="eid_al_adha, national_day" className={inputCls} />
          </Field>
          <Field label="Excluded occasions" hint="Comma-separated.">
            <input value={form.excluded_occasions} onChange={(e) => set('excluded_occasions', e.target.value)} placeholder="ramadan_solemn_phase" className={inputCls} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Min maturity (days)">
            <input type="number" value={form.min_maturity_days} onChange={(e) => set('min_maturity_days', e.target.value)} min={0} className={inputCls} />
          </Field>
          <Field label="Best for CD brains" hint="Comma-separated, e.g. cd_01, cd_04">
            <input value={form.best_for_cd_brains} onChange={(e) => set('best_for_cd_brains', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Intent" hint="Comma-separated funnel stages: launch, grow, harvest (or 'all')">
            <input value={form.intent} onChange={(e) => set('intent', e.target.value)} placeholder="launch, grow, harvest" className={inputCls} />
          </Field>
          <Field label="Frequency" hint="Recommended posting cadence, e.g. '3-5 per week'">
            <input value={form.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="3-5 per week" className={inputCls} />
          </Field>
        </div>
      </FieldSet>

      {/* Selection signals — read by the chain selector to RANK + CAP this chain. */}
      <FieldSet title="Selection Signals">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Style affinity" hint="Matches brand style for a +30 ranking boost: modern / traditional / youth / mixed. Empty = neutral.">
            <input value={form.style_affinity} onChange={(e) => set('style_affinity', e.target.value)} placeholder="modern" className={inputCls} />
          </Field>
          <Field label="Platform tags" hint="Comma-separated lowercase. Empty = ALL platforms. e.g. instagram, tiktok">
            <input value={form.platform_tags} onChange={(e) => set('platform_tags', e.target.value)} placeholder="instagram" className={inputCls} />
          </Field>
          <Field label="Intent states" hint="Comma-separated. Boosts ranking when brand intent matches: launch, grow, defend, harvest, recover">
            <input value={form.intent} onChange={(e) => set('intent', e.target.value)} placeholder="grow, harvest" className={inputCls} />
          </Field>
          <Field label="Frequency cap" hint='Max usage, e.g. "3-5 per week", "1-2", "0.5". Empty = uncapped. The selector reassigns over-cap posts to another chain.'>
            <input value={form.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="3-5 per week" className={inputCls} />
          </Field>
        </div>
      </FieldSet>

      {/* Cultural constraints */}
      <FieldSet title="Cultural Constraints (JSON)">
        <Field label="Cultural constraints" hint='Boolean flags: requires_wardrobe_check, high_gender_sensitivity, etc.'>
          <textarea value={form.cultural_constraints} onChange={(e) => set('cultural_constraints', e.target.value)} rows={8} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Saudi adaptation" hint="Creative guidance for the Saudi market — surfaced to the COO agent at prompt-fill time.">
          <textarea value={form.saudi_adaptation} onChange={(e) => set('saudi_adaptation', e.target.value)} rows={3} className={inputCls} />
        </Field>
      </FieldSet>

      {/* Anti-patterns */}
      <FieldSet title="Anti-Patterns">
        <Field label="Anti-patterns" hint="One per line — failure modes to document">
          <textarea value={form.anti_patterns} onChange={(e) => set('anti_patterns', e.target.value)} rows={5} className={inputCls} />
        </Field>
      </FieldSet>

      {/* Cost & latency */}
      <FieldSet title="Cost & Latency">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cost estimate (USD)">
            <input type="number" step="0.001" value={form.cost_estimate_usd} onChange={(e) => set('cost_estimate_usd', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Latency estimate (s)">
            <input type="number" value={form.latency_estimate_s} onChange={(e) => set('latency_estimate_s', e.target.value)} className={inputCls} />
          </Field>
        </div>
      </FieldSet>

      {/* Provenance */}
      <FieldSet title="Provenance">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source"><input value={form.provenance_source} onChange={(e) => set('provenance_source', e.target.value)} className={inputCls} /></Field>
          <Field label="Confirmer"><input value={form.provenance_confirmer} onChange={(e) => set('provenance_confirmer', e.target.value)} className={inputCls} /></Field>
          <Field label="Confidence">
            <select value={form.provenance_confidence} onChange={(e) => set('provenance_confidence', e.target.value)} className={inputCls}>
              {CONFIDENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Scope" hint="universal | sector:slug | brand:ulid">
            <input value={form.provenance_scope} onChange={(e) => set('provenance_scope', e.target.value)} className={inputCls} />
          </Field>
        </div>
      </FieldSet>

      {/* Lifecycle */}
      <FieldSet title="Lifecycle">
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className={inputCls} />
        </Field>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            className="h-4 w-4 rounded border-(--border-default) accent-(--accent)"
          />
          <span className="text-sm text-(--fg-muted)">Active — chain is eligible for auto-selection and callable by chain_id</span>
        </label>
      </FieldSet>

      {/* Actions */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>
      )}
      {saved && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">Chain saved successfully.</div>
      )}

      <div className="flex items-center justify-between border-t border-(--border-subtle) pt-4">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || isPending}
          className={`rounded-(--r-md) px-3.5 py-2 text-sm font-medium transition-colors ${
            confirmDelete
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'border border-(--border-default) text-(--fg-muted) hover:border-red-500 hover:text-red-500'
          } disabled:opacity-50`}
        >
          {deleting ? 'Deleting…' : confirmDelete ? 'Click again to confirm delete' : 'Delete chain'}
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-(--r-md) bg-(--accent) px-4 py-2 text-sm font-medium text-(--accent-fg) hover:bg-(--accent-strong) transition-colors disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-2) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-2 focus:ring-(--accent)/40 focus:border-(--accent) transition-colors'

function FieldSet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-(--fg-faint)">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-(--fg-muted)">
        {label}{required && <span className="ml-1 text-red-400">*</span>}
        {hint && <span className="ml-2 font-normal text-(--fg-faint)">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
