'use client'

import { useState } from 'react'
import { toast } from '@repo/ui/client/toast'

export function DownloadButton({
  calendarId,
  slug,
  totalWithImages,
  label,
  startedLabel,
}: {
  calendarId: string
  slug: string
  totalWithImages: number
  label: string
  startedLabel?: string
}) {
  const [open, setOpen] = useState(false)

  function downloadAll() {
    setOpen(false)
    if (startedLabel) toast.info(startedLabel)
    window.location.href = `/api/calendar/${calendarId}/export-zip?slug=${slug}`
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex h-9 items-center gap-2 rounded-(--r-md) border border-(--border-default) bg-(--surface-2) px-4 text-sm font-medium text-(--fg) transition-colors duration-(--d-fast) hover:bg-(--surface-3)"
      >
        <DownloadIcon />
        {label}
        <ChevronIcon />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-52 rounded-(--r-lg) border border-(--border-default) bg-(--surface-1) shadow-xl overflow-hidden">
            <button
              onClick={downloadAll}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-(--fg) hover:bg-(--surface-2) transition-colors"
            >
              <DownloadIcon />
              <span>Download all ({totalWithImages})</span>
            </button>
            <div className="border-t border-(--border-subtle)" />
            <SelectModeButton calendarId={calendarId} slug={slug} onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  )
}

function SelectModeButton({
  calendarId,
  slug,
  onClose,
}: {
  calendarId: string
  slug: string
  onClose: () => void
}) {
  function enable() {
    onClose()
    window.dispatchEvent(new CustomEvent('calendar:select-mode', { detail: { calendarId, slug } }))
  }

  return (
    <button
      onClick={enable}
      className="flex w-full items-center gap-3 px-4 py-3 text-sm text-(--fg) hover:bg-(--surface-2) transition-colors"
    >
      <CheckboxIcon />
      <span>Select posts…</span>
    </button>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4 text-(--fg-muted) shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-(--fg-faint) shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function CheckboxIcon() {
  return (
    <svg className="h-4 w-4 text-(--fg-muted) shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}
