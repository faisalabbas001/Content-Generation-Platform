'use client'

/**
 * On-demand single-post form (UI only, N8N-A02 not yet wired).
 *
 * Field set is sourced verbatim from the Tech Doc:
 *   §3.2 — DeepSeek inputs: month, posts_per_week, occasion_context
 *   §3.2 — Output metadata:  posting_time, content_type, hashtags
 *   §3.3 — N8N-V01 router:   objective, image model, first_ever_post
 *   §6.2 — visual_brief:     style_descriptor, color_palette, platform_specs (canvas)
 *
 * Note: `cost_constraint` is intentionally NOT a user input. Per Doc §6.1
 * (CEO Functions Reference) it is "Read only — no write" — derived by the
 * CEO from current_month_spend, not selected by the client.
 *   §9.2 — Image-gen call:   visual_style, hero_concept, negative_prompt, cultural_guidance, canvas
 *   §9.2 — Sharp overlay:    brand_name_ar (Hard Rule #3 — Arabic NEVER in image prompts)
 *
 * Hard Rule #3: every prompt textarea is dir="ltr" with English-only
 * placeholders. Arabic is composited post-generation by Sharp via the
 * `overlay_brand_name_ar` toggle.
 */

import { useState, useTransition } from 'react'
import { Button } from '@repo/ui/button'
import { Field, Input, Select, Textarea } from '@repo/ui/input'
import { Sparkles } from '@repo/ui/icons'
import { triggerOnDemandPost } from './actions'

export interface OnDemandFormStrings {
  rule: string
  submit: string
  footer: string
  brief: {
    contentType: string
    contentTypeOptions: Record<'lifestyle' | 'offer' | 'educational' | 'testimonial' | 'announcement', string>
    objective: string
    objectiveOptions: Record<'awareness' | 'engagement' | 'conversion' | 'cultural' | 'trust', string>
    platform: string
    postingTime: string
    month: string
    monthPlaceholder: string
    postsPerWeek: string
    occasionName: string
    occasionNamePlaceholder: string
    occasionLeadWeeks: string
    occasionPriority: string
    occasionPriorityOptions: Record<'Critical' | 'High' | 'Medium' | 'Low' | 'Not_relevant', string>
    hashtags: string
    hashtagsPlaceholder: string
  }
  visual: {
    title: string
    description: string
    styleDescriptor: string
    styleDescriptorPlaceholder: string
    heroConcept: string
    heroConceptPlaceholder: string
    negativePrompt: string
    negativePromptPlaceholder: string
    culturalGuidance: string
    culturalGuidancePlaceholder: string
    canvas: string
    canvasOptions: Record<'ig_square' | 'ig_portrait' | 'ig_story' | 'snap', string>
    colorPalette: string
    colorPalettePlaceholder: string
  }
  controls: {
    title: string
    description: string
    imageModel: string
    imageModelOptions: Record<'auto' | 'nano_banana' | 'flux_ultra', string>
    firstEverPost: string
    firstEverPostHint: string
    overlayBrandName: string
    overlayBrandNameHint: string
  }
  platformOptions: Record<'Instagram' | 'Snapchat' | 'TikTok' | 'Twitter', string>
}

interface Props {
  strings: OnDemandFormStrings
  defaultPlatform: string | null
  defaultColorHex: string | null
  slug: string
}

const CONTENT_TYPES = ['lifestyle', 'offer', 'educational', 'testimonial', 'announcement'] as const
const OBJECTIVES = ['awareness', 'engagement', 'conversion', 'cultural', 'trust'] as const
const PLATFORMS = ['Instagram', 'Snapchat', 'TikTok', 'Twitter'] as const
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low', 'Not_relevant'] as const
const CANVASES = ['ig_square', 'ig_portrait', 'ig_story', 'snap'] as const
const IMAGE_MODELS = ['auto', 'nano_banana', 'flux_ultra'] as const

