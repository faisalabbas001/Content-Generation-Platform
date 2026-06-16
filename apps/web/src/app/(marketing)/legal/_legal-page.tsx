import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody } from '@repo/ui/card'

export interface LegalPageProps {
  eyebrow: string
  title: string
  intro: string
  lastUpdatedLabel: string
  lastUpdated: string
  paragraphs: string[]
}

export function LegalPage({ eyebrow, title, intro, lastUpdatedLabel, lastUpdated, paragraphs }: LegalPageProps) {
  return (
    <main>
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <PageHeader eyebrow={eyebrow} title={title} subtitle={intro} />
        <p className="mb-8 text-xs text-(--fg-faint)">
          {lastUpdatedLabel} · <span className="font-mono">{lastUpdated}</span>
        </p>
        <Card>
          <CardBody className="space-y-5 text-sm leading-relaxed text-(--fg-subtle)">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </CardBody>
        </Card>
      </div>
    </main>
  )
}
