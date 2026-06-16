import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { Zap, ArrowLeft } from '@repo/ui/icons'
import { getBrandForCurrentUser } from '@repo/auth/server'
import { getServerT } from '@/lib/i18n-server'
import { OnDemandForm, type OnDemandFormStrings } from './on-demand-form'

export const dynamic = 'force-dynamic'

export default async function OnDemandNewPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { t } = await getServerT()
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()

  // Pre-resolve all translations server-side. Client components can't receive
  // functions across the RSC boundary, so we hand the form a plain object.
  const strings: OnDemandFormStrings = {
    rule:   t('onDemand.rule'),
    submit: t('onDemand.submit'),
    footer: t('onDemand.footer'),
    mediaType: {
      label:     t('onDemand.mediaType.label'),
      image:     t('onDemand.mediaType.image'),
      video:     t('onDemand.mediaType.video'),
      imageDesc: t('onDemand.mediaType.imageDesc'),
      videoDesc: t('onDemand.mediaType.videoDesc'),
    },
    prompt: {
      label:           t('onDemand.prompt.label'),
      placeholder:     t('onDemand.prompt.placeholder'),
      videoPlaceholder: t('onDemand.prompt.videoPlaceholder'),
      charLimit:       t('onDemand.prompt.charLimit'),
      tooShort:        t('onDemand.prompt.tooShort'),
      tooLong:         t('onDemand.prompt.tooLong'),
    },
    processing: {
      title:        t('onDemand.processing.title'),
      steps: {
        validating: t('onDemand.processing.steps.validating'),
        connecting: t('onDemand.processing.steps.connecting'),
        generating: t('onDemand.processing.steps.generating'),
        finalizing: t('onDemand.processing.steps.finalizing'),
      },
      stepDetail: {
        ceo:     t('onDemand.processing.stepDetail.ceo'),
        coo:     t('onDemand.processing.stepDetail.coo'),
        caption: t('onDemand.processing.stepDetail.caption'),
        qc:      t('onDemand.processing.stepDetail.qc'),
        image:   t('onDemand.processing.stepDetail.image'),
        upload:  t('onDemand.processing.stepDetail.upload'),
      },
      held:           t('onDemand.processing.held'),
      heldBackToList: t('onDemand.processing.heldBackToList'),
      failed:         t('onDemand.processing.failed'),
      failureReasons: {
        auth:        t('onDemand.processing.failureReasons.auth'),
        timeout:     t('onDemand.processing.failureReasons.timeout'),
        unreachable: t('onDemand.processing.failureReasons.unreachable'),
        quality:     t('onDemand.processing.failureReasons.quality'),
        blocked:     t('onDemand.processing.failureReasons.blocked'),
      },
      retry:          t('onDemand.processing.retry'),
      editPrompt:     t('onDemand.processing.editPrompt'),
      successTitle:   t('onDemand.processing.successTitle'),
      successBody:    t('onDemand.processing.successBody'),
      hint:           t('onDemand.processing.hint'),
      checkLater:     t('onDemand.processing.checkLater'),
      hardCapMessage: t('onDemand.processing.hardCapMessage'),
    },
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/${slug}/on-demand`}
        className="inline-flex items-center gap-1.5 text-xs text-(--fg-muted) hover:text-(--fg) transition-colors"
      >
        <ArrowLeft size={14} aria-hidden /> {t('onDemandPosts.title')}
      </Link>

      <PageHeader
        eyebrow={t('onDemand.eyebrow')}
        title={t('onDemand.title')}
        subtitle={t('onDemand.subtitle')}
        action={<Badge tone="accent" dot>{'< 5 min'}</Badge>}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[18rem_1fr] xl:grid-cols-[20rem_1fr]">
        {/* ─── Brand context (auto-pulled, read-only) ─── */}
        {/* Sticky on lg+ so it stays visible while the long form scrolls. */}
        <aside className="lg:sticky lg:top-28">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t('onDemand.brandContext.title')}</CardTitle>
                <CardDescription>{t('onDemand.brandContext.description')}</CardDescription>
              </div>
              <Zap size={16} className="text-(--accent)" aria-hidden />
            </CardHeader>
            <CardBody className="space-y-2.5 text-sm">
              <Row label={t('onDemand.brandContext.sector')}  value={brand.sector} />
              <Row label={t('onDemand.brandContext.dialect')} value={brand.arabic_dialect ?? '—'} />
              <Row label={t('onDemand.brandContext.city')}    value={brand.city_primary ?? '—'} />
              <Row label={t('onDemand.brandContext.channel')} value={brand.primary_channel ?? '—'} />
              <Row
                label={t('onDemand.brandContext.voice')}
                value={brand.brand_differentiator ?? '—'}
              />
            </CardBody>
          </Card>
        </aside>

        {/* ─── Generate form ─── */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('onDemand.brief.title')}</CardTitle>
              <CardDescription>{t('onDemand.brief.description')}</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <OnDemandForm
              strings={strings}
              clientSlug={slug}
              defaultPlatform={brand.primary_channel}
              defaultColorHex={brand.primary_color_hex}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
      <span className="text-(--fg-muted)">{label}</span>
      <span className="font-medium text-(--fg) text-end">{value}</span>
    </div>
  )
}
