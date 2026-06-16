import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardFooter } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { getServerT } from '@/lib/i18n-server'

export default async function UpgradePage() {
  const { t } = await getServerT()

  const PLANS = [
    {
      id: 'free',
      name: t('upgrade.free.name'),
      price: 0,
      highlight: false,
      features: [t('upgrade.free.f1'), t('upgrade.free.f2'), t('upgrade.free.f3')],
      cta: t('upgrade.free.cta'),
      footer: t('upgrade.free.footer'),
      free: t('upgrade.free.free'),
    },
    {
      id: 'paid_starter',
      name: t('upgrade.starter.name'),
      price: 299,
      highlight: true,
      features: [
        t('upgrade.starter.f1'),
        t('upgrade.starter.f2'),
        t('upgrade.starter.f3'),
        t('upgrade.starter.f4'),
      ],
      cta: t('upgrade.starter.cta'),
    },
    {
      id: 'paid_pro',
      name: t('upgrade.pro.name'),
      price: 699,
      highlight: false,
      features: [
        t('upgrade.pro.f1'),
        t('upgrade.pro.f2'),
        t('upgrade.pro.f3'),
        t('upgrade.pro.f4'),
      ],
      cta: t('upgrade.pro.cta'),
    },
  ] as const

  return (
    <div>
      <PageHeader eyebrow={t('upgrade.eyebrow')} title={t('upgrade.title')} subtitle={t('upgrade.subtitle')} />

      <div className="grid gap-5 md:grid-cols-3">
        {PLANS.map((p) => (
          <Card
            key={p.id}
            className={p.highlight ? 'relative border-(--accent) shadow-(--shadow-glow)' : ''}
          >
            {p.highlight && (
              <div className="absolute inset-x-0 -top-3 flex justify-center">
                <Badge tone="accent" dot>{t('upgrade.mostPopular')}</Badge>
              </div>
            )}
            <CardHeader>
              <div><CardTitle>{p.name}</CardTitle></div>
            </CardHeader>
            <CardBody className="space-y-5">
              <div>
                <span className="font-display text-4xl font-semibold tracking-tight text-(--fg)">
                  {p.price === 0 ? p['free' as keyof typeof p] ?? '0' : p.price}
                </span>
                {p.price > 0 && <span className="ms-1 text-sm text-(--fg-muted)">{t('upgrade.monthly')}</span>}
              </div>
              <ul className="space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-(--fg-subtle)">
                    <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-(--accent)" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button variant={p.id === 'free' ? 'secondary' : 'primary'} className="w-full">
                {p.cta}
              </Button>
            </CardBody>
            <CardFooter>
              {p.price === 0 ? p['footer' as keyof typeof p] ?? '' : t('upgrade.cancelAnytime')}
            </CardFooter>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-(--fg-faint)">{t('upgrade.footnote')}</p>
    </div>
  )
}
