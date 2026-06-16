'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@repo/ui/page-header'
import Link from 'next/link'

const FAMILIES = [
  'TF01','TF02','TF03','TF04','TF05','TF06','TF07','TF08','TF09','TF10',
  'TF11','TF12','TF13','TF14','TF15','TF16','TF17','TF18','TF19','TF20',
  'TF21','TF22','TF23',
]

const OUTPUT_TYPES = ['image','video','carousel','audio','mixed']
const QUALITY_TIERS = ['starter','growth','enterprise']

const inputCls = 'w-full rounded-(--r-md) border border-(--border-default) bg-(--surface-2) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-2 focus:ring-(--accent)/40 focus:border-(--accent) transition-colors'

export default function NewChainPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    chain_id:            '',
    name_en:             '',
    name_ar:             '',
    family:              'TF01',
    purpose:             '',
    fal_model_primary:   'fal-ai/flux-pro/v1.1-ultra',
    fal_model_secondary: '',
    prompt_template:     '',
    negative_prompt:     '',
    video_motion_prompt: '',
    input_schema:        '{\n  "required": [],\n  "optional": []\n}',
    output_type:         'image',
    output_width:        '1080',
    output_height:       '1080',
    output_duration_s:   '',
    aspect_ratio:        '1:1',
    eligible_sectors:    '',
    excluded_sectors:    '',
    eligible_occasions:  '',
    excluded_occasions:  '',
    quality_tiers:       ['starter','growth','enterprise'] as string[],
    min_maturity_days:   '0',
    requires_ref_img:    false,
    intent:              '',
    frequency:           '',
    cultural_constraints:'{\n  "requires_wardrobe_check": false,\n  "requires_gesture_check": false,\n  "requires_cultural_coherence_check": true,\n  "requires_arabic_text_validation": false,\n  "high_religious_sensitivity": false,\n  "high_gender_sensitivity": false\n}',
    saudi_adaptation:    '',
    anti_patterns:       '',
    cost_estimate_usd:   '',
    latency_estimate_s:  '',
    best_for_cd_brains:  '',
    provenance_source:   'OGz_2_0_ChainLibrary_v2_Complete.docx',
    provenance_confirmer:'Mohamed',
    provenance_confidence:'experimental',
    is_active:           true,
    notes:               '',
  })

  function set(key: keyof typeof form, val: unknown) {
    setForm((f) => ({ ...f, [key]: val }))
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

  function handleCreate() {
    setError(null)
    if (!form.chain_id.trim()) { setError('chain_id is required'); return }
    if (!form.name_en.trim())  { setError('English name is required'); return }
    if (!form.name_ar.trim())  { setError('Arabic name is required'); return }
    if (!form.fal_model_primary.trim()) { setError('Primary model is required'); return }
    if (!form.prompt_template.trim())   { setError('Prompt template is required'); return }

    let input_schema: Record<string, unknown>
    let cultural_constraints: Record<string, unknown>
    try { input_schema = JSON.parse(form.input_schema) } catch { setError('Input schema is not valid JSON'); return }
    try { cultural_constraints = JSON.parse(form.cultural_constraints) } catch { setError('Cultural constraints is not valid JSON'); return }

    const body = {
      chain_id:             form.chain_id.trim(),
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
      requires_ref_img:     form.requires_ref_img,
      intent:               splitCsv(form.intent),
      frequency:            form.frequency || null,
      cultural_constraints,
      saudi_adaptation:     form.saudi_adaptation || null,
      anti_patterns:        form.anti_patterns.split('\n').map((s) => s.trim()).filter(Boolean),
      cost_estimate_usd:    form.cost_estimate_usd ? parseFloat(form.cost_estimate_usd) : null,
      latency_estimate_s:   form.latency_estimate_s ? parseInt(form.latency_estimate_s, 10) : null,
      best_for_cd_brains:   splitCsv(form.best_for_cd_brains),
      provenance_source:    form.provenance_source || null,
      provenance_confirmer: form.provenance_confirmer || null,
      provenance_confidence: form.provenance_confidence,
      is_active:            form.is_active,
      notes:                form.notes || null,
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/chains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) { const d = await res.json().catch(() => ({})); setError((d as { error?: string }).error ?? `HTTP ${res.status}`); return }
        router.push(`/admin/chains/${form.chain_id.trim()}`)
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Chain Library"
        title="New Chain"
        subtitle="Add a new fal.ai creative chain to the library"
        action={<Link href="/admin/chains" className="text-xs text-(--fg-muted) hover:text-(--fg)">← Back to library</Link>}
      />

      <Section title="Identity">
        <Field label="Chain ID" required hint="snake_case, e.g. tf24_01_product_hero_flat">
          <input value={form.chain_id} onChange={(e) => set('chain_id', e.target.value.toLowerCase().replace(/\s+/g, '_'))} className={inputCls + ' font-mono'} placeholder="tf24_01_chain_name" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (English)" required><input value={form.name_en} onChange={(e) => set('name_en', e.target.value)} className={inputCls} /></Field>
          <Field label="Name (Arabic)" required><input value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} dir="rtl" className={inputCls} /></Field>
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
        <Field label="Purpose"><textarea value={form.purpose} onChange={(e) => set('purpose', e.target.value)} rows={2} className={inputCls} /></Field>
      </Section>

      <Section title="fal.ai Models">
        <Field label="Primary model" required hint="e.g. fal-ai/flux-pro/v1.1-ultra">
          <input value={form.fal_model_primary} onChange={(e) => set('fal_model_primary', e.target.value)} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Secondary model" hint="Kling for video chains — leave blank for image-only">
          <input value={form.fal_model_secondary} onChange={(e) => set('fal_model_secondary', e.target.value)} className={inputCls + ' font-mono text-xs'} placeholder="fal-ai/kling-video/v2.1-pro" />
        </Field>
      </Section>

      <Section title="Output Specification">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Width (px)"><input type="number" value={form.output_width} onChange={(e) => set('output_width', e.target.value)} className={inputCls} /></Field>
          <Field label="Height (px)"><input type="number" value={form.output_height} onChange={(e) => set('output_height', e.target.value)} className={inputCls} /></Field>
          <Field label="Duration (s)"><input type="number" value={form.output_duration_s} onChange={(e) => set('output_duration_s', e.target.value)} className={inputCls} /></Field>
          <Field label="Aspect ratio"><input value={form.aspect_ratio} onChange={(e) => set('aspect_ratio', e.target.value)} placeholder="1:1" className={inputCls} /></Field>
        </div>
      </Section>

      <Section title="Prompt Templates">
        <Field label="Prompt template" required hint="Use {{variable_name}} for dynamic slots">
          <textarea value={form.prompt_template} onChange={(e) => set('prompt_template', e.target.value)} rows={6} className={inputCls + ' font-mono text-xs'} placeholder="Professional brand photography. {{tone_descriptor}} atmosphere. No text." />
        </Field>
        <Field label="Negative prompt">
          <textarea value={form.negative_prompt} onChange={(e) => set('negative_prompt', e.target.value)} rows={2} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Video motion prompt" hint="Animation instruction for the image-to-video model (Kling/Seedance). Used when output is video.">
          <textarea value={form.video_motion_prompt} onChange={(e) => set('video_motion_prompt', e.target.value)} rows={2} className={inputCls + ' font-mono text-xs'} placeholder="Subtle camera dolly forward, gimbal-stabilized, 5 seconds" />
        </Field>
        <Field label="Input schema (JSON)" hint='{"required":["tone_descriptor"],"optional":["occasion_hint"]}'>
          <textarea value={form.input_schema} onChange={(e) => set('input_schema', e.target.value)} rows={6} className={inputCls + ' font-mono text-xs'} />
        </Field>
      </Section>

      <Section title="Eligibility">
        <Field label="Quality tiers" required>
          <div className="flex gap-3 flex-wrap">
            {QUALITY_TIERS.map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={(form.quality_tiers as string[]).includes(t)} onChange={() => toggleTier(t)} className="rounded border-(--border-default) accent-(--accent)" />
                <span className="text-sm text-(--fg-muted)">{t}</span>
              </label>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Eligible sectors" hint="Comma-separated. Empty = all."><input value={form.eligible_sectors} onChange={(e) => set('eligible_sectors', e.target.value)} placeholder="f_and_b, retail" className={inputCls} /></Field>
          <Field label="Excluded sectors"><input value={form.excluded_sectors} onChange={(e) => set('excluded_sectors', e.target.value)} className={inputCls} /></Field>
          <Field label="Eligible occasions" hint="Comma-separated. Empty = all."><input value={form.eligible_occasions} onChange={(e) => set('eligible_occasions', e.target.value)} className={inputCls} /></Field>
          <Field label="Excluded occasions"><input value={form.excluded_occasions} onChange={(e) => set('excluded_occasions', e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Min maturity (days)"><input type="number" value={form.min_maturity_days} onChange={(e) => set('min_maturity_days', e.target.value)} min={0} className={inputCls} /></Field>
          <Field label="Best for CD brains" hint="cd_01, cd_04"><input value={form.best_for_cd_brains} onChange={(e) => set('best_for_cd_brains', e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Intent" hint="Funnel stages: launch, grow, harvest (or 'all')"><input value={form.intent} onChange={(e) => set('intent', e.target.value)} placeholder="launch, grow, harvest" className={inputCls} /></Field>
          <Field label="Frequency" hint="Recommended cadence, e.g. '3-5 per week'"><input value={form.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="3-5 per week" className={inputCls} /></Field>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.requires_ref_img} onChange={(e) => set('requires_ref_img', e.target.checked)} className="h-4 w-4 rounded border-(--border-default) accent-(--accent)" />
          <span className="text-sm text-(--fg-muted)">Requires a reference image (product photo) to generate</span>
        </label>
      </Section>

      <Section title="Cultural Constraints (JSON)">
        <Field label="Cultural constraints">
          <textarea value={form.cultural_constraints} onChange={(e) => set('cultural_constraints', e.target.value)} rows={8} className={inputCls + ' font-mono text-xs'} />
        </Field>
        <Field label="Saudi adaptation" hint="Creative guidance for the Saudi market.">
          <textarea value={form.saudi_adaptation} onChange={(e) => set('saudi_adaptation', e.target.value)} rows={2} className={inputCls} />
        </Field>
      </Section>

      <Section title="Anti-Patterns">
        <Field label="Anti-patterns" hint="One per line">
          <textarea value={form.anti_patterns} onChange={(e) => set('anti_patterns', e.target.value)} rows={4} className={inputCls} placeholder="Do not use this for starter-tier brands..." />
        </Field>
      </Section>

      <Section title="Cost & Latency">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cost estimate (USD)"><input type="number" step="0.001" value={form.cost_estimate_usd} onChange={(e) => set('cost_estimate_usd', e.target.value)} className={inputCls} /></Field>
          <Field label="Latency estimate (s)"><input type="number" value={form.latency_estimate_s} onChange={(e) => set('latency_estimate_s', e.target.value)} className={inputCls} /></Field>
        </div>
      </Section>

      <Section title="Provenance">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source"><input value={form.provenance_source} onChange={(e) => set('provenance_source', e.target.value)} className={inputCls} /></Field>
          <Field label="Confirmer"><input value={form.provenance_confirmer} onChange={(e) => set('provenance_confirmer', e.target.value)} className={inputCls} /></Field>
          <Field label="Confidence">
            <select value={form.provenance_confidence} onChange={(e) => set('provenance_confidence', e.target.value)} className={inputCls}>
              {['experimental','inferred','confirmed'].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Lifecycle">
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inputCls} /></Field>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 rounded border-(--border-default) accent-(--accent)" />
          <span className="text-sm text-(--fg-muted)">Active — chain eligible immediately after creation</span>
        </label>
      </Section>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>
      )}

      <div className="flex justify-end gap-3 border-t border-(--border-subtle) pt-4">
        <Link href="/admin/chains" className="rounded-(--r-md) border border-(--border-default) px-4 py-2 text-sm text-(--fg-muted) hover:text-(--fg) transition-colors">
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isPending}
          className="rounded-(--r-md) bg-(--accent) px-5 py-2 text-sm font-medium text-(--accent-fg) hover:bg-(--accent-strong) transition-colors disabled:opacity-50"
        >
          {isPending ? 'Creating…' : 'Create chain'}
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-(--border-subtle) bg-(--surface-1) p-5 space-y-4">
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
