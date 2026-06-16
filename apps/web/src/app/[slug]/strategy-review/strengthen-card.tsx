'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface Props {
  slug: string
  insightMissingCount: number
  missingCriticalFields: Array<{ key: string; label: string }>
  completenessScore: number
}

const QUALITY_LEVELS = [
  { min: 0,   max: 49,  label: 'Weak',     color: 'text-red-400',    bar: 'bg-red-500',    hint: 'AI is guessing most decisions' },
  { min: 50,  max: 74,  label: 'Basic',    color: 'text-amber-400',  bar: 'bg-amber-500',  hint: 'Some context — still many gaps' },
  { min: 75,  max: 91,  label: 'Good',     color: 'text-yellow-400', bar: 'bg-yellow-500', hint: 'Most fields covered — nearly there' },
  { min: 92,  max: 99,  label: 'Strong',   color: 'text-lime-400',   bar: 'bg-lime-500',   hint: 'One field away from maximum power' },
  { min: 100, max: 100, label: 'Maximum',  color: 'text-emerald-400',bar: 'bg-emerald-500',hint: 'Full intelligence — best possible content' },
]

function getLevel(score: number) {
  return QUALITY_LEVELS.find((l) => score >= l.min && score <= l.max) ?? QUALITY_LEVELS[0]!
}

// Animated SVG arrow pointing down-right toward the button
function AnimatedArrow() {
  return (
    <svg
      viewBox="0 0 40 60"
      className="w-8 h-12 text-(--warning) animate-bounce"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 4 C20 4 20 40 20 44" />
      <path d="M12 36 L20 48 L28 36" />
    </svg>
  )
}

// Pulsing power bar
function PowerBar({ score, animated }: { score: number; animated: boolean }) {
  const [displayScore, setDisplayScore] = useState(0)
  const level = getLevel(score)

  useEffect(() => {
    if (!animated) { setDisplayScore(score); return }
    let start = 0
    const step = Math.ceil(score / 40)
    const timer = setInterval(() => {
      start = Math.min(start + step, score)
      setDisplayScore(start)
      if (start >= score) clearInterval(timer)
    }, 30)
    return () => clearInterval(timer)
  }, [score, animated])

  const pct = Math.min(displayScore, 100)

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className={`text-2xl font-bold tabular-nums ${level.color}`}>{displayScore}%</span>
        <span className={`text-xs font-semibold ${level.color}`}>{level.label}</span>
      </div>
      <div className="relative h-3 w-full rounded-full bg-(--surface-3) overflow-hidden">
        {/* Track segments */}
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            className="absolute top-0 bottom-0 w-px bg-(--surface-1)/60 z-10"
            style={{ left: `${tick}%` }}
          />
        ))}
        {/* Fill */}
        <div
          className={`h-full rounded-full transition-all duration-300 ${level.bar}`}
          style={{ width: `${pct}%` }}
        />
        {/* Shimmer */}
        {pct < 100 && (
          <div
            className="absolute inset-y-0 w-8 bg-white/20 skew-x-[-20deg] animate-[shimmer_2s_ease-in-out_infinite]"
            style={{ left: `${pct - 8}%` }}
          />
        )}
      </div>
      <p className="text-[11px] text-(--fg-muted)">{level.hint}</p>
    </div>
  )
}

// What richer BrandDNA unlocks — shown as locked/unlocked items
const UNLOCK_ITEMS = [
  { icon: '🎯', label: 'Hyper-targeted captions',         unlockAt: 75  },
  { icon: '🕌', label: 'Culturally precise Ramadan posts', unlockAt: 80  },
  { icon: '🎨', label: 'On-brand visual direction',        unlockAt: 85  },
  { icon: '📈', label: 'Competitor-aware strategy',        unlockAt: 90  },
  { icon: '⚡', label: 'Maximum AI creative autonomy',     unlockAt: 100 },
]

