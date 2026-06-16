'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface MonthOption {
  iso: string
  label: string
  spend: number
  calls: number
  isCurrent: boolean
  isFuture: boolean
}

interface MonthPickerProps {
  options: MonthOption[]
  selected: string
  activeTab: string
}

const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function MonthPicker({ options, selected, activeTab }: MonthPickerProps) {
  const router   = useRouter()
  const [open, setOpen] = useState(false)
  const ref      = useRef<HTMLDivElement>(null)

  const year     = selected.split('-')[0]
  const selIdx   = parseInt(selected.split('-')[1], 10) - 1
  const selLabel = `${options[selIdx]?.label ?? SHORT[selIdx]} ${year}`

  // close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function pick(iso: string, isFuture: boolean) {
    if (isFuture) return
    setOpen(false)
    router.push(`/admin/cost?month=${iso}&tab=${activeTab}`)
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={[
          'flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold',
          'bg-(--surface-2) border-(--border-subtle) text-(--fg)',
          'hover:bg-(--surface-3) hover:border-(--accent)/60',
          'focus:outline-none focus:ring-2 focus:ring-(--accent)/40',
          'transition-all select-none',
          open ? 'border-(--accent)/60 bg-(--surface-3)' : '',
        ].join(' ')}
      >
        {/* Calendar icon */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-(--fg-muted) shrink-0">
          <rect x="1" y="2.5" width="12" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M1 5.5h12" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M4.5 1v3M9.5 1v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <rect x="3.5" y="7.5" width="2" height="2" rx="0.4" fill="currentColor" opacity="0.6"/>
          <rect x="6.5" y="7.5" width="2" height="2" rx="0.4" fill="currentColor" opacity="0.6"/>
        </svg>
        <span>{selLabel}</span>
        {/* chevron */}
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          className={`text-(--fg-muted) shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Popover */}
      {open && (
        <div className={[
          'absolute end-0 top-[calc(100%+6px)] z-50 w-72',
          'rounded-2xl border border-(--border-subtle) bg-(--surface-2)',
          'shadow-xl shadow-black/30 overflow-hidden',
          'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150',
        ].join(' ')}>
          {/* Popover header — year */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-(--border-subtle)">
            <span className="text-sm font-bold text-(--fg)">{year}</span>
            <span className="text-[10px] text-(--fg-faint) uppercase tracking-wider">Select Month</span>
          </div>

          {/* 4×3 month grid */}
          <div className="grid grid-cols-4 gap-1 p-3">
            {options.map((o, i) => {
              const isSelected = o.iso === selected
              const hasSpend   = o.spend > 0

              return (
                <button
                  key={o.iso}
                  disabled={o.isFuture}
                  onClick={() => pick(o.iso, o.isFuture)}
                  className={[
                    'relative flex flex-col items-center justify-center rounded-xl py-2.5 px-1 text-center transition-all',
                    isSelected
                      ? 'bg-(--accent) text-(--accent-fg) shadow-sm'
                      : o.isFuture
                      ? 'opacity-25 cursor-default'
                      : 'hover:bg-(--surface-3) cursor-pointer',
                  ].join(' ')}
                >
                  {/* Month name */}
                  <span className={[
                    'text-xs font-semibold leading-tight',
                    isSelected ? 'text-(--accent-fg)' : o.isCurrent ? 'text-(--accent)' : 'text-(--fg)',
                  ].join(' ')}>
                    {SHORT[i]}
                  </span>

                  {/* Spend amount or current dot */}
                  {o.isCurrent && !isSelected && (
                    <span className="mt-0.5 h-1 w-1 rounded-full bg-(--accent)" />
                  )}
                  {hasSpend && !o.isCurrent && (
                    <span className={[
                      'mt-0.5 text-[9px] font-mono leading-none',
                      isSelected ? 'text-(--accent-fg)/80' : 'text-(--fg-faint)',
                    ].join(' ')}>
                      ${o.spend < 10 ? o.spend.toFixed(2) : o.spend.toFixed(0)}
                    </span>
                  )}
                  {hasSpend && o.isCurrent && !isSelected && (
                    <span className="mt-0.5 text-[9px] font-mono text-(--accent) leading-none">
                      ${o.spend < 10 ? o.spend.toFixed(2) : o.spend.toFixed(0)}
                    </span>
                  )}
                  {!hasSpend && !o.isCurrent && !o.isFuture && (
                    <span className="mt-0.5 text-[9px] text-(--fg-faint) leading-none">—</span>
                  )}

                  {/* Spend intensity dot — bottom edge */}
                  {hasSpend && !isSelected && (() => {
                    const maxS = Math.max(...options.map(x => x.spend), 1)
                    const pct  = o.spend / maxS
                    const cls  = pct > 0.8 ? 'bg-red-400' : pct > 0.5 ? 'bg-amber-400' : 'bg-emerald-400'
                    return (
                      <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-0.5 w-4 rounded-full ${cls} opacity-70`} />
                    )
                  })()}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-t border-(--border-subtle) bg-(--surface-3)/50">
            <span className="text-[9px] text-(--fg-faint) uppercase tracking-wider">Spend</span>
            {[['Low','bg-emerald-400'],['High','bg-amber-400'],['Over','bg-red-400']].map(([l,c]) => (
              <div key={l} className="flex items-center gap-1">
                <span className={`h-1.5 w-3 rounded-full ${c} opacity-70`} />
                <span className="text-[9px] text-(--fg-faint)">{l}</span>
              </div>
            ))}
            <span className="ms-auto text-[9px] text-(--fg-faint)">Tap to filter</span>
          </div>
        </div>
      )}
    </div>
  )
}
