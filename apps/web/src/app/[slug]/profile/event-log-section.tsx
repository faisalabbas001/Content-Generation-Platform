import { adminClient } from '@repo/db/client'
import Link from 'next/link'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'

const PAGE_SIZE = 20

const EVENT_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'outline'> = {
  client_confirmed:                          'success',
  confidence_upgraded:                       'info',
  source_ingested:                           'outline',
  override_added:                            'warning',
  contradiction_detected:                    'danger',
  brand_graduated:                           'success',
  field_written:                             'success',
  method_profile_written:                    'info',
  negative_pattern_added:                    'warning',
  correction_progress_correction_received:   'info',
  correction_progress_ceo_classifying:       'info',
  correction_progress_ceo_approved:          'info',
  correction_progress_memory_writing:        'warning',
  correction_progress_correction_applied:    'success',
  correction_progress_correction_rejected:   'danger',
}

const EVENT_LABEL: Record<string, string> = {
  client_confirmed:                          'Confirmed',
  confidence_upgraded:                       'Confidence Upgraded',
  source_ingested:                           'Source Ingested',
  override_added:                            'Override Added',
  contradiction_detected:                    'Contradiction Detected',
  brand_graduated:                           'Brand Graduated',
  field_written:                             'Field Updated',
  method_profile_written:                    'Creative Profile Updated',
  negative_pattern_added:                    'Negative Pattern Added',
  correction_progress_correction_received:   'Received',
  correction_progress_ceo_classifying:       'CEO Classifying',
  correction_progress_ceo_approved:          'CEO Approved',
  correction_progress_memory_writing:        'Writing Memory',
  correction_progress_correction_applied:    'Applied',
  correction_progress_correction_rejected:   'Rejected',
}

const FIELD_PATH_LABEL: Record<string, string> = {
  'VisualStyleProfile.color_palette':    'Colour palette',
  'VisualStyleProfile.style_descriptor': 'Visual style description',
  'AudienceProfile.description_ar':      'Audience description',
  'AudienceProfile.language_preference': 'Audience language',
  arabic_dialect:       'Arabic dialect',
  price_position:       'Price position',
  formality_level:      'Formality level',
  humor_tolerance:      'Humor tolerance',
  religious_sensitivity:'Religious sensitivity',
  bilingual_ratio:      'Bilingual ratio',
  brand_differentiator: 'Brand differentiator',
  primary_kpi_type:     'Primary KPI',
  primary_channel:      'Primary channel',
  ramadan_relevance:    'Ramadan relevance',
  tone_anti_attribute_ids: 'Tone anti-attributes',
  archetype_primary:    'Primary archetype',
  archetype_secondary:  'Secondary archetype',
  lifecycle_stage:      'Lifecycle stage',
  intent_state:         'Intent state',
}

function fieldLabel(path: string): string {
  return FIELD_PATH_LABEL[path] ?? path.split('.').pop()?.replace(/_/g, ' ') ?? path
}

function EventTypeBadge({ type }: { type: string }) {
  const label = EVENT_LABEL[type] ?? type.replace(/correction_progress_/g, '').replace(/_/g, ' ')
  return (
    <Badge tone={EVENT_TONE[type] ?? 'outline'} size="sm">
      {label}
    </Badge>
  )
}

