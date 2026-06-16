'use client'

import { useState, useTransition } from 'react'
import { Check, X, Loader2 } from '@repo/ui/icons'
import { submitCorrection } from './actions'

interface CorrectionRowProps {
  fieldName: string
  slug: string
  strings: {
    correct: string
    placeholder: string
    submit: string
    cancel: string
    sent: string
  }
}

export function CorrectionRow({ fieldName, slug, strings }: CorrectionRowProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!text.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await submitCorrection(fieldName, text.trim(), slug)
      if (result.ok) {
        setSent(true)
        setText('')
      } else {
        setError(result.error ?? 'Something went wrong')
      }
    })
  }

  function handleCancel() {
    setOpen(false)
    setSent(false)
    setText('')
    setError(null)
  }

  if (sent) {
    return (
      <div className="flex items-center gap-1.5 rounded-(--r-sm) bg-(--success-soft) px-2.5 py-1.5 text-xs text-(--success)">
        <Check className="h-3 w-3 shrink-0" />
        {strings.sent}
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-(--r-sm) px-2.5 py-1 text-xs font-medium text-(--fg-muted) transition-colors hover:bg-(--surface-3) hover:text-(--fg)"
      >
        {strings.correct}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 w-full sm:w-72">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={strings.placeholder}
        rows={3}
        className="w-full resize-none rounded-(--r-md) border border-(--border-default) bg-(--surface-3) px-3 py-2 text-xs text-(--fg) placeholder:text-(--fg-faint) focus:border-(--accent)/50 focus:outline-none"
      />
      {error && (
        <p className="text-[11px] text-(--danger)">{error}</p>
      )}
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleSubmit}
          disabled={isPending || !text.trim()}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-(--r-sm) bg-(--accent) px-3 text-xs font-medium text-(--accent-fg) transition-colors hover:bg-(--accent-strong) disabled:pointer-events-none disabled:opacity-40"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {strings.submit}
        </button>
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-(--r-sm) border border-(--border-default) text-(--fg-muted) transition-colors hover:text-(--fg)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
