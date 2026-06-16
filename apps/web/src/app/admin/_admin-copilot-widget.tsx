'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Send, X, Sparkles, MessageSquarePlus, Maximize2, Minimize2, Clock, ChevronLeft } from '@repo/ui/icons'

// Module-level singleton — prevents "Multiple GoTrueClient instances" warning
// and ensures Realtime channel is shared across React re-renders.
let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  })
  return _supabase
}

type Role = 'management' | 'tech' | 'production'

// ── Anomaly → copilot routing map (mirrors S03 workflow logic) ────────────────
const ANOMALY_COPILOT_MAP: Record<string, Role> = {
  cost_spike_detected:       'management',
  cost_ceiling_alert:        'management',
  upgrade_readiness_report:  'management',
  namespace_breach_attempt:  'tech',
  cco_systematic_failure:    'production',
  fal_api_unavailable:       'tech',
  deepseek_call_failed:      'tech',
  pii_in_anonymous_signal:   'tech',
  arabic_qa_regression:      'production',
  ceo_call_failed:           'tech',
  coo_call_failed:           'tech',
  n8n_failure:               'tech',
  n8n_trigger_failed:        'tech',
  quality_regression:        'production',
}

function anomalyToRole(anomalyType: string, targetCopilot?: string | null): Role {
  if (targetCopilot === 'management' || targetCopilot === 'tech' || targetCopilot === 'production')
    return targetCopilot
  return ANOMALY_COPILOT_MAP[anomalyType] ?? 'tech'
}

function severityEmoji(severity: string): string {
  if (severity === 'critical' || severity === 'error') return '🚨'
  if (severity === 'warning') return '⚠️'
  return '🟡'
}

function formatAlertMessage(row: {
  anomaly_id: string
  anomaly_type: string
  severity: string
  details: Record<string, unknown>
}): string {
  const d = row.details ?? {}
  const sourceFlow  = d.source_flow  as string | undefined
  const message     = d.message      as string | undefined
  const reasoning   = d.reasoning    as string | undefined
  const humanGate   = d.human_gate   as boolean | undefined
  const isBlocked   = d.is_blocked   as boolean | undefined

  const lines: string[] = [
    `${severityEmoji(row.severity)} **New Anomaly** — \`${row.anomaly_type}\``,
    `- **severity:** ${row.severity.toUpperCase()}`,
    sourceFlow ? `- **source_flow:** \`${sourceFlow}\`` : '',
    message    ? `- **message:** ${message}` : '',
    humanGate  ? `- **human_gate:** yes — review required` : '',
    isBlocked  ? `- **blocked:** yes` : '',
    reasoning && reasoning !== 'initial_record' ? `- **reasoning:** ${reasoning}` : '',
    `- **anomaly_id:** \`${row.anomaly_id}\``,
    '',
    `💡 Review in [\`/admin/anomalies\`](/admin/anomalies) and resolve when handled.`,
  ].filter(l => l !== undefined && (l !== '' || true))

  return lines.filter(Boolean).join('\n')
}

interface CopilotMsg {
  role: 'user' | 'assistant'
  content: string
  cost_usd?: number  // assistant messages only
}

interface CopilotThread {
  thread_id: string
  role: Role
  title: string | null
  created_at: string
  updated_at: string
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)      return 'just now'
  if (s < 3600)    return `${Math.floor(s / 60)}m ago`
  if (s < 86400)   return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

interface RoleState {
  messages: CopilotMsg[]
  threadId: string | null
  error: string | null
  lastSentContent: string | null  // preserved for retry
  streamingContent: string | null // live text accumulating during SSE stream
}

export interface AdminCopilotWidgetTexts {
  placeholder: string
  scopeManagement: string
  scopeTech: string
  scopeProduction: string
  introManagement: string
  introTech: string
  introProduction: string
  navManagement: string
  navTech: string
  navProduction: string
  suggestionsManagementA: string
  suggestionsManagementB: string
  suggestionsManagementC: string
  suggestionsTechA: string
  suggestionsTechB: string
  suggestionsTechC: string
  suggestionsProductionA: string
  suggestionsProductionB: string
  suggestionsProductionC: string
  statusOnline: string
  subtitleInternal: string
  newThread: string
  thinking: string
  sessionExpired: string
}

// ─── Tiny markdown renderer ───────────────────────────────────────────────────