function UnlockList({ score }: { score: number }) {
  return (
    <div className="space-y-1.5">
      {UNLOCK_ITEMS.map((item) => {
        const unlocked = score >= item.unlockAt
        return (
          <div
            key={item.label}
            className={`flex items-center gap-2 text-xs transition-all duration-500 ${
              unlocked ? 'opacity-100' : 'opacity-40'
            }`}
          >
            <span className="w-4 shrink-0">{unlocked ? '✓' : '○'}</span>
            <span className={unlocked ? 'text-(--fg)' : 'text-(--fg-faint) line-through'}>{item.icon} {item.label}</span>
            {!unlocked && score >= item.unlockAt - 10 && (
              <span className="ml-auto text-[10px] font-semibold text-amber-400 shrink-0">
                +{item.unlockAt - score}% away
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Missing critical field chips — cycle through with a pulsing highlight
function MissingFieldChips({ fields }: { fields: Array<{ key: string; label: string }> }) {
  const [highlighted, setHighlighted] = useState(0)

  useEffect(() => {
    if (fields.length <= 1) return
    const t = setInterval(() => {
      setHighlighted((p) => (p + 1) % fields.length)
    }, 1200)
    return () => clearInterval(t)
  }, [fields.length])

  if (fields.length === 0) return null

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-red-400">
        {fields.length} critical field{fields.length !== 1 ? 's' : ''} missing
      </p>
      <div className="flex flex-wrap gap-1.5">
        {fields.map((f, i) => (
          <span
            key={f.key}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-500 ${
              i === highlighted
                ? 'border-red-500 bg-red-500/20 text-red-300 scale-105 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
                : 'border-red-500/30 bg-red-500/5 text-red-400/70'
            }`}
          >
            {i === highlighted && <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />}
            {f.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// Urgency copy — rotates between motivating messages
const URGENCY_LINES = [
  'Every missing field = the AI guessing instead of knowing.',
  'Brands that fill all fields get 40% more relevant captions.',
  'Your competitors are filling this. Will you?',
  'Takes 2 minutes. Saves months of off-brand content.',
  'The AI is only as good as what you tell it.',
]

function UrgencyCopy({ active }: { active: boolean }) {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!active) return
    const t = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIdx((p) => (p + 1) % URGENCY_LINES.length)
        setVisible(true)
      }, 400)
    }, 3500)
    return () => clearInterval(t)
  }, [active])

  if (!active) return null

  return (
    <p
      className={`text-[11px] text-amber-300/80 italic leading-relaxed transition-opacity duration-400 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      &ldquo;{URGENCY_LINES[idx]}&rdquo;
    </p>
  )
}

export function StrengthenCard({ slug, insightMissingCount, missingCriticalFields, completenessScore }: Props) {
  const [mounted, setMounted] = useState(false)
  const [showUnlocks, setShowUnlocks] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Show unlock list after 1.5s for a reveal effect
  useEffect(() => {
    const t = setTimeout(() => setShowUnlocks(true), 1500)
    return () => clearTimeout(t)
  }, [])

  const hasMissingCritical = missingCriticalFields.length > 0
  const hasInsightGaps     = insightMissingCount > 0
  const isIncomplete       = hasMissingCritical || hasInsightGaps
  const totalGaps          = missingCriticalFields.length + insightMissingCount

  if (!isIncomplete) {
    // Fully complete — show a calm success state
    return (
      <div className="rounded-(--r-lg) border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏆</span>
          <div>
            <p className="text-sm font-bold text-emerald-400">BrandDNA at Maximum Power</p>
            <p className="text-xs text-(--fg-muted)">All fields complete. AI has full context.</p>
          </div>
        </div>
        <PowerBar score={completenessScore} animated={mounted} />
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      className="rounded-(--r-lg) border-2 border-amber-500/50 bg-(--surface-1) overflow-hidden shadow-lg shadow-amber-500/10"
    >
      {/* Top urgency banner */}
      <div className="bg-amber-500/15 border-b border-amber-500/20 px-4 py-2.5 flex items-center gap-2 flex-nowrap">
        <span className="text-base animate-pulse shrink-0">⚡</span>
        <p className="text-xs font-bold text-amber-300 uppercase tracking-wider truncate min-w-0">
          Power up before generating
        </p>
        <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-amber-500/25 border border-amber-500/40 px-2.5 py-0.5 text-[11px] font-bold text-amber-300 leading-none flex items-center">
          {totalGaps}&nbsp;gap{totalGaps !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* Power bar */}
        <PowerBar score={completenessScore} animated={mounted} />

        {/* Rotating urgency copy */}
        <UrgencyCopy active={mounted} />

        {/* Missing critical fields */}
        {hasMissingCritical && (
          <MissingFieldChips fields={missingCriticalFields} />
        )}

        {/* What you unlock */}
        {showUnlocks && (
          <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) px-3 py-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-(--fg-muted)">
              What richer data unlocks
            </p>
            <UnlockList score={completenessScore} />
          </div>
        )}

        {/* CTA buttons */}
        <div className="space-y-2">
          {/* Primary — fill insight gaps */}
          {hasInsightGaps && (
            <Link
              href={`/${slug}/brand-insight`}
              className="group flex items-center justify-between w-full rounded-(--r-md) border-2 border-amber-500/60 bg-amber-500/10 px-4 py-2.5 text-sm font-bold text-amber-200 hover:bg-amber-500/20 hover:border-amber-500 transition-all duration-200"
            >
              <span className="flex items-center gap-2">
                <span className="text-base">✍️</span>
                Fill {insightMissingCount} Insight Field{insightMissingCount !== 1 ? 's' : ''}
              </span>
              <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
            </Link>
          )}

          {/* Secondary — fix critical fields */}
          {hasMissingCritical && (
            <Link
              href={`/${slug}/profile`}
              className="group flex items-center justify-between w-full rounded-(--r-md) border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 hover:border-red-500/60 transition-all duration-200"
            >
              <span className="flex items-center gap-2">
                <span>🔧</span>
                Fix {missingCriticalFields.length} Critical Field{missingCriticalFields.length !== 1 ? 's' : ''}
              </span>
              <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
            </Link>
          )}
        </div>

        {/* Animated arrow pointing down toward the approve button */}
        <div className="flex flex-col items-center pt-1 pb-0">
          <p className="text-[10px] text-(--fg-faint) mb-1 uppercase tracking-wide">or approve as-is</p>
          <AnimatedArrow />
        </div>

      </div>
    </div>
  )
}
