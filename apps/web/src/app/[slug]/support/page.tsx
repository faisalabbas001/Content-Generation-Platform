import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Mail, Phone, Clock } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'

export default async function SupportPage() {
  const { t } = await getServerT()

  const channels = [
    { icon: <Mail size={16} />,  label: t('support.channelEmail'), value: 'support@openclaw.io' },
    { icon: <Phone size={16} />, label: t('support.channelPhone'), value: '+966 11 000 0000' },
    { icon: <Clock size={16} />, label: t('support.channelHours'), value: t('support.channelHoursValue') },
  ]

  const faqs = [
    { q: t('support.faqQ1'), a: t('support.faqA1') },
    { q: t('support.faqQ2'), a: t('support.faqA2') },
    { q: t('support.faqQ3'), a: t('support.faqA3') },
  ]

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t('support.eyebrow')} title={t('support.title')} subtitle={t('support.subtitle')} />

      <div className="grid gap-4 sm:grid-cols-3">
        {channels.map((c) => (
          <Card key={c.label} className="p-5">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-(--r-md) bg-(--accent-soft) text-(--accent)">{c.icon}</div>
            <div className="text-xs uppercase tracking-wide text-(--fg-muted)">{c.label}</div>
            <div className="mt-1 font-display text-base font-semibold text-(--fg)" dir="ltr">{c.value}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div><CardTitle>{t('support.faqTitle')}</CardTitle></div>
        </CardHeader>
        <CardBody className="space-y-5">
          {faqs.map((f, i) => (
            <details key={i} className="group rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) p-4 transition-colors hover:border-(--border-strong)">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-(--fg)">
                <span>{f.q}</span>
                <span className="text-(--fg-faint) transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-(--fg-muted)">{f.a}</p>
            </details>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}
