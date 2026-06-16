'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { approveAndGenerate } from './actions'

interface Props {
  slug: string
  brandId: string
  completenessScore: number
  enrichmentPct: number
  totalQuestions: number
  answeredCount: number
  requiredTotal: number
  requiredAnswered: number
}

// Animated counting number
function CountUp({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target === 0) return
    let current = 0
    const step = Math.max(1, Math.ceil(target / 30))
    const t = setInterval(() => {
      current = Math.min(current + step, target)
      setVal(current)
      if (current >= target) clearInterval(t)
    }, 25)
    return () => clearInterval(t)
  }, [target])
  return <>{val}{suffix}</>
}

// Radial progress ring
function Ring({ pct, size = 56, stroke = 3.5, color }: { pct: number; size?: number; stroke?: number; color: string }) {
  const r = (size - stroke * 2) / 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-(--surface-3)" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  )
}

// Journey step — shows the 3-step path with current position highlighted
function JourneySteps({ requiredDone, allDone }: { requiredDone: boolean; allDone: boolean }) {
  const steps = [
    { label: 'Answer required', done: requiredDone || allDone, active: !requiredDone && !allDone },
    { label: 'Boost with optional', done: allDone,             active: requiredDone && !allDone },
    { label: 'Approve & generate', done: false,                active: allDone                  },
  ]
  return (
    <div className="space-y-0">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-stretch gap-3">
          <div className="flex flex-col items-center" style={{ width: 20 }}>
            <div className={[
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition-all duration-500',
              s.done    ? 'border-emerald-500 bg-emerald-500 text-white'
              : s.active ? 'border-(--accent) bg-(--accent)/15 text-(--accent) animate-pulse'
              :            'border-(--border-subtle) bg-(--surface-2) text-(--fg-faint)',
            ].join(' ')}>
              {s.done ? '✓' : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={['w-px flex-1 my-0.5 transition-colors duration-700', s.done ? 'bg-emerald-500' : 'bg-(--border-subtle)'].join(' ')}
                style={{ minHeight: 16 }} />
            )}
          </div>
          <div className="pb-3 pt-0.5 min-w-0">
            <p className={['text-xs font-medium leading-none transition-colors duration-300',
              s.done ? 'text-emerald-400' : s.active ? 'text-(--fg)' : 'text-(--fg-faint)',
            ].join(' ')}>
              {s.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// What each answered question unlocks — shown as accumulating capability items
const CAPABILITY_THRESHOLDS = [
  { at: 10, icon: '🎯', text: 'Goal-aligned content mix'         },
  { at: 25, icon: '🗣️',  text: 'Authentic brand voice'            },
  { at: 40, icon: '📸', text: 'On-brand visual direction'         },
  { at: 55, icon: '🕌', text: 'Culturally precise occasions'      },
  { at: 70, icon: '💡', text: 'Competitor-aware positioning'      },
  { at: 85, icon: '⚡', text: 'Maximum AI creative autonomy'      },
]

function CapabilityUnlocks({ enrichmentPct }: { enrichmentPct: number }) {
  const unlocked = CAPABILITY_THRESHOLDS.filter((c) => enrichmentPct >= c.at)
  const next     = CAPABILITY_THRESHOLDS.find((c) => enrichmentPct < c.at)
  return (
    <div className="space-y-1.5">
      {CAPABILITY_THRESHOLDS.map((c) => {
        const isUnlocked = enrichmentPct >= c.at
        const isNext     = c === next
        return (
          <div key={c.text} className={[
            'flex items-center gap-2 text-xs transition-all duration-500',
            isUnlocked ? 'opacity-100' : isNext ? 'opacity-60' : 'opacity-25',
          ].join(' ')}>
            <span className={['w-3.5 text-center shrink-0 text-[11px]', isUnlocked ? '' : 'grayscale'].join(' ')}>
              {isUnlocked ? '✓' : isNext ? '○' : '·'}
            </span>
            <span className={isUnlocked ? 'text-(--fg)' : isNext ? 'text-(--fg-muted)' : 'text-(--fg-faint) line-through'}>
              {c.icon} {c.text}
            </span>
            {isNext && (
              <span className="ml-auto shrink-0 text-[10px] font-semibold text-(--accent)">
                +{c.at - enrichmentPct}%
              </span>
            )}
          </div>
        )
      })}
      {unlocked.length === CAPABILITY_THRESHOLDS.length && (
        <p className="text-[11px] text-emerald-400 font-semibold pt-0.5">🏆 All capabilities unlocked!</p>
      )}
    </div>
  )
}

export function InsightSidebar({
  slug, brandId, completenessScore, enrichmentPct,
  totalQuestions, answeredCount, requiredTotal, requiredAnswered,
}: Props) {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [approveState, setApproveState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [approveError, setApproveError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => { setMounted(true) }, [])

  function handleApprove() {
    if (!approveReady || approveState === 'loading' || approveState === 'done') return
    setApproveState('loading')
    setApproveError(null)
    startTransition(async () => {
      const result = await approveAndGenerate(brandId)
      if (!result.ok) {
        setApproveState('error')
        setApproveError(result.error ?? 'Something went wrong')
        return
      }
      setApproveState('done')
      // Redirect to processing/dashboard after short delay so user sees success
      setTimeout(() => router.push(`/${slug}/processing`), 1500)
    })
  }

  const requiredDone = requiredAnswered >= requiredTotal
  const allDone      = answeredCount >= totalQuestions
  const remaining    = totalQuestions - answeredCount
  const reqRemaining = requiredTotal - requiredAnswered

  // Approve button visibility — dims when required questions still pending
  const approveReady = requiredDone

  return (
    <aside className="w-64 xl:w-72 shrink-0 sticky top-[7.5rem] space-y-4 hidden lg:block">

      {/* ── Dual progress rings card ── */}
      <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1) p-4 space-y-4">
        <div className="flex items-center justify-around">
          {/* Enrichment ring */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative">
              <Ring pct={mounted ? enrichmentPct : 0} size={60} stroke={4} color="#6366f1" />
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-(--fg)">
                {mounted ? <CountUp target={enrichmentPct} suffix="%" /> : '0%'}
              </span>
            </div>
            <p className="text-[10px] uppercase tracking-wide text-(--fg-faint) font-semibold">Enrichment</p>
          </div>

          {/* Divider */}
          <div className="h-12 w-px bg-(--border-subtle)" />

          {/* BrandDNA ring */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative">
              <Ring
                pct={mounted ? completenessScore : 0}
                size={60} stroke={4}
                color={completenessScore >= 100 ? '#10b981' : completenessScore >= 75 ? '#84cc16' : '#f59e0b'}
              />
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-(--fg)">
                {mounted ? <CountUp target={completenessScore} suffix="%" /> : '0%'}
              </span>
            </div>
            <p className="text-[10px] uppercase tracking-wide text-(--fg-faint) font-semibold">BrandDNA</p>
          </div>
        </div>

        {/* Question count */}
        <div className="text-center">
          <p className="text-xs text-(--fg-muted)">
            <span className="font-semibold text-(--fg)">{answeredCount}</span> of <span className="font-semibold text-(--fg)">{totalQuestions}</span> questions answered
            {reqRemaining > 0 && (
              <span className="ml-1 text-amber-400 font-semibold">· {reqRemaining} required left</span>
            )}
          </p>
        </div>
      </div>

      {/* ── Journey steps ── */}
      <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1) px-4 py-4 space-y-3">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-(--fg-muted)">Your journey</p>
        <JourneySteps requiredDone={requiredDone} allDone={allDone} />
      </div>

      {/* ── What you're unlocking ── */}
      <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1) px-4 py-4 space-y-3">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-(--fg-muted)">What you're building</p>
        <CapabilityUnlocks enrichmentPct={enrichmentPct} />
      </div>

      {/* ── Approve & Generate CTA ── */}
      <div className={[
        'rounded-(--r-lg) border-2 p-4 space-y-3 transition-all duration-500',
        approveReady
          ? 'border-(--accent) bg-(--accent)/5 shadow-lg shadow-(--accent)/10'
          : 'border-(--border-subtle) bg-(--surface-1) opacity-70',
      ].join(' ')}>

        {/* Header */}
        <div className="flex items-start gap-2.5">
          <div className={[
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base transition-all duration-500',
            approveReady ? 'bg-(--accent)/15' : 'bg-(--surface-3)',
          ].join(' ')}>
            {approveReady ? '🚀' : '🔒'}
          </div>
          <div className="min-w-0">
            <p className={['text-sm font-bold transition-colors duration-300', approveReady ? 'text-(--fg)' : 'text-(--fg-muted)'].join(' ')}>
              {approveReady ? 'Ready to generate!' : 'Almost ready…'}
            </p>
            <p className="text-[11px] text-(--fg-muted) mt-0.5 leading-relaxed">
              {approveReady
                ? 'All required fields done. Review strategy then approve.'
                : `Answer ${reqRemaining} more required question${reqRemaining !== 1 ? 's' : ''} to unlock generation.`}
            </p>
          </div>
        </div>

        {/* Progress bar toward approval */}
        {!approveReady && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-(--surface-3) overflow-hidden">
              <div
                className="h-full rounded-full bg-(--accent) transition-all duration-700"
                style={{ width: `${Math.round((requiredAnswered / Math.max(requiredTotal, 1)) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-(--fg-faint) text-right tabular-nums">
              {requiredAnswered} / {requiredTotal} required
            </p>
          </div>
        )}

        {/* CTA button — fires webhook directly, no navigation */}
        <button
          type="button"
          onClick={handleApprove}
          disabled={!approveReady || approveState === 'loading' || approveState === 'done'}
          className={[
            'flex items-center justify-between w-full rounded-(--r-md) px-4 py-2.5 text-sm font-bold transition-all duration-300',
            approveState === 'done'
              ? 'bg-emerald-500 text-white cursor-default'
              : approveState === 'loading'
                ? 'bg-(--accent)/70 text-(--accent-fg) cursor-wait'
                : approveReady
                  ? 'bg-(--accent) text-(--accent-fg) hover:opacity-90 shadow-md shadow-(--accent)/20'
                  : 'bg-(--surface-3) text-(--fg-faint) cursor-not-allowed',
          ].join(' ')}
        >
          {approveState === 'done' ? (
            <>
              <span>✓ Calendar generating…</span>
              <span>🚀</span>
            </>
          ) : approveState === 'loading' ? (
            <>
              <span>Starting generation…</span>
              <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            </>
          ) : (
            <>
              <span>Approve &amp; Generate</span>
              <span className={approveReady ? 'animate-bounce' : ''}>→</span>
            </>
          )}
        </button>

        {/* Error message */}
        {approveState === 'error' && approveError && (
          <p className="text-[11px] text-red-400 text-center">{approveError}</p>
        )}

        {/* Strategy review link — secondary option */}
        {approveReady && approveState === 'idle' && (
          <p className="text-[10px] text-center text-(--fg-faint)">
            Or{' '}
            <Link href={`/${slug}/strategy-review`} className="text-(--accent) hover:underline font-medium">
              review strategy first
            </Link>
          </p>
        )}
      </div>

    </aside>
  )
}