export function OnDemandForm({ strings, defaultPlatform, defaultColorHex, slug }: Props) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const s = strings

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await triggerOnDemandPost(formData, slug)
      setResult(res)
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ─── Section: Post brief ───────────────────────────────── */}
      <section className="grid gap-5 sm:grid-cols-2">
        <Field label={s.brief.contentType} required>
          <Select name="content_type" defaultValue="lifestyle" dir="auto">
            {CONTENT_TYPES.map((c) => (
              <option key={c} value={c}>{s.brief.contentTypeOptions[c]}</option>
            ))}
          </Select>
        </Field>

        <Field label={s.brief.objective} required>
          <Select name="objective" defaultValue="cultural" dir="auto">
            {OBJECTIVES.map((o) => (
              <option key={o} value={o}>{s.brief.objectiveOptions[o]}</option>
            ))}
          </Select>
        </Field>

        <Field label={s.brief.platform} required>
          <Select
            name="platform"
            defaultValue={defaultPlatform ?? 'Instagram'}
            dir="ltr"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{s.platformOptions[p]}</option>
            ))}
          </Select>
        </Field>

        <Field label={s.brief.postingTime} required>
          <Input name="posting_time" type="datetime-local" dir="ltr" />
        </Field>

        {/* DeepSeek inputs per Doc §3.2 line 352:
            CaptionContext + month + posts_per_week + occasion_context */}
        <Field label={s.brief.month} required>
          <Input
            name="month"
            type="month"
            dir="ltr"
            placeholder={s.brief.monthPlaceholder}
          />
        </Field>

        <Field label={s.brief.postsPerWeek}>
          <Input
            name="posts_per_week"
            type="number"
            min={1}
            max={7}
            defaultValue={1}
            dir="ltr"
          />
        </Field>

        <Field label={s.brief.occasionName}>
          <Input
            name="occasion_name"
            dir="auto"
            placeholder={s.brief.occasionNamePlaceholder}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={s.brief.occasionLeadWeeks}>
            <Input
              name="occasion_lead_weeks"
              type="number"
              min={0}
              max={12}
              defaultValue={0}
              dir="ltr"
            />
          </Field>
          <Field label={s.brief.occasionPriority}>
            <Select name="occasion_priority" defaultValue="Medium" dir="auto">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{s.brief.occasionPriorityOptions[p]}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label={s.brief.hashtags}>
            <Input
              name="hashtags"
              dir="auto"
              placeholder={s.brief.hashtagsPlaceholder}
            />
          </Field>
        </div>
      </section>

      <div className="border-t border-(--border-subtle)" />

      {/* ─── Section: Visual brief (English only) ──────────────── */}
      <section>
        <header className="mb-4">
          <h3 className="font-display text-sm font-semibold tracking-tight text-(--fg)">
            {s.visual.title}
          </h3>
          <p className="text-xs text-(--fg-muted)">{s.visual.description}</p>
        </header>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={s.visual.styleDescriptor} required>
              <Textarea
                name="style_descriptor"
                dir="ltr"
                placeholder={s.visual.styleDescriptorPlaceholder}
                required
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label={s.visual.heroConcept} required>
              <Textarea
                name="hero_concept"
                dir="ltr"
                placeholder={s.visual.heroConceptPlaceholder}
                required
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label={s.visual.negativePrompt}>
              <Textarea
                name="negative_prompt"
                dir="ltr"
                placeholder={s.visual.negativePromptPlaceholder}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label={s.visual.culturalGuidance}>
              <Textarea
                name="cultural_guidance"
                dir="ltr"
                placeholder={s.visual.culturalGuidancePlaceholder}
              />
            </Field>
          </div>

          <Field label={s.visual.canvas} required>
            <Select name="canvas" defaultValue="ig_square" dir="ltr">
              {CANVASES.map((c) => (
                <option key={c} value={c}>{s.visual.canvasOptions[c]}</option>
              ))}
            </Select>
          </Field>

          <Field label={s.visual.colorPalette}>
            <Input
              name="color_palette"
              dir="ltr"
              defaultValue={defaultColorHex ?? ''}
              placeholder={s.visual.colorPalettePlaceholder}
              pattern="^\s*(#[0-9A-Fa-f]{6})(\s*,\s*#[0-9A-Fa-f]{6})*\s*$"
            />
          </Field>
        </div>
      </section>

      <div className="border-t border-(--border-subtle)" />

      {/* ─── Section: Generation controls ───────────────────────── */}
      <section>
        <header className="mb-4">
          <h3 className="font-display text-sm font-semibold tracking-tight text-(--fg)">
            {s.controls.title}
          </h3>
          <p className="text-xs text-(--fg-muted)">{s.controls.description}</p>
        </header>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={s.controls.imageModel}>
              <Select name="image_model" defaultValue="auto" dir="ltr">
                {IMAGE_MODELS.map((m) => (
                  <option key={m} value={m}>{s.controls.imageModelOptions[m]}</option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="sm:col-span-2 flex items-start gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-4 py-3 cursor-pointer transition-colors duration-(--d-fast) hover:border-(--border-default)">
            <input
              type="checkbox"
              name="first_ever_post"
              className="mt-0.5 h-4 w-4 accent-(--accent)"
            />
            <span className="flex-1 text-sm text-(--fg)">
              {s.controls.firstEverPost}
              <span className="mt-0.5 block text-xs text-(--fg-muted)">
                {s.controls.firstEverPostHint}
              </span>
            </span>
          </label>

          <label className="sm:col-span-2 flex items-start gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-4 py-3 cursor-pointer transition-colors duration-(--d-fast) hover:border-(--border-default)">
            <input
              type="checkbox"
              name="overlay_brand_name_ar"
              defaultChecked
              className="mt-0.5 h-4 w-4 accent-(--accent)"
            />
            <span className="flex-1 text-sm text-(--fg)">
              {s.controls.overlayBrandName}
              <span className="mt-0.5 block text-xs text-(--fg-muted)">
                {s.controls.overlayBrandNameHint}
              </span>
            </span>
          </label>
        </div>
      </section>

      {result && (
        <div
          role="status"
          className={`rounded-(--r-sm) border px-3 py-2 text-sm ${
            result.ok
              ? 'border-(--accent)/30 bg-(--accent)/10 text-(--accent)'
              : 'border-red-300/40 bg-red-50/60 text-red-700'
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-(--border-subtle) pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-(--fg-muted)">{s.rule}</p>
        <Button type="submit" size="lg" leadingIcon={<Sparkles size={16} />} disabled={isPending}>
          {isPending ? '…' : s.submit}
        </Button>
      </div>
    </form>
  )
}
