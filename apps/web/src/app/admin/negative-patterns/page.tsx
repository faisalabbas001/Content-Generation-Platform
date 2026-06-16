import { adminClient, isDbConfigured } from '@repo/db'
import { notFound } from 'next/navigation'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { DataTable } from '@repo/ui/data-table'
import { GlobalPatternAddForm, GlobalPatternRowActions } from './global-pattern-actions'
import type { GlobalNegativePattern } from '@repo/db/queries/brand-dna'

export const dynamic = 'force-dynamic'

const CATEGORY_LABELS: Record<string, string> = {
  alcohol_substances:   '🍺 Alcohol & Substances',
  gambling:             '🎲 Gambling',
  adult_content:        '🔞 Adult Content',
  political:            '🏛 Political',
  religious:            '🕌 Religious',
  hate_speech:          '⚠️ Hate Speech',
  false_claims:         '❌ False Claims',
  financial:            '💰 Financial',
  urgency_manipulation: '⏰ Urgency',
  general:              '📋 General',
}

export default async function GlobalNegativePatternsPage() {
  if (!isDbConfigured()) notFound()

  const db = adminClient()
  const { data, error } = await db
    .from('global_negative_patterns' as never)
    .select('*')
    .order('category' as never)
    .order('severity' as never)

  if (error) throw new Error((error as { message: string }).message)

  const patterns = (data ?? []) as unknown as GlobalNegativePattern[]

  const byCategory = patterns.reduce<Record<string, GlobalNegativePattern[]>>((acc, p) => {
    const cat = p.category ?? 'general'
    if (!acc[cat]) acc[cat] = []
    acc[cat]!.push(p)
    return acc
  }, {})

  const activeCount = patterns.filter((p) => p.is_active).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Content Policy"
        title="Global Negative Patterns"
        subtitle="Platform-wide blocklist applied to every brand during caption generation. Changes take effect on the next A01/A02 call — the Qdrant cache auto-invalidates on the next compile."
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Patterns" value={patterns.length} />
        <StatCard label="Active" value={activeCount} accent />
        <StatCard label="Inactive" value={patterns.length - activeCount} />
      </div>

      {/* Add form */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Add Pattern</CardTitle>
            <CardDescription>New patterns apply to every brand immediately on next caption compile.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <GlobalPatternAddForm />
        </CardBody>
      </Card>

      {/* Patterns grouped by category */}
      {Object.entries(byCategory).map(([category, catPatterns]) => (
        <Card key={category}>
          <CardHeader>
            <div>
              <CardTitle>{CATEGORY_LABELS[category] ?? category}</CardTitle>
              <CardDescription>{catPatterns.length} pattern{catPatterns.length !== 1 ? 's' : ''}</CardDescription>
            </div>
            <div className="flex gap-1.5">
              <Badge tone="success" size="sm">{catPatterns.filter((p) => p.is_active).length} active</Badge>
              {catPatterns.filter((p) => !p.is_active).length > 0 && (
                <Badge tone="outline" size="sm">{catPatterns.filter((p) => !p.is_active).length} off</Badge>
              )}
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <DataTable
              rows={catPatterns}
              density="compact"
              columns={[
                {
                  key: 'text',
                  header: 'Pattern',
                  render: (p) => (
                    <span
                      dir="auto"
                      className={`text-sm ${p.is_active ? 'text-(--fg)' : 'text-(--fg-faint) line-through'}`}
                    >
                      {p.pattern_text}
                    </span>
                  ),
                },
                {
                  key: 'severity',
                  header: 'Severity',
                  render: (p) => (
                    <Badge
                      tone={p.severity === 'HARD_BLOCK' ? 'danger' : p.severity === 'STRONG_WARN' ? 'warning' : 'outline'}
                      size="sm"
                    >
                      {p.severity}
                    </Badge>
                  ),
                },
                {
                  key: 'desc',
                  header: 'Description',
                  render: (p) => (
                    <span className="text-xs text-(--fg-muted)">{p.description ?? '—'}</span>
                  ),
                },
                {
                  key: 'created',
                  header: 'Added',
                  render: (p) => (
                    <span className="font-mono text-xs text-(--fg-subtle)">
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  ),
                  align: 'end' as const,
                },
                {
                  key: 'actions',
                  header: '',
                  render: (p) => (
                    <GlobalPatternRowActions pattern_id={p.pattern_id} is_active={p.is_active} />
                  ),
                  align: 'end' as const,
                },
              ]}
              empty="No patterns in this category."
            />
          </CardBody>
        </Card>
      ))}

      {patterns.length === 0 && (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-(--fg-faint)">No global patterns yet. Add one above.</p>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`rounded-(--r-md) border p-4 text-center ${
        accent ? 'border-(--accent) bg-(--accent)/5' : 'border-(--border-subtle) bg-(--surface-1)'
      }`}
    >
      <div className={`font-display text-2xl font-bold ${accent ? 'text-(--accent)' : 'text-(--fg)'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-(--fg-muted)">{label}</div>
    </div>
  )
}
