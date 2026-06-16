'use client'

import { useState } from 'react'

/**
 * Click-to-copy chip. Shows a check mark for 2 s after copy succeeds.
 * Gracefully ignores clipboard errors (no HTTPS, permission denied, etc.).
 */
export function CopyChip({
  value,
  display,
  title,
}: {
  value: string
  display?: string
  title?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* silently ignore — clipboard may be unavailable on http */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title ?? `Copy: ${value}`}
      className="inline-flex items-center gap-1 rounded-(--r-sm) bg-(--surface-4) px-1.5 py-0.5 font-mono text-[10px] text-(--fg-muted) transition-colors hover:bg-(--surface-3) hover:text-(--fg)"
    >
      {display ?? value}
      {copied ? (
        <svg className="h-2.5 w-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-label="Copied">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="h-2.5 w-2.5 text-(--fg-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="Copy">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
        </svg>
      )}
    </button>
  )
}