function EventTypeIcon({ type, isError, isSuccess, isClientAction }: {
  type: string; isError: boolean; isSuccess: boolean; isClientAction: boolean
}) {
  if (isError) return (
    <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  )
  if (type === 'client_confirmed' || isClientAction) return (
    <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  )
  if (type === 'brand_graduated' || type.includes('correction_applied')) return (
    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
  if (type.includes('memory_writing') || type.includes('ceo_approved')) return (
    <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
  if (type.includes('ceo_classifying') || type.includes('correction_received')) return (
    <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
    </svg>
  )
  if (type === 'confidence_upgraded') return (
    <svg className="w-3.5 h-3.5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  )
  if (type === 'source_ingested') return (
    <svg className="w-3.5 h-3.5 text-(--fg-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
  // fallback
  return (
    <svg className="w-3.5 h-3.5 text-(--fg-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
    </svg>
  )
}

export async function EventLogSection({
  brand_id,
  slug,
  evtPage,
}: {
  brand_id: string
  slug: string
  evtPage: number
}) {
  const db = adminClient()
  const offset = (evtPage - 1) * PAGE_SIZE

  const [eventsRes, countRes] = await Promise.all([
    db.from('branddna_event_log')
      .select('event_id, event_type, event_data, created_at')
      .eq('brand_id', brand_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1),
    db.from('branddna_event_log')
      .select('event_id', { count: 'exact', head: true })
      .eq('brand_id', brand_id),
  ])

  const events = (eventsRes.data ?? []) as Array<{
    event_id: string; event_type: string; event_data: Record<string, unknown>; created_at: string
  }>
  const total = countRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (events.length === 0 && evtPage === 1) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <div>
            <CardTitle>BrandDNA Change History</CardTitle>
            <CardDescription>
              {total} total events · page {evtPage} of {totalPages}
            </CardDescription>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-(--fg-faint) bg-(--surface-3) border border-(--border-subtle) rounded-full px-3 py-1">
            <svg className="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="3" />
            </svg>
            Live
          </span>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <ul className="divide-y divide-(--border-subtle)">
          {events.map((ev) => {
            const data = ev.event_data
            const fieldName = fieldLabel(String(data.applied_to ?? data.field_name ?? data.stage ?? '—'))
            const oldVal = data.old_value ?? data.current_value
            const newVal = data.new_value ?? data.proposed_value ?? data.corrected_value
            const source = String(data.source ?? '')
            const isClientAction = source === 'client_confirmation' || ev.event_type === 'client_confirmed'
            const isError = ev.event_type.includes('rejected') || ev.event_type === 'contradiction_detected'
            const isSuccess = ev.event_type === 'client_confirmed' || ev.event_type === 'brand_graduated' || ev.event_type.includes('correction_applied') || ev.event_type.includes('memory_writing')
            const reasoning: string | null = (data.reasoning ?? data.rejection_reason) != null ? String(data.reasoning ?? data.rejection_reason) : null

            return (
              <li key={ev.event_id} className="flex items-start gap-3.5 px-5 py-3.5 hover:bg-(--surface-2) transition-colors">
                <div className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                  isError ? 'bg-red-500/10' : isSuccess ? 'bg-emerald-500/10' : isClientAction ? 'bg-blue-500/10' : 'bg-(--surface-3)'
                }`}>
                  <EventTypeIcon type={ev.event_type} isError={isError} isSuccess={isSuccess} isClientAction={isClientAction} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <EventTypeBadge type={ev.event_type} />
                    {fieldName !== '—' && (
                      <code className="text-[11px] font-mono font-semibold text-(--fg) bg-(--surface-3) px-1.5 py-0.5 rounded">
                        {fieldName}
                      </code>
                    )}
                    {oldVal != null && newVal != null && (
                      <span className="flex items-center gap-1 text-[11px] font-mono">
                        <span className="text-(--fg-faint) line-through">{String(oldVal)}</span>
                        <svg className="w-3 h-3 text-(--fg-faint) shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <span className="text-emerald-400 font-semibold">{String(newVal)}</span>
                      </span>
                    )}
                    {oldVal == null && newVal != null && (
                      <span className="flex items-center gap-1 text-[11px] font-mono">
                        <svg className="w-3 h-3 text-(--fg-faint) shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <span className="text-emerald-400 font-semibold">{String(newVal)}</span>
                      </span>
                    )}
                    {isClientAction && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                        client confirmed
                      </span>
                    )}
                  </div>
                  {reasoning && (
                    <p className="mt-1 text-[11px] text-(--fg-muted) leading-relaxed line-clamp-2">
                      {reasoning}
                    </p>
                  )}
                </div>
                <time className="shrink-0 text-[11px] text-(--fg-faint) tabular-nums mt-0.5">
                  {new Date(ev.created_at).toLocaleString('en-SA', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
                  })}
                </time>
              </li>
            )
          })}
        </ul>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-(--border-subtle) px-5 py-2.5 text-xs text-(--fg-muted)">
            <span>Page {evtPage} of {totalPages}</span>
            <div className="flex gap-2">
              {evtPage > 1 ? (
                <Link href={`/${slug}/profile?evt_page=${evtPage - 1}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 hover:bg-(--surface-2) transition-colors">← Prev</Link>
              ) : (
                <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 opacity-40">← Prev</span>
              )}
              {evtPage < totalPages ? (
                <Link href={`/${slug}/profile?evt_page=${evtPage + 1}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 hover:bg-(--surface-2) transition-colors">Next →</Link>
              ) : (
                <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 opacity-40">Next →</span>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
