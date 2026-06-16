'use client'

import { useEffect, useState } from 'react'

/**
 * Minimal dependency-free toast system.
 *
 * `toast()` dispatches a window CustomEvent; `<Toaster />` listens and renders.
 * No context provider needed — calling `toast()` where no `<Toaster />` is
 * mounted is a safe no-op, so shared components can fire toasts freely.
 *
 *   import { Toaster, toast } from '@repo/ui/client/toast'
 *   toast.success('Saved')   // mount <Toaster /> once per page to display
 */

export type ToastTone = 'success' | 'error' | 'info'

interface ToastDetail {
  id: number
  tone: ToastTone
  message: string
  duration: number
}

const EVENT = 'ui:toast'

let seq = 0

function emit(tone: ToastTone, message: string, duration = 4000) {
  if (typeof window === 'undefined') return
  const detail: ToastDetail = { id: ++seq, tone, message, duration }
  window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT, { detail }))
}

export const toast = Object.assign(
  (message: string, duration?: number) => emit('info', message, duration),
  {
    success: (message: string, duration?: number) => emit('success', message, duration),
    error: (message: string, duration?: number) => emit('error', message, duration),
    info: (message: string, duration?: number) => emit('info', message, duration),
  },
)

const toneClass: Record<ToastTone, string> = {
  success: 'border-[rgba(34,197,94,0.3)] bg-(--success-soft) text-(--success)',
  error: 'border-[rgba(244,63,94,0.3)] bg-(--danger-soft) text-(--danger)',
  info: 'border-(--border-default) bg-(--surface-1) text-(--fg)',
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') {
    return (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (tone === 'error') {
    return (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

/**
 * Mount once per page (anywhere). Renders a fixed, dir-agnostic toast stack.
 * Centered at the bottom so it works for both LTR and RTL layouts.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastDetail[]>([])

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail
      setItems((prev) => [...prev, detail])
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== detail.id))
      }, detail.duration)
    }
    window.addEventListener(EVENT, onToast as EventListener)
    return () => window.removeEventListener(EVENT, onToast as EventListener)
  }, [])

  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-sm ${toneClass[t.tone]}`}
          style={{ animation: 'ui-toast-in 180ms ease-out' }}
        >
          <ToneIcon tone={t.tone} />
          <span className="min-w-0">{t.message}</span>
        </div>
      ))}
      <style>{`@keyframes ui-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
