import { dictionaries } from '@repo/i18n'
import { getServerT, getLocale } from '@/lib/i18n-server'
import { LegalPage } from '../_legal-page'

export default async function PdplPage() {
  const { t } = await getServerT()
  const locale = await getLocale()
  const paragraphs = (dictionaries[locale] as { legal: { pdplBody: string[] } }).legal.pdplBody
  return (
    <LegalPage
      eyebrow={t('legal.pdplEyebrow')}
      title={t('legal.pdplTitle')}
      intro={t('legal.intro')}
      lastUpdatedLabel={t('legal.lastUpdated')}
      lastUpdated="2026-04-26"
      paragraphs={paragraphs}
    />
  )
}
