'use client'

import { createContext, useContext, useState } from 'react'

interface RevisionCtx {
  activeCleanUrl: string | null
  setActiveCleanUrl: (url: string | null) => void
}

const Ctx = createContext<RevisionCtx>({ activeCleanUrl: null, setActiveCleanUrl: () => {} })

export function RevisionProvider({
  children,
  initialCleanUrl,
}: {
  children: React.ReactNode
  initialCleanUrl: string | null
}) {
  const [activeCleanUrl, setActiveCleanUrl] = useState<string | null>(initialCleanUrl)
  return <Ctx.Provider value={{ activeCleanUrl, setActiveCleanUrl }}>{children}</Ctx.Provider>
}

export function useRevision() {
  return useContext(Ctx)
}
