'use client'

import { useState, useTransition } from 'react'
import { releasePost, releaseAllForBrand } from './actions'

export function ReleasePostButton({ postId }: { postId: string }) {
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function handleRelease() {
    startTransition(async () => {
      const result = await releasePost(postId)
      if (result.ok) setDone(true)
    })
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Released
      </span>
    )
  }

  return (
    <button
      onClick={handleRelease}
      disabled={isPending}
      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:text-white transition-colors disabled:opacity-40"
    >
      {isPending ? (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      )}
      Release
    </button>
  )
}

export function ReleaseAllButton({ brandId, count }: { brandId: string; count: number }) {
  const [isPending, startTransition] = useTransition()
  const [released, setReleased] = useState<number | null>(null)

  function handleReleaseAll() {
    startTransition(async () => {
      const result = await releaseAllForBrand(brandId)
      if (result.ok) setReleased(result.count ?? 0)
    })
  }

  if (released !== null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        {released} posts released
      </span>
    )
  }

  return (
    <button
      onClick={handleReleaseAll}
      disabled={isPending}
      className="inline-flex items-center gap-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 px-3 py-1.5 text-xs font-semibold text-blue-400 hover:text-white transition-colors disabled:opacity-40"
    >
      {isPending ? (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : null}
      Release All ({count})
    </button>
  )
}