function renderInline(text: string, key?: string | number): React.ReactNode {
  const segments = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/)
  return (
    <span key={key}>
      {segments.map((seg, i) => {
        if (/^\*\*(.+)\*\*$/.test(seg))
          return <strong key={i} style={{ color: '#fafafa', fontWeight: 600 }}>{seg.slice(2, -2)}</strong>
        if (/^\*([^*]+)\*$/.test(seg))
          return <em key={i} style={{ opacity: 0.85 }}>{seg.slice(1, -1)}</em>
        if (/^`([^`]+)`$/.test(seg))
          return (
            <code key={i} style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '11px',
              background: 'rgba(0,0,0,0.5)',
              color: '#10b981',
              padding: '1px 5px',
              borderRadius: '4px',
              border: '1px solid rgba(16,185,129,0.2)',
            }}>
              {seg.slice(1, -1)}
            </code>
          )
        return seg
      })}
    </span>
  )
}

// Emoji set that signals a verdict/status opener line
const VERDICT_EMOJI_RE = /^[✅⚠️🔴🚨⚡💰🟡🔁⏳❌🏢📈📉🏷️🗣️☪️🤖]/u

function MsgContent({ text }: { text: string }) {
  const nodes: React.ReactNode[] = []
  let firstContent = true   // first non-empty paragraph gets verdict styling

  const fenceParts = text.split(/(```[\s\S]*?```)/g)

  fenceParts.forEach((part, pi) => {
    if (/^```([\s\S]*)```$/.test(part)) {
      firstContent = false
      const inner = part.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
      nodes.push(
        <pre key={`fence-${pi}`} style={{
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '10px 12px',
          marginTop: '6px',
          marginBottom: '6px',
          overflowX: 'auto',
          fontSize: '11px',
          lineHeight: 1.6,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          color: '#a1a1aa',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {inner}
        </pre>
      )
      return
    }

    const paragraphs = part.split(/\n{2,}/)

    paragraphs.forEach((para, paraI) => {
      if (!para.trim()) return

      const lines      = para.split('\n')
      const firstLine  = lines[0]?.trim() ?? ''
      const nonEmpty   = lines.filter((l) => l.trim())

      // ── Block-type detection ──────────────────────────────────────
      const isSepRow    = (l: string) => /^[\s|:\-]+$/.test(l.trim()) && !/[a-zA-Z0-9]/.test(l)
      const isTableBlock = nonEmpty.length >= 2 && nonEmpty.every((l) => /^\|.+\|/.test(l.trim()))
      const isListBlock  = lines.some((l) => /^\s*[-•·]\s/.test(l) || /^\s*\d+\.\s/.test(l))
      const isVerdict    = firstContent && VERDICT_EMOJI_RE.test(firstLine)
      const isTip        = firstLine.startsWith('💡')

      firstContent = false   // only the very first paragraph can be a verdict

      // ── Render: table ─────────────────────────────────────────────
      if (isTableBlock) {
        const tableRows = nonEmpty.filter((l) => !isSepRow(l))
        const [headerLine, ...bodyLines] = tableRows
        const parseRow = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim())
        const headers = parseRow(headerLine)
        const rows    = bodyLines.map(parseRow)
        nodes.push(
          <div key={`tbl-${pi}-${paraI}`} style={{ overflowX: 'auto', margin: '6px 0', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', lineHeight: 1.5 }}>
              <thead>
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi} style={{
                      padding: '7px 10px', textAlign: 'left',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#a1a1aa', fontWeight: 600,
                      borderBottom: '1px solid rgba(255,255,255,0.09)',
                      whiteSpace: 'nowrap', fontSize: '10.5px',
                    }}>{renderInline(h, hi)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: '5px 10px', color: '#d4d4d8',
                        borderBottom: ri < rows.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                        whiteSpace: 'nowrap', fontSize: '11px',
                      }}>{renderInline(cell, ci)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      // ── Render: bullet list ───────────────────────────────────────
      } else if (isListBlock) {
        const listItems: string[] = []
        let prose = ''

        lines.forEach((line) => {
          if (/^\s*[-•·]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
            if (prose) {
              nodes.push(
                <p key={`${pi}-${paraI}-prose`} style={{ marginBottom: '4px' }}>
                  {renderInline(prose)}
                </p>
              )
              prose = ''
            }
            listItems.push(line.replace(/^\s*[-•·]\s+/, '').replace(/^\s*\d+\.\s+/, ''))
          } else {
            prose += (prose ? ' ' : '') + line
          }
        })

        if (listItems.length > 0) {
          nodes.push(
            <ul key={`list-${pi}-${paraI}`} style={{ listStyle: 'none', padding: 0, margin: '6px 0' }}>
              {listItems.map((item, li) => (
                <li key={li} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '5px', lineHeight: 1.65 }}>
                  <span style={{
                    flexShrink: 0, marginTop: '7px',
                    width: '4px', height: '4px', borderRadius: '50%',
                    background: 'rgba(161,161,170,0.65)',
                  }} />
                  <span style={{ flex: 1 }}>{renderInline(item, li)}</span>
                </li>
              ))}
            </ul>
          )
        }

        if (prose) {
          nodes.push(
            <p key={`${pi}-${paraI}-prose-end`} style={{ marginBottom: '4px' }}>
              {renderInline(prose)}
            </p>
          )
        }

      // ── Render: verdict header (first line, starts with status emoji) ──
      } else if (isVerdict) {
        const lineNodes: React.ReactNode[] = []
        lines.forEach((line, li) => {
          if (li > 0) lineNodes.push(<br key={`br-${li}`} />)
          lineNodes.push(renderInline(line, `line-${li}`))
        })
        nodes.push(
          <p key={`verdict-${pi}-${paraI}`} style={{
            fontSize: '13px', fontWeight: 600, color: '#fafafa',
            lineHeight: 1.55, marginBottom: '8px',
          }}>
            {lineNodes}
          </p>
        )

      // ── Render: 💡 suggestion callout ────────────────────────────
      } else if (isTip) {
        const lineNodes: React.ReactNode[] = []
        lines.forEach((line, li) => {
          if (li > 0) lineNodes.push(<br key={`br-${li}`} />)
          lineNodes.push(renderInline(line, `line-${li}`))
        })
        nodes.push(
          <div key={`tip-${pi}-${paraI}`} style={{
            background: 'rgba(251,191,36,0.07)',
            border: '1px solid rgba(251,191,36,0.15)',
            borderLeft: '3px solid rgba(251,191,36,0.45)',
            borderRadius: '0 8px 8px 0',
            padding: '8px 12px',
            marginTop: '6px',
            marginBottom: '2px',
            fontSize: '12px',
            lineHeight: 1.65,
            color: '#d4d4d8',
          }}>
            {lineNodes}
          </div>
        )

      // ── Render: regular paragraph ─────────────────────────────────
      } else {
        const lineNodes: React.ReactNode[] = []
        lines.forEach((line, li) => {
          if (li > 0) lineNodes.push(<br key={`br-${li}`} />)
          lineNodes.push(renderInline(line, `line-${li}`))
        })
        nodes.push(
          <p key={`para-${pi}-${paraI}`} style={{ marginBottom: paragraphs.length > 1 ? '6px' : '0' }}>
            {lineNodes}
          </p>
        )
      }
    })
  })

  return (
    <div style={{ lineHeight: 1.65, fontSize: '12.5px', color: '#d4d4d8' }}>
      {nodes}
    </div>
  )
}

// ─── Role config ──────────────────────────────────────────────────────────────

const ROLE_META = {
  management: {
    short: 'Management',
    dotColor: '#10b981',
    tabBorderColor: '#10b981',
    tabTextColor: '#10b981',
  },
  tech: {
    short: 'Tech',
    dotColor: '#38bdf8',
    tabBorderColor: '#38bdf8',
    tabTextColor: '#38bdf8',
  },
  production: {
    short: 'Production',
    dotColor: '#f59e0b',
    tabBorderColor: '#f59e0b',
    tabTextColor: '#f59e0b',
  },
} as const

const EMPTY: RoleState = { messages: [], threadId: null, error: null, lastSentContent: null, streamingContent: null }

// ─── Off-topic guard ──────────────────────────────────────────────────────────
// Catches clearly irrelevant messages (greetings, food questions, etc.) and
// returns a scoped fallback instantly — zero API calls, zero cost.

const OFF_TOPIC_RE = [
  // Pure greetings
  /^(hi|hello|hey|hiya|howdy|greetings|salaam|salam|مرحبا|أهلاً|اهلا)[\s!.,?]*$/i,
  /^how are you(\s+(doing|today))?[\s!.?,]*$/i,
  /^(good\s+(morning|afternoon|evening|night|day))[\s!.,?]*$/i,
  /^(what'?s\s+up|wassup|sup)[\s!.?,]*$/i,
  /^(thanks|thank you|thx|شكراً|شكرا)[\s!.,?]*$/i,
  // Unrelated topics — specific enough to avoid false positives
  /\b(biryani|recipe|cook(ing)?|restaurant|food|weather\s+forecast|joke|funny|stand.?up|movie|film|cricket|football|soccer|basketball|song|poem|lyrics|story|meme|tiktok)\b/i,
  // "What/who are you" questions
  /^(who|what)\s+(are|r)\s+(you|u|this)[\s?!.]*$/i,
  /^are\s+you\s+(an?\s+)?(ai|bot|robot|llm|gpt)[\s?!.]*$/i,
]

function isOffTopic(text: string): boolean {
  return OFF_TOPIC_RE.some((re) => re.test(text.trim()))
}

const LOADING_STEPS: Record<Role, string[]> = {
  management: [
    'Searching database…',
    'Reading brand metrics…',
    'Analyzing KPIs…',
    'Generating insights…',
  ],
  tech: [
    'Searching database…',
    'Scanning n8n flows…',
    'Analyzing usage logs…',
    'Preparing report…',
  ],
  production: [
    'Searching database…',
    'Fetching review queue…',
    'Analyzing held posts…',
    'Preparing summary…',
  ],
}

const ROLE_FALLBACK: Record<Role, string> = {
  management:
    '🏢 I\'m scoped to business metrics only — brand portfolio, monthly spend, tier breakdown, and onboarding health.\n\nI can\'t help with that. Try:\n- *How are we doing this month?*\n- *Which brands are stuck in onboarding?*\n- *What\'s our spend vs ceiling?*',
  tech:
    '🔧 I\'m scoped to infrastructure — n8n flow health, anomalies, usage logs, and routing decisions.\n\nI can\'t help with that. Try:\n- *Are all n8n flows healthy?*\n- *Show the last 5 anomalies*\n- *What\'s Anthropic\'s error rate today?*',
  production:
    '⏳ I\'m scoped to the QA review queue and held posts only.\n\nI can\'t help with that. Try:\n- *How many posts are pending review?*\n- *What\'s old in the queue?*\n- *Which brands have a high rejection rate?*',
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export function AdminCopilotWidget({ texts }: { texts: AdminCopilotWidgetTexts }) {
  const [open, setOpen]             = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [activeRole, setActiveRole] = useState<Role>('management')
  const [states, setStates]         = useState<Record<Role, RoleState>>({
    management: { ...EMPTY },
    tech:       { ...EMPTY },
    production: { ...EMPTY },
  })
  const [draft, setDraft]             = useState('')
  const [pendingRole, setPendingRole] = useState<Role | null>(null)

  // ── Realtime: unread alert counts per copilot tab ─────────────────────────
  const [unread, setUnread] = useState<Record<Role, number>>({ management: 0, tech: 0, production: 0 })
  const [hasCritical, setHasCritical] = useState(false)
  const totalUnread = unread.management + unread.tech + unread.production
  const realtimeRef = useRef<RealtimeChannel | null>(null)
  const openRef     = useRef(false)
  const activeRoleRef = useRef<Role>('management')

  useEffect(() => { openRef.current = open }, [open])
  useEffect(() => { activeRoleRef.current = activeRole }, [activeRole])

  const injectAlert = useCallback((role: Role, row: {
    anomaly_id: string; anomaly_type: string; severity: string; details: Record<string, unknown>
  }) => {
    const alertMsg = formatAlertMessage(row)
    setStates(s => ({
      ...s,
      [role]: {
        ...s[role],
        messages: [...s[role].messages, { role: 'assistant' as const, content: alertMsg }],
      },
    }))
  }, [])

  // Subscribe to anomaly_records changes on mount — pure WebSocket, no polling
  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return

    const channel = supabase
      .channel('admin-copilot-anomalies')
      .on(
        'postgres_changes',
        // Listen to both INSERT and UPDATE so we catch:
        // - INSERT: when ignoreDuplicates=true path fires
        // - UPDATE: when CEO-enriched upsert overwrites the initial_record row
        { event: '*', schema: 'public', table: 'anomaly_records' },
        (payload) => {
          if (payload.eventType === 'DELETE') return
          const row = payload.new as {
            anomaly_id: string
            anomaly_type: string
            severity: string
            details: Record<string, unknown>
          }
          // Skip initial_record callbacks — wait for the enriched CEO row
          const details = row.details ?? {}
          if ((details.reasoning as string) === 'initial_record') return

          const role = anomalyToRole(row.anomaly_type, details.target_copilot as string | null)
          const isCrit = row.severity === 'critical' || row.severity === 'error'

          // Inject alert message into the correct copilot tab
          injectAlert(role, row)

          // If the widget is open AND on that tab, don't count as unread
          if (openRef.current && activeRoleRef.current === role) return

          setUnread(u => ({ ...u, [role]: u[role] + 1 }))
          if (isCrit) setHasCritical(true)
        },
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[copilot-realtime] subscribed to anomaly_records')
        if (status === 'CHANNEL_ERROR') console.error('[copilot-realtime] channel error:', err)
        if (status === 'TIMED_OUT') console.warn('[copilot-realtime] subscription timed out')
      })

    realtimeRef.current = channel
    return () => { void supabase.removeChannel(channel); realtimeRef.current = null }
  }, [injectAlert])

  // Clear unread count for the active tab when the widget opens or tab switches
  useEffect(() => {
    if (!open) return
    setUnread(u => ({ ...u, [activeRole]: 0 }))
    // Recompute hasCritical after clearing
    setHasCritical(false)
  }, [open, activeRole])

  const scrollRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // AbortController for the in-flight fetch — cancelled when the widget closes
  const abortRef    = useRef<AbortController | null>(null)

  const isPending    = pendingRole === activeRole
  const current      = states[activeRole]
  const meta         = ROLE_META[activeRole]

  const [loadingStep, setLoadingStep] = useState(0)

  const [showHistory, setShowHistory]     = useState(false)
  const [threadsByRole, setThreadsByRole] = useState<Record<Role, CopilotThread[] | null>>({
    management: null, tech: null, production: null,
  })
  const [threadsLoading, setThreadsLoading] = useState(false)

  // Cycle through realistic loading step labels while waiting for first token
  useEffect(() => {
    if (!isPending || current.streamingContent !== null) {
      setLoadingStep(0)
      return
    }
    setLoadingStep(0)
    const steps = LOADING_STEPS[activeRole]
    let i = 1
    const id = setInterval(() => {
      setLoadingStep(i)
      i++
      if (i >= steps.length) clearInterval(id)
    }, 1800)
    return () => clearInterval(id)
  }, [isPending, current.streamingContent, activeRole])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [states, pendingRole, activeRole])

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => textareaRef.current?.focus(), 150)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setFullscreen(false)
      setShowHistory(false)
      // Cancel any in-flight request so we don't update state after unmount
      abortRef.current?.abort()
    }
  }, [open])

  // Auto-fetch thread list when history panel opens (lazy, per role)
  useEffect(() => {
    if (!showHistory || threadsByRole[activeRole] !== null) return
    setThreadsLoading(true)
    void fetch(`/api/copilot/threads?role=${activeRole}`)
      .then((r) => r.ok ? r.json() : null)
      .then((json: { threads: CopilotThread[] } | null) => {
        if (json) setThreadsByRole((prev) => ({ ...prev, [activeRole]: json.threads }))
      })
      .finally(() => setThreadsLoading(false))
  }, [showHistory, activeRole])

  const patch = (role: Role, update: Partial<RoleState>) =>
    setStates((s) => ({ ...s, [role]: { ...s[role], ...update } }))

  // Core send — accepts an optional base messages array so retry can pass a
  // trimmed list without a state-update round-trip.
  const send = (text: string, baseMessages?: CopilotMsg[]) => {
    const content = text.trim()
    if (!content || pendingRole !== null) return

    const role    = activeRole
    const msgBase = baseMessages ?? states[role].messages

    setDraft('')

    // Off-topic guard — respond instantly without calling the API.
    if (isOffTopic(content)) {
      patch(role, {
        messages: [
          ...msgBase,
          { role: 'user', content },
          { role: 'assistant', content: ROLE_FALLBACK[role] },
        ],
        error: null,
        lastSentContent: null,
        streamingContent: null,
      })
      return
    }

    const currentThreadId = states[role].threadId

    patch(role, {
      messages: [...msgBase, { role: 'user', content }],
      error: null,
      lastSentContent: content,
      streamingContent: null,
    })
    setPendingRole(role)

    const controller = new AbortController()
    abortRef.current = controller

    // ── SSE streaming fetch ──────────────────────────────────────────────
    void (async () => {
      let accText  = ''
      let resolved = false   // true once 'z' or 'e' event is processed
      try {
        const res = await fetch(`/api/copilot/${role}`, {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ message: content, thread_id: currentThreadId ?? undefined }),
          signal:  controller.signal,
        })

        // Pre-stream errors return plain JSON (auth, rate-limit, bad body).
        if (res.status === 401) { patch(role, { streamingContent: null, error: texts.sessionExpired }); return }
        if (res.status === 429) { patch(role, { streamingContent: null, error: 'Too many requests — please wait a moment before trying again.' }); return }
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null
          const msg  = body?.message ?? `Something went wrong (${res.status}). Please try again.`
          patch(role, { streamingContent: null, error: msg })
          return
        }

        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let   buf     = ''

        outer: while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          // Split on double-newline (SSE event boundary).
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''

          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data: ')) continue
            let data: { t: string; v?: string; i?: string; c?: number; m?: string }
            try { data = JSON.parse(line.slice(6)) as typeof data } catch { continue }

            if (data.t === 'd' && data.v) {
              accText += data.v
              patch(role, { streamingContent: accText })
            } else if (data.t === 'z') {
              resolved = true
              // Stream done — move accumulated text into completed messages.
              setStates((s) => ({
                ...s,
                [role]: {
                  ...s[role],
                  messages: [
                    ...s[role].messages,
                    { role: 'assistant' as const, content: accText, cost_usd: data.c },
                  ],
                  threadId:         data.i ?? s[role].threadId,
                  streamingContent: null,
                  lastSentContent:  null,
                  error:            null,
                },
              }))
              // Invalidate cached thread list so history shows the new thread
              setThreadsByRole((prev) => ({ ...prev, [role]: null }))
              break outer
            } else if (data.t === 'e') {
              resolved = true
              patch(role, { streamingContent: null, error: data.m ?? 'Something went wrong. Please try again.' })
              break outer
            }
          }
        }

        // Stream closed (EOF) without a 'z' or 'e' event — server dropped the connection.
        if (!resolved) {
          patch(role, { streamingContent: null, error: 'Response incomplete — please try again.' })
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        const raw = e instanceof Error ? e.message : ''
        const msg =
          raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('Load failed')
            ? "Can't reach the server — check your connection and try again."
            : 'Something went wrong. Please try again.'
        patch(role, { streamingContent: null, error: msg })
      } finally {
        abortRef.current = null
        setPendingRole(null)
      }
    })()
  }

  // Retry the last failed message: pop the dangling user bubble, re-send.
  const retry = () => {
    const content = current.lastSentContent
    if (!content || pendingRole !== null) return
    const base = current.messages.at(-1)?.role === 'user'
      ? current.messages.slice(0, -1)
      : current.messages
    patch(activeRole, { error: null, lastSentContent: null })
    send(content, base)
  }

  // Load a previous thread's full transcript into the active role state.
  const loadThread = (threadId: string) => {
    void fetch(`/api/copilot/threads/${threadId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((json: { messages: Array<{ role: 'user' | 'assistant'; content: string; cost_usd?: number }> } | null) => {
        if (!json) return
        patch(activeRole, {
          messages: json.messages.map((m) => ({ role: m.role, content: m.content, cost_usd: m.cost_usd })),
          threadId,
          error: null,
          lastSentContent: null,
          streamingContent: null,
        })
        setShowHistory(false)
      })
  }

  const ROLES = [
    {
      id: 'management' as Role,
      scope: texts.scopeManagement,
      intro: texts.introManagement,
      suggestions: [texts.suggestionsManagementA, texts.suggestionsManagementB, texts.suggestionsManagementC] as [string, string, string],
    },
    {
      id: 'tech' as Role,
      scope: texts.scopeTech,
      intro: texts.introTech,
      suggestions: [texts.suggestionsTechA, texts.suggestionsTechB, texts.suggestionsTechC] as [string, string, string],
    },
    {
      id: 'production' as Role,
      scope: texts.scopeProduction,
      intro: texts.introProduction,
      suggestions: [texts.suggestionsProductionA, texts.suggestionsProductionB, texts.suggestionsProductionC] as [string, string, string],
    },
  ]

  const activeConfig = ROLES.find((r) => r.id === activeRole)!

  const panelProps: PanelProps = {
    fullscreen, activeRole, meta, ROLES, activeConfig,
    current, isPending, draft, placeholder: texts.placeholder,
    texts, scrollRef, textareaRef, unread,
    setActiveRole, setOpen, setFullscreen, patch, send, retry, setDraft,
    loadingStep,
    showHistory, setShowHistory,
    threads: threadsByRole[activeRole],
    threadsLoading,
    loadThread,
  }

  return (
    <>
      {/* ── Floating trigger ── */}
      <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
        {open && !fullscreen && <Panel {...panelProps} />}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close Admin Copilot' : 'Open Admin Copilot'}
            style={{
              width: 56, height: 56,
              borderRadius: '50%',
              background: hasCritical && !open
                ? 'linear-gradient(135deg, #ef4444, #b91c1c)'
                : 'linear-gradient(135deg, #10b981, #059669)',
              boxShadow: hasCritical && !open
                ? '0 4px 20px rgba(239,68,68,0.6), 0 1px 4px rgba(0,0,0,0.4)'
                : '0 4px 20px rgba(16,185,129,0.5), 0 1px 4px rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: hasCritical && !open ? '#fff' : '#022c22',
              border: 'none', cursor: 'pointer',
              transition: 'transform 0.18s, box-shadow 0.18s, background 0.3s',
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {/* Critical pulse ring — red when there are critical unread alerts */}
            {!open && hasCritical && (
              <span style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: '#ef4444', opacity: 0.35,
                animation: 'oc-ping 1.2s cubic-bezier(0,0,0.2,1) infinite',
              }} />
            )}
            {/* Normal idle ping ring — green when no critical alerts */}
            {!open && !hasCritical && (
              <span style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: '#10b981', opacity: 0.2,
                animation: 'oc-ping 2s cubic-bezier(0,0,0.2,1) infinite',
              }} />
            )}
            {/* Unread count badge on the button */}
            {!open && totalUnread > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 18, height: 18,
                borderRadius: '999px',
                background: hasCritical ? '#ef4444' : '#f59e0b',
                border: '2px solid #0d0d10',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '9px', fontWeight: 700, color: '#fff',
                lineHeight: 1,
              }}>
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
            {open ? <X size={20} /> : <Sparkles size={22} />}
          </button>
        </div>
      </div>

      {/* ── Fullscreen panel + backdrop ── */}
      {open && fullscreen && (
        <>
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 58,
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={() => setFullscreen(false)}
          />
          <Panel {...panelProps} />
        </>
      )}
    </>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface PanelProps {
  fullscreen: boolean
  activeRole: Role
  meta: typeof ROLE_META[Role]
  ROLES: Array<{ id: Role; scope: string; intro: string; suggestions: [string, string, string] }>
  activeConfig: { id: Role; scope: string; intro: string; suggestions: [string, string, string] }
  current: RoleState
  isPending: boolean
  draft: string
  placeholder: string
  texts: AdminCopilotWidgetTexts
  scrollRef: React.RefObject<HTMLDivElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  unread: Record<Role, number>
  setActiveRole: (r: Role) => void
  setOpen: (v: boolean) => void
  setFullscreen: (v: boolean | ((p: boolean) => boolean)) => void
  patch: (role: Role, update: Partial<RoleState>) => void
  send: (text: string, baseMessages?: CopilotMsg[]) => void
  retry: () => void
  setDraft: (v: string) => void
  loadingStep: number
  showHistory: boolean
  threads: CopilotThread[] | null
  threadsLoading: boolean
  setShowHistory: (v: boolean | ((p: boolean) => boolean)) => void
  loadThread: (threadId: string) => void
}

function Panel({
  fullscreen, activeRole, meta, ROLES, activeConfig,
  current, isPending, draft, placeholder, texts,
  scrollRef, textareaRef, unread,
  setActiveRole, setOpen, setFullscreen, patch, send, retry, setDraft,
  loadingStep,
  showHistory, setShowHistory, threads, threadsLoading, loadThread,
}: PanelProps) {

  const charCount   = draft.length
  const charWarning = charCount > 3000

  const panelStyle: React.CSSProperties = fullscreen
    ? {
        position: 'fixed',
        inset: '12px',
        zIndex: 59,
        borderRadius: '20px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#0d0d10',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(16,185,129,0.12)',
        animation: 'oc-widget-in 0.22s cubic-bezier(0.16,1,0.3,1)',
      }
    : {
        width: 'min(400px, calc(100vw - 2rem))',
        height: 'min(600px, calc(100vh - 6rem))',
        borderRadius: '20px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#0d0d10',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(16,185,129,0.12)',
        animation: 'oc-widget-in 0.22s cubic-bezier(0.16,1,0.3,1)',
        marginBottom: '4px',
      }

  return (
    <div style={panelStyle}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '12px 16px',
        background: 'linear-gradient(to bottom, #141418, #111114)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '10px', flexShrink: 0,
          background: 'linear-gradient(135deg, #10b981, #059669)',
          boxShadow: '0 2px 10px rgba(16,185,129,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display, system-ui)', fontWeight: 700,
          fontSize: '14px', color: '#022c22',
        }}>O</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 600, fontSize: '13px', color: '#fafafa' }}>Admin Copilot</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
              <span style={{ fontSize: '10px', color: '#10b981' }}>{texts.statusOnline}</span>
            </span>
          </div>
          <div style={{ fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#52525b', marginTop: '1px' }}>
            {texts.subtitleInternal}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          style={{
            width: 28, height: 28, borderRadius: '7px', border: 'none',
            background: 'transparent', color: '#52525b', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#a1a1aa' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#52525b' }}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          style={{
            width: 28, height: 28, borderRadius: '7px', border: 'none',
            background: 'transparent', color: '#52525b', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#fafafa' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#52525b' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Role tabs ── */}
      <div style={{
        display: 'flex', background: '#111114',
        borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
      }}>
        {ROLES.map((r) => {
          const m   = ROLE_META[r.id]
          const act = r.id === activeRole
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveRole(r.id)}
              style={{
                flex: 1, padding: '10px 4px', border: 'none',
                background: 'transparent', cursor: 'pointer',
                fontSize: '11.5px', fontWeight: 500,
                color: act ? m.tabTextColor : '#71717a',
                borderBottom: `2px solid ${act ? m.tabBorderColor : 'transparent'}`,
                transition: 'color 0.12s, border-color 0.12s',
                position: 'relative',
              }}
              onMouseEnter={(e) => { if (!act) e.currentTarget.style.color = '#a1a1aa' }}
              onMouseLeave={(e) => { if (!act) e.currentTarget.style.color = '#71717a' }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                {m.short}
                {unread[r.id] > 0 && (
                  <span style={{
                    minWidth: 16, height: 16,
                    borderRadius: '999px',
                    background: '#ef4444',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '9px', fontWeight: 700, color: '#fff', lineHeight: 1,
                    padding: '0 3px',
                  }}>
                    {unread[r.id] > 99 ? '99+' : unread[r.id]}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Scope note ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 16px',
        background: '#0d0d10',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.dotColor, flexShrink: 0, opacity: 0.8 }} />
        <span style={{ fontSize: '10px', color: '#52525b' }}>{activeConfig.scope}</span>
      </div>

      {/* ── Messages + History overlay wrapper ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

      {/* History panel — slides in over the messages area */}
      {showHistory && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: '#0d0d10',
          display: 'flex', flexDirection: 'column',
          animation: 'oc-widget-in 0.18s cubic-bezier(0.16,1,0.3,1)',
        }}>
          {/* History header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, borderRadius: '6px', border: 'none',
                background: 'rgba(255,255,255,0.05)', color: '#a1a1aa', cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#d4d4d8', flex: 1 }}>
              Conversation History
            </span>
            <span style={{
              fontSize: '10px', color: meta.dotColor,
              background: `${meta.dotColor}18`, borderRadius: '4px',
              padding: '2px 7px', fontWeight: 500, letterSpacing: '0.04em',
            }}>
              {ROLE_META[activeRole].short}
            </span>
          </div>

          {/* Thread list */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '8px',
            scrollbarWidth: 'thin', scrollbarColor: '#27272a transparent',
          }}>
            {threadsLoading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: meta.dotColor,
                  display: 'inline-block',
                  animation: 'oc-pulse-dot 1.2s ease-in-out infinite',
                }} />
              </div>
            )}
            {!threadsLoading && threads && threads.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: '#52525b', fontSize: '12px', lineHeight: 1.6 }}>
                No previous conversations yet.<br />Start chatting to build history.
              </div>
            )}
            {!threadsLoading && threads && threads.map((t) => {
              const isActive = t.thread_id === current.threadId
              return (
                <button
                  key={t.thread_id}
                  type="button"
                  onClick={() => loadThread(t.thread_id)}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    width: '100%', textAlign: 'left',
                    padding: '9px 11px', borderRadius: '10px', border: 'none',
                    background: isActive ? `${meta.dotColor}14` : 'transparent',
                    cursor: 'pointer', transition: 'background 0.12s',
                    marginBottom: '2px',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isActive && (
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.dotColor, flexShrink: 0 }} />
                    )}
                    <span style={{
                      fontSize: '12px', color: isActive ? '#fafafa' : '#d4d4d8',
                      fontWeight: isActive ? 500 : 400,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      flex: 1,
                    }}>
                      {t.title ?? 'New conversation'}
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#52525b', paddingLeft: isActive ? '11px' : '0' }}>
                    {timeAgo(t.updated_at)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        style={{
          height: '100%', overflowY: 'auto', padding: '16px',
          display: 'flex', flexDirection: 'column', gap: '10px',
          scrollbarWidth: 'thin', scrollbarColor: '#27272a transparent',
        }}
      >
        {/* Empty state */}
        {current.messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '20px 0', textAlign: 'center' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '14px',
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={20} color="#10b981" />
            </div>
            <p style={{ maxWidth: 260, fontSize: '12px', lineHeight: 1.6, color: '#71717a', margin: 0 }}>
              {activeConfig.intro}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' }}>
              {activeConfig.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  style={{
                    borderRadius: '20px', padding: '6px 14px',
                    fontSize: '11px', color: '#a1a1aa', cursor: 'pointer',
                    background: '#18181b', border: '1px solid rgba(255,255,255,0.09)',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fafafa'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; e.currentTarget.style.background = '#1f1f23' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.background = '#18181b' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {current.messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', width: '100%', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.role === 'assistant' && (
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginBottom: '2px',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '9px', fontWeight: 700, color: '#022c22',
                }}>O</div>
              )}
              <div
                dir="auto"
                style={{
                  maxWidth: '82%',
                  padding: m.role === 'user' ? '10px 14px' : '12px 14px',
                  borderRadius: m.role === 'user' ? '18px 18px 5px 18px' : '18px 18px 18px 5px',
                  ...(m.role === 'user'
                    ? { background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.22)', color: '#fafafa', fontSize: '12.5px', lineHeight: 1.65, wordBreak: 'break-word' }
                    : { background: '#18181b', border: '1px solid rgba(255,255,255,0.07)', wordBreak: 'break-word' }
                  ),
                }}
              >
                {m.role === 'user'
                  ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                  : <MsgContent text={m.content} />
                }
              </div>
            </div>
            {/* Cost badge on assistant messages */}
            {m.role === 'assistant' && m.cost_usd !== undefined && (
              <div style={{ fontSize: '9px', color: '#3f3f46', marginTop: '3px', paddingLeft: '30px' }}>
                ${m.cost_usd.toFixed(4)}
              </div>
            )}
          </div>
        ))}

        {/* Streaming bubble — shows live text while tokens arrive */}
        {current.streamingContent !== null && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginBottom: '2px',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', fontWeight: 700, color: '#022c22',
            }}>O</div>
            <div style={{
              maxWidth: '82%', padding: '12px 14px',
              borderRadius: '18px 18px 18px 5px',
              background: '#18181b', border: '1px solid rgba(255,255,255,0.07)',
              wordBreak: 'break-word',
            }}>
              <span style={{ whiteSpace: 'pre-wrap', fontSize: '12.5px', color: '#d4d4d8', lineHeight: 1.65 }}>
                {current.streamingContent}
                {/* Static cursor — signals live streaming */}
                <span style={{ display: 'inline-block', width: 2, height: 13, background: '#10b981', marginLeft: 3, verticalAlign: 'middle', opacity: 0.9 }} />
              </span>
            </div>
          </div>
        )}

        {/* Loading indicator — cycles through realistic steps while waiting for first token */}
        {isPending && current.streamingContent === null && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${meta.dotColor}, ${meta.dotColor}cc)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', fontWeight: 700, color: '#022c22',
            }}>O</div>
            <div style={{
              padding: '11px 14px', borderRadius: '18px 18px 18px 5px',
              background: '#18181b', border: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', flexDirection: 'column', gap: '8px',
              minWidth: '180px',
            }}>
              {/* Step label with slide-in animation keyed to step index */}
              <div key={loadingStep} style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                animation: 'oc-step-in 0.35s ease both',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: meta.dotColor,
                  flexShrink: 0,
                  animation: 'oc-pulse-dot 1.4s ease-in-out infinite',
                }} />
                <span style={{ fontSize: '11.5px', color: '#a1a1aa', letterSpacing: '0.01em' }}>
                  {LOADING_STEPS[activeRole][loadingStep]}
                </span>
              </div>
              {/* Animated progress bar */}
              <div style={{
                height: '2px', borderRadius: '2px',
                background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}>
                <div key={`bar-${loadingStep}`} style={{
                  height: '100%', borderRadius: '2px',
                  background: `linear-gradient(90deg, ${meta.dotColor}99, ${meta.dotColor})`,
                  animation: 'oc-bar-slide 1.75s ease-out both',
                }} />
              </div>
            </div>
          </div>
        )}

        {/* Error card + retry */}
        {current.error && !isPending && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            {/* Same avatar slot as assistant messages — keeps alignment consistent */}
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: '2px',
              background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px',
            }}>⚠</div>
            <div style={{
              flex: 1,
              padding: '12px 14px',
              borderRadius: '18px 18px 18px 5px',
              background: 'rgba(244,63,94,0.08)',
              border: '1px solid rgba(244,63,94,0.2)',
              display: 'flex', flexDirection: 'column', gap: '10px',
            }}>
              <p style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.6, color: '#fda4af' }}>
                {current.error}
              </p>
              {current.lastSentContent && (
                <button
                  type="button"
                  onClick={retry}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '5px 14px', borderRadius: '20px', fontSize: '11px',
                    color: '#a1a1aa', cursor: 'pointer',
                    background: '#18181b', border: '1px solid rgba(255,255,255,0.12)',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fafafa'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
                >
                  ↺ Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {/* ── end messages + history wrapper ── */}
      </div>

      {/* ── Thread bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 16px',
        background: '#111114',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.dotColor }} />
          <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#52525b' }}>
            {ROLE_META[activeRole].short}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {/* History toggle */}
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '4px 8px', borderRadius: '6px', border: 'none',
              background: showHistory ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: showHistory ? '#a1a1aa' : '#71717a', cursor: 'pointer',
              fontSize: '11px', transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#a1a1aa' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = showHistory ? 'rgba(255,255,255,0.08)' : 'transparent'; e.currentTarget.style.color = showHistory ? '#a1a1aa' : '#71717a' }}
          >
            <Clock size={12} />
            History
          </button>
          {/* New thread */}
          <button
            type="button"
            onClick={() => { patch(activeRole, { messages: [], threadId: null, error: null, lastSentContent: null, streamingContent: null }); setShowHistory(false) }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '4px 8px', borderRadius: '6px', border: 'none',
              background: 'transparent', color: '#71717a', cursor: 'pointer',
              fontSize: '11px', transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#a1a1aa' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#71717a' }}
          >
            <MessageSquarePlus size={12} />
            {texts.newThread}
          </button>
        </div>
      </div>

      {/* ── Composer ── */}
      <div style={{
        padding: '12px',
        background: '#0d0d10',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
      }}>
        <form
          style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}
          onSubmit={(e) => { e.preventDefault(); send(draft) }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <textarea
              ref={textareaRef}
              dir="auto"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              disabled={isPending}
              maxLength={4000}
              style={{
                width: '100%', minHeight: '44px', resize: 'none',
                borderRadius: '12px', padding: '10px 14px',
                fontSize: '12.5px', color: '#fafafa',
                background: '#18181b',
                border: `1px solid ${charWarning ? 'rgba(251,146,60,0.5)' : 'rgba(255,255,255,0.1)'}`,
                outline: 'none', fontFamily: 'inherit',
                transition: 'border-color 0.12s',
                opacity: isPending ? 0.6 : 1,
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { if (!charWarning) e.currentTarget.style.borderColor = 'rgba(16,185,129,0.5)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = charWarning ? 'rgba(251,146,60,0.5)' : 'rgba(255,255,255,0.1)' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft) }
              }}
            />
            {/* Character counter — appears only when approaching limit */}
            {charCount > 3000 && (
              <div style={{
                fontSize: '10px',
                color: charCount >= 4000 ? '#f43f5e' : '#fb923c',
                textAlign: 'right',
                paddingRight: '4px',
              }}>
                {charCount} / 4000
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending || !draft.trim()}
            aria-label="Send"
            style={{
              width: 44, height: 44, borderRadius: '12px', flexShrink: 0,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              boxShadow: '0 2px 10px rgba(16,185,129,0.35)',
              border: 'none', color: '#022c22', cursor: isPending || !draft.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: isPending || !draft.trim() ? 0.4 : 1,
              transition: 'opacity 0.12s, transform 0.12s',
              alignSelf: 'flex-end',
            }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.transform = 'scale(1.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
