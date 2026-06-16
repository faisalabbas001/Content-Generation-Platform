import type { ReactNode } from 'react'

export function Hero({
  eyebrow,
  title,
  subtitle,
  actions,
  visual,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  visual?: ReactNode
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-(--border-subtle)">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-80"
        style={{
          background:
            'radial-gradient(800px 360px at 70% -10%, var(--accent-glow), transparent 60%), radial-gradient(700px 320px at 0% 100%, var(--pop-glow), transparent 60%)',
        }}
      />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:px-8 lg:py-24">
        <div className="space-y-5">
          {eyebrow && (
            <div className="inline-flex items-center gap-2 rounded-full border border-(--border-default) bg-(--surface-2) px-3 py-1 text-xs text-(--fg-subtle)">
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-4xl font-bold uppercase leading-[1.05] tracking-tight text-(--fg) sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          {subtitle && (
            <p className="max-w-xl text-base leading-relaxed text-(--fg-muted) sm:text-lg">
              {subtitle}
            </p>
          )}
          {actions && <div className="flex flex-wrap items-center gap-3 pt-2">{actions}</div>}
        </div>
        {visual && <div className="relative">{visual}</div>}
      </div>
    </section>
  )
}
