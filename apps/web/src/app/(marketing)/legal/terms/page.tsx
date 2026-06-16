import { dictionaries } from '@repo/i18n'
import { getServerT, getLocale } from '@/lib/i18n-server'
import { LegalPage } from '../_legal-page'

export default async function TermsPage() {
  const { t } = await getServerT()
  const locale = await getLocale()
  const paragraphs = (dictionaries[locale] as { legal: { termsBody: string[] } }).legal.termsBody
  return (
    <LegalPage
      eyebrow={t('legal.termsEyebrow')}
      title={t('legal.termsTitle')}
      intro={t('legal.intro')}
      lastUpdatedLabel={t('legal.lastUpdated')}
      lastUpdated="2026-04-26"
      paragraphs={paragraphs}
    />
  )
}
