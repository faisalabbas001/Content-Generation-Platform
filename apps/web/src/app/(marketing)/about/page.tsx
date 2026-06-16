import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'

const PHASES = [
  { key: 1, tone: 'accent'  as const },
  { key: 2, tone: 'info'    as const },
  { key: 3, tone: 'warning' as const },
  { key: 4, tone: 'outline' as const },
  { key: 5, tone: 'outline' as const },
  { key: 6, tone: 'outline' as const },
]

export default async function AboutPage() {
  const { t } = await getServerT()
  return (
    <main>
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24">
        <PageHeader
          eyebrow={t('about.eyebrow')}
          title={t('about.title')}
          subtitle={t('about.subtitle')}
        />

        <h2 id="roadmap" className="mt-12 font-display text-2xl font-semibold tracking-tight text-(--fg)">
          {t('about.phaseRoadmapTitle')}
        </h2>

        <div className="mt-6 space-y-3">
          {PHASES.map((p) => (
            <Card key={p.key} variant="default">
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                <div className="flex shrink-0 items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-(--r-md) bg-(--surface-3) font-mono text-sm font-medium text-(--fg-subtle)">
                    {p.key}
                  </span>
                  <Badge tone={p.tone} dot={p.tone !== 'outline'}>
                    {t(`about.phase${p.key}` as `about.phase1`)}
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed text-(--fg-muted)">
                  {t(`about.phase${p.key}Desc` as `about.phase1Desc`)}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
