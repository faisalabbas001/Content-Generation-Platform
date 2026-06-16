'use client'

import { useEffect, useRef, useState, Fragment } from 'react'
import { Send, Sparkles, MessageSquarePlus, History } from 'lucide-react'
import { Card, CardBody } from '../card'
import { Badge } from '../badge'
import { cn } from '../cn'

export interface CopilotMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CopilotThreadSummary {
  thread_id: string
  title: string | null
  updated_at: string
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(text: string, key?: string | number): React.ReactNode {
  const segs = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/)
  return (
    <span key={key}>
      {segs.map((s, i) => {
        if (/^\*\*(.+)\*\*$/.test(s))
          return <strong key={i} className="font-semibold text-(--fg)">{s.slice(2, -2)}</strong>
        if (/^\*([^*]+)\*$/.test(s))
          return <em key={i} className="italic">{s.slice(1, -1)}</em>
        if (/^`([^`]+)`$/.test(s))
          return (
            <code key={i} className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-1.5 py-0.5 font-mono text-[0.85em] text-(--fg-subtle)">
              {s.slice(1, -1)}
            </code>
          )
        return s
      })}
    </span>
  )
}

// ─── Stat chips ───────────────────────────────────────────────────────────────
// Detects lines like "⏳ 22 pending · 🚨 0 escalated · ✅ 0 approved today"
// where each " · "-separated segment contains at least one digit.
function isStatLine(line: string): boolean {
  const parts = line.split(' · ')
  return parts.length >= 2 && parts.every((p) => /\d/.test(p.trim()))
}

function renderStatChips(line: string, key: string): React.ReactNode {
  return (
    <div key={key} className="my-1.5 flex flex-wrap gap-1.5">
      {line.split(' · ').map((part, i) => {
        // Split each segment into: prefix (emoji/symbol) + number + label
        const m = part.trim().match(/^(.*?)(\d[\d,.]*)(.*)$/)
        if (!m) return (
          <span key={i} className="inline-flex items-center rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-2.5 py-1 text-[11px] text-(--fg-muted)">
            {part.trim()}
          </span>
        )
        const [, pre, num, post] = m
        return (
          <span key={i} className="inline-flex items-center gap-1 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-2.5 py-1 text-[11px]">
            {pre.trim() && <span className="text-(--fg-subtle)">{pre.trim()}</span>}
            <span className="font-mono font-semibold text-(--fg)">{num}</span>
            {post.trim() && <span className="text-(--fg-muted)">{post.trim()}</span>}
          </span>
        )
      })}
    </div>
  )
}

const VERDICT_RE = /^[✅⚠️🔴🚨⚡💰🟡🔁⏳❌🏢📈📉🏷️🗣️☪️🤖]/u

function MarkdownMsg({ text }: { text: string }) {
  const nodes: React.ReactNode[] = []
  let firstPara = true

  const fenceParts = text.split(/(```[\s\S]*?```)/g)

  fenceParts.forEach((part, pi) => {
    if (/^```/.test(part)) {
      firstPara = false
      const inner = part.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
      nodes.push(
        <pre
          key={`f${pi}`}
          className="my-1.5 overflow-x-auto rounded-lg border border-(--border-subtle) bg-(--surface-4) p-3 font-mono text-[11px] leading-relaxed text-(--fg-muted) whitespace-pre-wrap break-all"
        >
          {inner}
        </pre>,
      )
      return
    }

    part.split(/\n{2,}/).forEach((para, paraI) => {
      if (!para.trim()) return

      const lines    = para.split('\n')
      const firstLine = lines[0]?.trim() ?? ''
      const nonEmpty  = lines.filter((l) => l.trim())

      const isSepRow   = (l: string) => /^[\s|:\-]+$/.test(l.trim()) && !/[a-zA-Z0-9]/.test(l)
      const isTable    = nonEmpty.length >= 2 && nonEmpty.every((l) => /^\|.+\|/.test(l.trim()))
      const isList     = lines.some((l) => /^\s*[-•]\s/.test(l) || /^\s*\d+\.\s/.test(l))
      const isStatRow  = !isList && isStatLine(firstLine)
      const isVerdict  = !isStatRow && firstPara && VERDICT_RE.test(firstLine)
      const isTip      = firstLine.startsWith('💡')

      firstPara = false

      if (isStatRow) {
        nodes.push(renderStatChips(firstLine, `sr${pi}${paraI}`))
        const rest = lines.slice(1).join('\n').trim()
        if (rest) {
          nodes.push(
            <p key={`srp${pi}${paraI}`} className="text-sm leading-relaxed text-(--fg-subtle)">
              {rest.split('\n').map((l, li) => (
                <span key={li}>{li > 0 && <br />}{renderInline(l, `l${li}`)}</span>
              ))}
            </p>,
          )
        }
      } else if (isTable) {
        const rows      = nonEmpty.filter((l) => !isSepRow(l))
        const [header, ...body] = rows
        const parseRow  = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim())
        nodes.push(
          <div key={`t${pi}${paraI}`} className="my-1.5 overflow-x-auto rounded-lg border border-(--border-subtle)">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {parseRow(header ?? '').map((h, hi) => (
                    <th
                      key={hi}
                      className="border-b border-(--border-subtle) bg-(--surface-3) px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-(--fg-muted) whitespace-nowrap"
                    >
                      {renderInline(h, hi)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 1 ? 'bg-(--surface-2)' : ''}>
                    {parseRow(row).map((cell, ci) => (
                      <td
                        key={ci}
                        className="border-b border-(--border-subtle)/50 px-2.5 py-1 text-(--fg-subtle) whitespace-nowrap last:border-b-0"
                      >
                        {renderInline(cell, ci)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
      } else if (isList) {
        const items: string[] = []
        lines.forEach((line) => {
          if (/^\s*[-•]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
            items.push(line.replace(/^\s*[-•]\s+/, '').replace(/^\s*\d+\.\s+/, ''))
          }
        })
        nodes.push(
          <ul key={`l${pi}${paraI}`} className="my-1 list-none space-y-1 pl-0">
            {items.map((item, li) => (
              <li key={li} className="flex items-start gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-(--fg-muted)/60" />
                {item.includes(' · ') ? (
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    {item.split(' · ').map((p, pi, arr) => (
                      <Fragment key={pi}>
                        {pi > 0 && (
                          <span className="select-none text-[10px] text-(--fg-faint)/50">·</span>
                        )}
                        <span className={
                          pi === 0
                            ? 'text-sm font-medium text-(--fg)'
                            : pi === arr.length - 1
                              ? 'text-[11px] text-(--fg-faint)'
                              : 'text-xs text-(--fg-muted)'
                        }>
                          {renderInline(p.trim(), pi)}
                        </span>
                      </Fragment>
                    ))}
                  </span>
                ) : (
                  <span className="flex-1 text-sm leading-relaxed">{renderInline(item, li)}</span>
                )}
              </li>
            ))}
          </ul>,
        )
      } else if (isVerdict) {
        nodes.push(
          <p key={`v${pi}${paraI}`} className="mb-2 text-sm font-semibold leading-snug text-(--fg)">
            {lines.map((l, li) => (
              <span key={li}>{li > 0 && <br />}{renderInline(l, `l${li}`)}</span>
            ))}
          </p>,
        )
      } else if (isTip) {
        nodes.push(
          <div
            key={`tip${pi}${paraI}`}
            className="my-1.5 rounded-r-lg border border-(--warning)/20 border-l-2 border-l-(--warning)/50 bg-(--warning)/10 px-3 py-2 text-[12px] leading-relaxed text-(--fg-subtle)"
          >
            {lines.map((l, li) => (
              <span key={li}>{li > 0 && <br />}{renderInline(l, `l${li}`)}</span>
            ))}
          </div>,
        )
      } else {
        nodes.push(
          <p key={`p${pi}${paraI}`} className="text-sm leading-relaxed text-(--fg-subtle)">
            {lines.map((l, li) => (
              <span key={li}>{li > 0 && <br />}{renderInline(l, `l${li}`)}</span>
            ))}
          </p>,
        )
      }
    })
  })

  return <div className="space-y-0.5">{nodes}</div>
}

// ─── Off-topic guard (same patterns as floating widget) ───────────────────────

const OFF_TOPIC_RE = [
  /^(hi|hello|hey|hiya|howdy|greetings|salaam|salam|مرحبا|أهلاً|اهلا)[\s!.,?]*$/i,
  /^how are you(\s+(doing|today))?[\s!.?,]*$/i,
  /^(good\s+(morning|afternoon|evening|night|day))[\s!.,?]*$/i,
  /^(what'?s\s+up|wassup|sup)[\s!.?,]*$/i,
  /^(thanks|thank you|thx|شكراً|شكرا)[\s!.,?]*$/i,
  /\b(biryani|recipe|cook(ing)?|restaurant|food|weather\s+forecast|joke|funny|stand.?up|movie|film|cricket|football|soccer|basketball|song|poem|lyrics|story|meme|tiktok)\b/i,
  /^(who|what)\s+(are|r)\s+(you|u|this)[\s?!.]*$/i,
  /^are\s+you\s+(an?\s+)?(ai|bot|robot|llm|gpt)[\s?!.]*$/i,
]
function isOffTopic(text: string): boolean {
  return OFF_TOPIC_RE.some((re) => re.test(text.trim()))
}

const ROLE_FALLBACK: Record<'management' | 'tech' | 'production', string> = {
  management:
    '🏢 I\'m scoped to business metrics only — brand portfolio, monthly spend, tier breakdown, and onboarding health.\n\nTry:\n- *How are we doing this month?*\n- *Which brands are stuck in onboarding?*\n- *What\'s our spend vs ceiling?*',
  tech:
    '🔧 I\'m scoped to infrastructure — n8n flow health, anomalies, usage logs, and routing decisions.\n\nTry:\n- *Are all n8n flows healthy?*\n- *Show the last 5 anomalies*\n- *What\'s Anthropic\'s error rate today?*',
  production:
    '⏳ I\'m scoped to the QA review queue and held posts only.\n\nTry:\n- *How many posts are pending review?*\n- *What\'s old in the queue?*\n- *Which brands have a high rejection rate?*',
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Copilot chat surface for the 3 admin roles.
 *
 * Connects to the SSE streaming endpoint at `apiPath` and renders tokens as
 * they arrive, including full markdown formatting (tables, lists, code blocks,
 * verdict openers, tip callouts).
 */
export function CopilotChat({
  role,
  roleLabel,
  intro,
  scopeNote,
  suggestions,
  initialMessages = [],
  initialThreadId = null,
  inputPlaceholder,
  apiPath,
  onLoadThread,
  onListThreads,
}: {
  role: 'management' | 'tech' | 'production'
  roleLabel: string
  intro: string
  scopeNote: string
  suggestions: string[]
  initialMessages?: CopilotMessage[]
  initialThreadId?: string | null
  inputPlaceholder: string
  /** POST endpoint — must return SSE (see /api/copilot/[role]/route.ts). */
  apiPath: string
  onLoadThread?: (threadId: string) => Promise<CopilotMessage[]>
  onListThreads?: () => Promise<CopilotThreadSummary[]>
}) {
  const [messages, setMessages]               = useState<CopilotMessage[]>(initialMessages)
  const [threadId, setThreadId]               = useState<string | null>(initialThreadId)
  const [threadList, setThreadList]           = useState<CopilotThreadSummary[] | null>(null)
  const [showHistory, setShowHistory]         = useState(false)
  const [draft, setDraft]                     = useState('')
  const [pending, setPending]                 = useState(false)
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [error, setError]                     = useState<string | null>(null)
  const [lastSentContent, setLastSentContent] = useState<string | null>(null)
  const scrollRef  = useRef<HTMLDivElement | null>(null)
  const abortRef   = useRef<AbortController | null>(null)
  const threadRef  = useRef<string | null>(initialThreadId)

  // Keep ref in sync so the async send closure always has the latest thread_id.
  useEffect(() => { threadRef.current = threadId }, [threadId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending, streamingContent])

  const send = (text: string) => {
    const content = text.trim()
    if (!content || pending) return

    // Off-topic guard — instant response, zero API cost.
    if (isOffTopic(content)) {
      setMessages((m) => [
        ...m,
        { role: 'user', content },
        { role: 'assistant', content: ROLE_FALLBACK[role] },
      ])
      setDraft('')
      return
    }

    setError(null)
    setLastSentContent(content)
    setMessages((m) => [...m, { role: 'user', content }])
    setDraft('')
    setPending(true)
    setStreamingContent(null)

    const controller = new AbortController()
    abortRef.current = controller

    void (async () => {
      let accText  = ''
      let resolved = false   // true once 'z' or 'e' event is processed
      try {
        const res = await fetch(apiPath, {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ message: content, thread_id: threadRef.current ?? undefined }),
          signal:  controller.signal,
        })

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
          const msg  = body?.message ?? body?.error ?? `Copilot failed (${res.status}).`
          setError(msg)
          return
        }

        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let   buf     = ''

        outer: while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''

          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data: ')) continue
            let data: { t: string; v?: string; i?: string; c?: number; m?: string }
            try { data = JSON.parse(line.slice(6)) as typeof data } catch { continue }

            if (data.t === 'd' && data.v) {
              accText += data.v
              setStreamingContent(accText)
            } else if (data.t === 'z') {
              resolved = true
              const finalText = accText
              // Use captured string — setThreadId triggers render, threadRef syncs via effect
              if (data.i) setThreadId(data.i)
              setMessages((m) => [...m, { role: 'assistant', content: finalText }])
              setStreamingContent(null)
              setLastSentContent(null)
              break outer
            } else if (data.t === 'e') {
              resolved = true
              setError(data.m ?? 'Something went wrong. Please try again.')
              setStreamingContent(null)
              break outer
            }
          }
        }

        // Stream closed (EOF) without a 'z' or 'e' event — server dropped the connection.
        if (!resolved) {
          setStreamingContent(null)
          setError('Response incomplete — please try again.')
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setStreamingContent(null)
        setError("Can't reach the server — check your connection and try again.")
      } finally {
        abortRef.current = null
        setPending(false)
      }
    })()
  }

  const newThread = () => {
    abortRef.current?.abort()
    setMessages([])
    setThreadId(null)
    setStreamingContent(null)
    setError(null)
    setPending(false)
    setLastSentContent(null)
  }

  const openHistory = async () => {
    setShowHistory((v) => !v)
    if (!showHistory && threadList === null && onListThreads) {
      try {
        setThreadList(await onListThreads())
      } catch {
        setThreadList([])
      }
    }
  }

  const switchThread = async (id: string) => {
    if (!onLoadThread || id === threadId) { setShowHistory(false); return }
    try {
      const msgs = await onLoadThread(id)
      setMessages(msgs)
      setThreadId(id)
      setShowHistory(false)
    } catch {
      setError('Failed to load thread.')
    }
  }

  const tone = role === 'management' ? 'accent' : role === 'tech' ? 'info' : 'warning'

  return (
    <Card className="flex h-[calc(100vh-12rem)] min-h-[480px] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-(--border-subtle) bg-(--surface-1) px-5 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--r-md) bg-(--accent-soft) text-(--accent)">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold text-(--fg)">{roleLabel}</div>
          <div className="truncate text-xs text-(--fg-muted)">{scopeNote}</div>
        </div>
        <Badge tone={tone} dot>{role}</Badge>
        {onListThreads && (
          <button
            type="button"
            onClick={openHistory}
            aria-label="History"
            className="inline-flex h-8 w-8 items-center justify-center rounded-(--r-md) text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)"
          >
            <History size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={newThread}
          aria-label="New thread"
          className="inline-flex h-8 w-8 items-center justify-center rounded-(--r-md) text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)"
        >
          <MessageSquarePlus size={16} />
        </button>
      </div>

      {/* History sidebar */}
      {showHistory && (
        <div className="border-b border-(--border-subtle) bg-(--surface-2) px-4 py-2 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium uppercase tracking-wider text-(--fg-muted)">Recent threads</span>
            <button type="button" onClick={() => setShowHistory(false)} className="text-(--fg-faint) hover:text-(--fg)">
              Close
            </button>
          </div>
          {threadList === null && <div className="py-2 text-(--fg-faint)">Loading…</div>}
          {threadList?.length === 0 && <div className="py-2 text-(--fg-faint)">No prior threads.</div>}
          {(threadList?.length ?? 0) > 0 && (
            <ul className="space-y-1">
              {threadList!.map((t) => (
                <li key={t.thread_id}>
                  <button
                    type="button"
                    onClick={() => void switchThread(t.thread_id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-(--r-sm) px-2 py-1.5 text-left hover:bg-(--surface-3)',
                      t.thread_id === threadId && 'bg-(--surface-3)',
                    )}
                  >
                    <span className="truncate text-(--fg-subtle)">{t.title ?? '(untitled)'}</span>
                    <span className="shrink-0 text-(--fg-faint)">
                      {new Date(t.updated_at).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !streamingContent && (
          <div className="space-y-4 py-6 text-center">
            <p className="mx-auto max-w-md text-sm leading-relaxed text-(--fg-muted)">{intro}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-(--border-default) bg-(--surface-3) px-3 py-1.5 text-xs text-(--fg-subtle) transition-colors duration-(--d-fast) ease-out hover:border-(--border-strong) hover:text-(--fg)"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[80%] rounded-(--r-lg) px-4 py-2.5 shadow-(--shadow-1)',
                m.role === 'user'
                  ? 'whitespace-pre-wrap bg-(--accent-soft) text-sm leading-relaxed text-(--fg)'
                  : 'bg-(--surface-3)',
              )}
              dir="auto"
            >
              {m.role === 'user' ? m.content : <MarkdownMsg text={m.content} />}
            </div>
          </div>
        ))}

        {/* Live streaming bubble */}
        {streamingContent !== null && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-(--r-lg) bg-(--surface-3) px-4 py-2.5 shadow-(--shadow-1)">
              <span className="whitespace-pre-wrap text-sm leading-relaxed text-(--fg-subtle)">
                {streamingContent}
                <span className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 bg-(--accent) opacity-90" />
              </span>
            </div>
          </div>
        )}

        {/* Typing dots — only until the first token arrives */}
        {pending && streamingContent === null && (
          <div className="flex justify-start">
            <div className="rounded-(--r-lg) bg-(--surface-3) px-4 py-2.5 text-sm text-(--fg-faint)">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--fg-faint) [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--fg-faint) [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--fg-faint)" />
              </span>
            </div>
          </div>
        )}

        {/* Error banner — separate from transcript, does not pollute thread history */}
        {error && !pending && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-(--r-lg) border border-(--danger)/20 bg-(--danger)/8 px-4 py-2.5">
              <p className="text-xs leading-relaxed text-(--danger)">{error}</p>
              {lastSentContent && (
                <button
                  type="button"
                  onClick={() => {
                    setMessages((m) => {
                      const last = m[m.length - 1]
                      return last?.role === 'user' ? m.slice(0, -1) : m
                    })
                    send(lastSentContent)
                  }}
                  className="mt-1.5 text-xs text-(--danger) underline hover:no-underline"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <CardBody className="border-t border-(--border-subtle) bg-(--surface-1) p-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); send(draft) }}
        >
          <textarea
            dir="auto"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={inputPlaceholder}
            disabled={pending}
            className="min-h-10 flex-1 resize-none rounded-(--r-md) border border-(--border-default) bg-(--surface-3) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:border-(--accent) focus:outline-none focus:ring-2 focus:ring-(--accent-soft) disabled:opacity-60"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft) }
            }}
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label="Send"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-(--r-md) bg-(--accent) text-(--accent-fg) transition-colors duration-(--d-fast) ease-out hover:bg-(--accent-strong) disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </form>
      </CardBody>
    </Card>
  )
}
