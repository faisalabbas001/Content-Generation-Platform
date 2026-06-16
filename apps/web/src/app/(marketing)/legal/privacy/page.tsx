import { dictionaries } from '@repo/i18n'
import { getServerT, getLocale } from '@/lib/i18n-server'
import { LegalPage } from '../_legal-page'

export default async function PrivacyPage() {
  const { t } = await getServerT()
  const locale = await getLocale()
  const paragraphs = (dictionaries[locale] as { legal: { privacyBody: string[] } }).legal.privacyBody
  return (
    <LegalPage
      eyebrow={t('legal.privacyEyebrow')}
      title={t('legal.privacyTitle')}
      intro={t('legal.intro')}
      lastUpdatedLabel={t('legal.lastUpdated')}
      lastUpdated="2026-04-26"
      paragraphs={paragraphs}
    />
  )
}
