/**
 * BrandDirectionCard — renders the v2 creative-direction layer for one brand.
 *
 * Used by:
 *   • /[slug]/snapshot       — hero block
 *   • /[slug]/profile        — full breakdown
 *   • /admin/branddna/[id]   — ops debug view
 *
 * Pure presentational. Takes a `MethodProfileSummary | null` plus the brand's
 * archetype/lifecycle/intent (which live on brand_profiles, not the method
 * profile table) and renders the right shape for the current state.
 */
import type { ReactNode } from 'react'

export interface BrandDirectionCardProps {
  archetype_primary: string | null
  archetype_secondary: string | null
  lifecycle_stage: string | null
  intent_state: string | null
  method_profile: {
    voice_register: string
    diagnostic_pattern: string
    visual_idiom: string
    cadence_rule: string
    closing_pattern: string
    composition_blend: Record<string, string>
    composition_score: number
    creative_direction_text: string
  } | null
  archetype_blurb?: string
  /** When true, shows raw enum values + composition_blend JSON (admin debug view). */
  detailed?: boolean
  /** Optional title — defaults to "Creative direction". */
  title?: string
  className?: string
}

const COMPONENT_LABELS: Record<string, string> = {
  voice_register: 'Voice register',
  diagnostic_pattern: 'Opening pattern',
  visual_idiom: 'Visual idiom',
  cadence_rule: 'Cadence',
  closing_pattern: 'Closing pattern',
}

const COMPONENT_HELP: Record<string, string> = {
  voice_register: 'How the brand sounds across all captions.',
  diagnostic_pattern: 'How posts begin — the hook that pulls readers in.',
  visual_idiom: 'Imagery vocabulary — the look of generated visuals.',
  cadence_rule: 'How posts pace within a month.',
  closing_pattern: 'How posts end — the call-to-action style.',
}

export function BrandDirectionCard({
  archetype_primary,
  archetype_secondary,
  lifecycle_stage,
  intent_state,
  method_profile,
  archetype_blurb,
  detailed = false,
  title = 'Creative direction',
  className = '',
}: BrandDirectionCardProps) {
  // Empty state — onboarding still in flight or COO Pass 3 hasn't written yet
  if (!method_profile && !archetype_primary) {
    return (
      <div className={
        'rounded-(--r-md) border border-dashed border-(--border-subtle) ' +
        'bg-(--surface-3) p-5 text-center ' + className
      }>
        <h3 className="font-display text-base font-semibold text-(--fg)">{title}</h3>
        <p className="mt-2 text-sm text-(--fg-muted)">
          Your creative direction will appear here after onboarding finishes.
        </p>
      </div>
    )
  }

  return (
    <section className={
      'rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-5 ' + className
    }>
      <header className="mb-4 flex items-baseline justify-between">
        <h3 className="font-display text-base font-semibold text-(--fg)">{title}</h3>
        {method_profile && (
          <ScoreBadge score={method_profile.composition_score} />
        )}
      </header>

      {/* Three-axis summary chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip label="Archetype" value={formatArchetype(archetype_primary, archetype_secondary)} />
        <Chip label="Stage" value={formatLifecycle(lifecycle_stage)} />
        <Chip label="Intent" value={formatIntent(intent_state)} />
      </div>

      {archetype_blurb && (
        <p className="mb-4 text-sm italic text-(--fg-muted)">"{archetype_blurb}"</p>
      )}

      {/* Creative direction text — the prose brief */}
      {method_profile && method_profile.creative_direction_text && (
        <div className="mb-5 rounded-(--r-sm) bg-(--surface-3) p-4 text-sm leading-relaxed text-(--fg-subtle)" dir="auto">
          {method_profile.creative_direction_text}
        </div>
      )}

      {/* 5-component anatomy */}
      {method_profile && (
        <div className="space-y-3 border-t border-(--border-subtle) pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-(--fg-muted)">
            Method anatomy
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['voice_register', 'diagnostic_pattern', 'visual_idiom', 'cadence_rule', 'closing_pattern'] as const).map((slot) => {
              const value = method_profile[slot]
              const slotKey = slot === 'voice_register' ? 'voice'
                : slot === 'diagnostic_pattern' ? 'diagnostic'
                : slot === 'visual_idiom' ? 'visual'
                : slot === 'cadence_rule' ? 'cadence'
                : 'closing'
              const sourceMethod = method_profile.composition_blend[slotKey]
              return (
                <div key={slot} className="rounded-(--r-sm) bg-(--surface-3) px-3 py-2">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-(--fg-faint)">
                    {COMPONENT_LABELS[slot]}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-(--fg)">{formatPattern(value)}</span>
                    {sourceMethod && (
                      <span className="text-[10px] text-(--fg-muted)">via {sourceMethod}</span>
                    )}
                  </div>
                  {!detailed && (
                    <div className="mt-1 text-[11px] text-(--fg-muted)">{COMPONENT_HELP[slot]}</div>
                  )}
                </div>
              )
            })}
          </div>

          {detailed && (
            <pre className="mt-3 max-h-64 overflow-auto rounded-(--r-sm) bg-(--surface-1) p-3 text-[11px] text-(--fg-faint)">
{JSON.stringify(method_profile.composition_blend, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}

function Chip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-(--surface-3) px-3 py-1 text-xs">
      <span className="text-(--fg-faint)">{label}</span>
      <span className="font-medium text-(--fg)">{value}</span>
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 75 ? 'bg-(--success)/15 text-(--success)' :
    score >= 60 ? 'bg-(--warning)/15 text-(--warning)' :
    'bg-(--danger)/15 text-(--danger)'
  return (
    <span className={'rounded-full px-2.5 py-1 text-[11px] font-semibold ' + tone}>
      Composition {score}/100
    </span>
  )
}

function formatArchetype(primary: string | null, secondary: string | null): string {
  if (!primary) return '—'
  if (secondary) return `${primary} · ${secondary}`
  return primary
}

function formatIntent(intent: string | null): string {
  if (!intent) return '—'
  // Doc-canonical short verbs: launch / grow / defend / harvest / recover.
  // Capitalise for display.
  return intent.charAt(0).toUpperCase() + intent.slice(1)
}

function formatLifecycle(stage: string | null): string {
  if (!stage) return '—'
  // pre_launch → Pre-Launch; launch → Launch; etc.
  if (stage === 'pre_launch') return 'Pre-Launch'
  return stage.charAt(0).toUpperCase() + stage.slice(1)
}

function formatPattern(p: string): string {
  // intimate_humble → intimate humble
  return p.replace(/_/g, ' ')
}
