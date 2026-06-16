'use client'

import { CopilotChat, type CopilotMessage, type CopilotThreadSummary } from '@repo/ui/admin/copilot-chat'

/**
 * Client wrapper for a Copilot screen.
 *
 * Wires the networking callbacks the chat widget needs:
 *
 *   - apiPath       — POST /api/copilot/[role]  (SSE streaming)
 *   - onListThreads — GET  /api/copilot/threads?role=[role]
 *   - onLoadThread  — GET  /api/copilot/threads/[id]  → full transcript
 */
export function CopilotScreen({
  role,
  apiPath,
  texts,
}: {
  role: 'management' | 'tech' | 'production'
  apiPath: string
  texts: {
    eyebrow: string
    title: string
    intro: string
    scopeNote: string
    suggestions: string[]
    placeholder: string
  }
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <div className="text-xs uppercase tracking-[0.2em] text-(--fg-muted)">{texts.eyebrow}</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg)">{texts.title}</h1>
        <p className="text-sm text-(--fg-muted)">{texts.intro}</p>
      </header>

      <CopilotChat
        role={role}
        roleLabel={texts.title}
        intro={texts.intro}
        scopeNote={texts.scopeNote}
        suggestions={texts.suggestions}
        inputPlaceholder={texts.placeholder}
        initialMessages={[] as CopilotMessage[]}
        apiPath={apiPath}
        onListThreads={async () => {
          const res = await fetch(`/api/copilot/threads?role=${role}`)
          if (!res.ok) return [] as CopilotThreadSummary[]
          const json = (await res.json()) as { threads: CopilotThreadSummary[] }
          return json.threads
        }}
        onLoadThread={async (threadId) => {
          const res = await fetch(`/api/copilot/threads/${threadId}`)
          if (!res.ok) return [] as CopilotMessage[]
          const json = (await res.json()) as {
            messages: Array<{ role: 'user' | 'assistant'; content: string }>
          }
          return json.messages.map((m) => ({ role: m.role, content: m.content }))
        }}
      />
    </div>
  )
}
